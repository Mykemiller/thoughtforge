/**
 * The outbound jobs: the weekday cron (briefing, plus a cold open on Tue/Thu)
 * and Signal takeaways in thread or roundtable mode (TH-31, TH-47).
 * Dependencies are injected so tests and the dry-run CLI exercise exactly this code.
 */
import { composerFor, mockModel, roundtableSubject, signalSubject } from "./compose";
import { signature } from "./panelists";
import { makeMessageId, type Sender } from "./send";
import type { DigestStore, EmailStore } from "./store";
import { centralDate, chairFor, coldOpenSenderFor, isColdOpenDay, isValidDate, isWeekend, weekdayOf } from "./rotation";
import { SIGNAL_MODES, type Composer, type EmailKind, type EmailPanelist, type SignalInput, type SignalMode } from "./types";

export interface RunDeps {
  /** All ten, in EMAIL_ORDER. */
  panelists: EmailPanelist[];
  compose: Composer;
  sender: Sender;
  store: EmailStore;
  /** Raw digests (TH-47). When present, the briefing is written with the latest edition in front of the chair. */
  digests?: DigestStore;
  /** Recipient and the panel-wide Reply-To (panel@); never logged. Persona emails use the panelist's own Reply-To. */
  recipient: string;
  replyTo: string;
  /** The reader's first name for the opener (PANEL_RECIPIENT_NAME). */
  readerName?: string;
  /** Default Signal mode (PANEL_SIGNAL_MODE). */
  signalMode?: SignalMode;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface Outcome {
  kind: EmailKind;
  slug: string;
  status: "sent" | "skipped" | "failed";
  subject?: string;
  resend_id?: string;
  reason?: string;
}

export interface DailyResult {
  date: string;
  weekday: number;
  skipped?: "weekend";
  /** The digest edition the briefing was written against, if any. */
  digest_date?: string;
  outcomes: Outcome[];
}

export interface SignalResult {
  edition_date: string;
  mode: SignalMode;
  subject: string;
  outcomes: Outcome[];
}

export const SIGNAL_SPACING_MS = 2000;
/** A digest older than this is not put in front of the chair as "the latest". */
export const BRIEFING_DIGEST_MAX_AGE_DAYS = 4;
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Job {
  kind: EmailKind;
  panelist: EmailPanelist;
  date: string;
  signal?: SignalInput;
}

type Prepared = { job: Job; outcome?: Outcome; composed?: { subject: string; body: string } };

async function prepare(job: Job, deps: RunDeps): Promise<Prepared> {
  const key = { kind: job.kind, send_date: job.date, panelist_slug: job.panelist.slug };
  try {
    if (await deps.store.has(key)) return { job, outcome: { kind: job.kind, slug: job.panelist.slug, status: "skipped", reason: "already sent" } };
    const composed = await deps.compose({ panelist: job.panelist, kind: job.kind, context: { date: job.date, signal: job.signal, readerName: deps.readerName } });
    return { job, composed };
  } catch (e) {
    return { job, outcome: { kind: job.kind, slug: job.panelist.slug, status: "failed", reason: errMsg(e) } };
  }
}

async function deliver(p: Prepared, deps: RunDeps): Promise<Outcome> {
  if (p.outcome) return p.outcome;
  const { job } = p;
  const composed = p.composed!;
  const slug = job.panelist.slug;
  const messageId = makeMessageId();
  let reservation: { id: string } | null;
  try {
    reservation = await deps.store.reserve({
      kind: job.kind,
      send_date: job.date,
      panelist_slug: slug,
      subject: composed.subject,
      body: composed.body,
      resend_id: null,
      message_id: messageId,
      in_reply_to: null,
      thread_key: job.kind === "signal-takeaway" ? composed.subject : null,
    });
  } catch (e) {
    return { kind: job.kind, slug, status: "failed", subject: composed.subject, reason: errMsg(e) };
  }
  if (!reservation) return { kind: job.kind, slug, status: "skipped", subject: composed.subject, reason: "already sent" };
  try {
    const res = await deps.sender.send({
      from: job.panelist.from,
      to: deps.recipient,
      // Persona emails reply to the panelist's own inbox (TF-DEC-83); panel@ is the fallback only.
      replyTo: job.panelist.replyTo || deps.replyTo,
      subject: composed.subject,
      text: composed.body,
      messageId,
      idempotencyKey: `${job.kind}/${job.date}/${slug}`,
    });
    try {
      await deps.store.markSent(reservation.id, { resend_id: res.resendId, message_id: res.messageId });
    } catch (e) {
      // The email went out; the row stays (so it is never re-sent) without its resend_id.
      deps.log?.(`[email] ${job.kind} ${slug}: sent but the row was not updated: ${errMsg(e)}`);
    }
    deps.log?.(`[email] ${job.kind} ${slug}: sent (${res.resendId})`);
    return { kind: job.kind, slug, status: "sent", subject: composed.subject, resend_id: res.resendId };
  } catch (e) {
    await deps.store.release(reservation.id).catch((re) => deps.log?.(`[email] ${job.kind} ${slug}: could not release the reservation: ${errMsg(re)}`));
    return { kind: job.kind, slug, status: "failed", subject: composed.subject, reason: errMsg(e) };
  }
}

function bySlug(deps: RunDeps, slug: string): EmailPanelist {
  const p = deps.panelists.find((x) => x.slug === slug);
  if (!p) throw new Error(`email: ${slug} is not in the panel`);
  return p;
}

const daysApart = (a: string, b: string) => Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));

/** The latest raw digest, as Signal context for the chair, when it is recent enough. */
export async function latestDigestFor(date: string, digests: DigestStore | undefined): Promise<SignalInput | undefined> {
  if (!digests) return undefined;
  const d = await digests.latest();
  if (!d || !d.raw_text || daysApart(d.digest_date, date) > BRIEFING_DIGEST_MAX_AGE_DAYS) return undefined;
  return { subject: d.subject, text: d.raw_text, editionDate: d.digest_date };
}

/** Weekday cron: briefing from today's chair (with the latest digest in front of them); on Tue/Thu also the cold open. Weekends do nothing. */
export async function runDaily(now: Date, deps: RunDeps): Promise<DailyResult> {
  const date = centralDate(now);
  const weekday = weekdayOf(date);
  if (isWeekend(date)) return { date, weekday, skipped: "weekend", outcomes: [] };
  const order = deps.panelists.map((p) => p.slug);
  let signal: SignalInput | undefined;
  try {
    signal = await latestDigestFor(date, deps.digests);
  } catch (e) {
    deps.log?.(`[email] briefing: could not read the latest digest, writing without it: ${errMsg(e)}`);
  }
  const jobs: Job[] = [{ kind: "briefing", panelist: bySlug(deps, chairFor(date, order)), date, signal }];
  if (isColdOpenDay(date)) jobs.push({ kind: "cold-open", panelist: bySlug(deps, coldOpenSenderFor(date, order)), date });
  const outcomes: Outcome[] = [];
  for (const job of jobs) outcomes.push(await deliver(await prepare(job, deps), deps));
  return { date, weekday, digest_date: signal?.editionDate, outcomes };
}

export class SignalInputError extends Error {}

export const SIGNAL_TEXT_MAX = 200_000;

export interface SignalRunInput {
  subject: string;
  text: string;
  edition_date?: string;
  mode?: SignalMode;
}

/** Validates the POST body: { subject, text, edition_date?: "YYYY-MM-DD", mode?: "thread" | "roundtable" }. */
export function parseSignalBody(body: unknown): SignalRunInput {
  if (!body || typeof body !== "object") throw new SignalInputError("body must be a JSON object");
  const b = body as Record<string, unknown>;
  const subject = typeof b.subject === "string" ? b.subject.replace(/[\r\n]+/g, " ").trim() : "";
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!subject) throw new SignalInputError("subject is required");
  if (subject.length > 300) throw new SignalInputError("subject is over 300 characters");
  if (!text) throw new SignalInputError("text is required");
  if (text.length > SIGNAL_TEXT_MAX) throw new SignalInputError(`text is over ${SIGNAL_TEXT_MAX} characters`);
  const out: SignalRunInput = { subject, text };
  if (b.edition_date !== undefined) {
    if (typeof b.edition_date !== "string" || !isValidDate(b.edition_date)) throw new SignalInputError("edition_date must be YYYY-MM-DD");
    out.edition_date = b.edition_date;
  }
  if (b.mode !== undefined) {
    if (typeof b.mode !== "string" || !(SIGNAL_MODES as readonly string[]).includes(b.mode)) throw new SignalInputError(`mode must be one of ${SIGNAL_MODES.join(", ")}`);
    out.mode = b.mode as SignalMode;
  }
  return out;
}

/**
 * Signal takeaways. thread mode: every panelist, cast order, identical "Re: <subject>",
 * composes in parallel, sends one at a time 2 seconds apart. roundtable mode: the same ten
 * composes, then ONE email from the day's chair carrying all ten under each name, still ten
 * rows. Idempotent on (signal-takeaway, edition_date, panelist_slug) either way.
 */
export async function runSignal(input: SignalRunInput, now: Date, deps: RunDeps): Promise<SignalResult> {
  const date = input.edition_date ?? centralDate(now);
  const mode: SignalMode = input.mode ?? deps.signalMode ?? "thread";
  const signal: SignalInput = { subject: input.subject, text: input.text, editionDate: date };
  const prepared = await Promise.all(deps.panelists.map((panelist) => prepare({ kind: "signal-takeaway", panelist, date, signal }, deps)));
  if (mode === "roundtable") return runRoundtable(prepared, signal, date, deps);
  const sleep = deps.sleep ?? realSleep;
  const outcomes: Outcome[] = [];
  let sentBefore = false;
  for (const p of prepared) {
    if (!p.outcome && sentBefore) await sleep(SIGNAL_SPACING_MS);
    const o = await deliver(p, deps);
    if (o.status === "sent") sentBefore = true;
    outcomes.push(o);
  }
  return { edition_date: date, mode, subject: signalSubject(input.subject), outcomes };
}

/** "— <Name>, <Role>" then the takeaway without its own signature. */
export function roundtableSection(p: EmailPanelist, takeawayBody: string): string {
  const sig = signature(p);
  const body = takeawayBody.endsWith(sig) ? takeawayBody.slice(0, -sig.length).trim() : takeawayBody.trim();
  return `— ${p.name}, ${p.role}\n\n${body}`;
}

/** The whole roundtable email: the chair's opener, ten sections in cast order, the chair's signature. */
export function assembleRoundtable(opener: string, sections: { panelist: EmailPanelist; body: string }[], chair: EmailPanelist): string {
  return [opener.trim(), ...sections.map((s) => roundtableSection(s.panelist, s.body)), signature(chair)].join("\n\n");
}

async function runRoundtable(prepared: Prepared[], signal: SignalInput, date: string, deps: RunDeps): Promise<SignalResult> {
  const subject = roundtableSubject(signal.subject);
  const order = deps.panelists.map((p) => p.slug);
  const chair = bySlug(deps, chairFor(date, order));
  const result = (outcomes: Outcome[]): SignalResult => ({ edition_date: date, mode: "roundtable", subject, outcomes });
  const ready = prepared.filter((p) => !p.outcome);
  const fixed = prepared.filter((p) => p.outcome).map((p) => p.outcome!);
  if (!ready.length) return result(fixed);

  // Reserve all ten rows first so a concurrent run sees them; a conflict on any means it got there first.
  const messageId = makeMessageId();
  const reserved: { id: string; p: Prepared }[] = [];
  const outcomes: Outcome[] = [...fixed];
  for (const p of ready) {
    try {
      const r = await deps.store.reserve({
        kind: "signal-takeaway",
        send_date: date,
        panelist_slug: p.job.panelist.slug,
        subject,
        body: p.composed!.body,
        resend_id: null,
        message_id: messageId,
        in_reply_to: null,
        thread_key: subject,
      });
      if (r) reserved.push({ id: r.id, p });
      else outcomes.push({ kind: "signal-takeaway", slug: p.job.panelist.slug, status: "skipped", subject, reason: "already sent" });
    } catch (e) {
      outcomes.push({ kind: "signal-takeaway", slug: p.job.panelist.slug, status: "failed", subject, reason: errMsg(e) });
    }
  }
  if (!reserved.length) return result(outcomes);

  const releaseAll = async (reason: string) => {
    for (const r of reserved) {
      await deps.store.release(r.id).catch((re) => deps.log?.(`[email] roundtable ${r.p.job.panelist.slug}: could not release: ${errMsg(re)}`));
      outcomes.push({ kind: "signal-takeaway", slug: r.p.job.panelist.slug, status: "failed", subject, reason });
    }
    return result(outcomes);
  };

  let opener: string;
  try {
    opener = (await deps.compose({ panelist: chair, kind: "roundtable-opener", context: { date, signal, readerName: deps.readerName } })).body;
  } catch (e) {
    return releaseAll(`roundtable opener: ${errMsg(e)}`);
  }
  const text = assembleRoundtable(
    opener,
    reserved.map((r) => ({ panelist: r.p.job.panelist, body: r.p.composed!.body })),
    chair,
  );
  try {
    const res = await deps.sender.send({
      from: chair.from,
      to: deps.recipient,
      replyTo: deps.replyTo, // panel@: the chair writes on behalf of the panel (TF-DEC-83)
      subject,
      text,
      messageId,
      idempotencyKey: `roundtable/${date}`,
    });
    for (const r of reserved) {
      try {
        await deps.store.markSent(r.id, { resend_id: res.resendId, message_id: res.messageId });
      } catch (e) {
        deps.log?.(`[email] roundtable ${r.p.job.panelist.slug}: sent but the row was not updated: ${errMsg(e)}`);
      }
      outcomes.push({ kind: "signal-takeaway", slug: r.p.job.panelist.slug, status: "sent", subject, resend_id: res.resendId });
    }
    deps.log?.(`[email] roundtable ${date} from ${chair.slug}: sent (${res.resendId}), ${reserved.length} takeaways`);
    return result(outcomes);
  } catch (e) {
    return releaseAll(errMsg(e));
  }
}

/** A canned composer for tests and dry runs. */
export const mockComposer = composerFor(mockModel);
