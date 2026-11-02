/**
 * The two jobs (TH-31): the weekday cron (briefing, plus a cold open on Tue/Thu)
 * and Signal takeaways (all ten, one thread). Dependencies are injected so
 * tests and the dry-run CLI exercise exactly this code.
 */
import { signalSubject } from "./compose";
import { makeMessageId, type Sender } from "./send";
import type { EmailStore } from "./store";
import { centralDate, chairFor, coldOpenSenderFor, isColdOpenDay, isValidDate, isWeekend, weekdayOf } from "./rotation";
import type { Composer, EmailKind, EmailPanelist, SignalInput } from "./types";

export interface RunDeps {
  /** All ten, in EMAIL_ORDER. */
  panelists: EmailPanelist[];
  compose: Composer;
  sender: Sender;
  store: EmailStore;
  /** Recipient and Reply-To values; never logged. */
  recipient: string;
  replyTo: string;
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
  outcomes: Outcome[];
}

export interface SignalResult {
  edition_date: string;
  subject: string;
  outcomes: Outcome[];
}

export const SIGNAL_SPACING_MS = 2000;
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
    const composed = await deps.compose({ panelist: job.panelist, kind: job.kind, context: { date: job.date, signal: job.signal } });
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
      replyTo: deps.replyTo,
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

/** Weekday cron: briefing from today's chair; on Tue/Thu also the cold open. Weekends do nothing. */
export async function runDaily(now: Date, deps: RunDeps): Promise<DailyResult> {
  const date = centralDate(now);
  const weekday = weekdayOf(date);
  if (isWeekend(date)) return { date, weekday, skipped: "weekend", outcomes: [] };
  const order = deps.panelists.map((p) => p.slug);
  const jobs: Job[] = [{ kind: "briefing", panelist: bySlug(deps, chairFor(date, order)), date }];
  if (isColdOpenDay(date)) jobs.push({ kind: "cold-open", panelist: bySlug(deps, coldOpenSenderFor(date, order)), date });
  const outcomes: Outcome[] = [];
  for (const job of jobs) outcomes.push(await deliver(await prepare(job, deps), deps));
  return { date, weekday, outcomes };
}

export class SignalInputError extends Error {}

export const SIGNAL_TEXT_MAX = 200_000;

/** Validates the POST body: { subject: string, text: string, edition_date?: "YYYY-MM-DD" }. */
export function parseSignalBody(body: unknown): { subject: string; text: string; edition_date?: string } {
  if (!body || typeof body !== "object") throw new SignalInputError("body must be a JSON object");
  const b = body as Record<string, unknown>;
  const subject = typeof b.subject === "string" ? b.subject.replace(/[\r\n]+/g, " ").trim() : "";
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!subject) throw new SignalInputError("subject is required");
  if (subject.length > 300) throw new SignalInputError("subject is over 300 characters");
  if (!text) throw new SignalInputError("text is required");
  if (text.length > SIGNAL_TEXT_MAX) throw new SignalInputError(`text is over ${SIGNAL_TEXT_MAX} characters`);
  if (b.edition_date !== undefined) {
    if (typeof b.edition_date !== "string" || !isValidDate(b.edition_date)) throw new SignalInputError("edition_date must be YYYY-MM-DD");
    return { subject, text, edition_date: b.edition_date };
  }
  return { subject, text };
}

/**
 * Signal takeaways: every panelist, cast order, identical "Re: <subject>".
 * Composes run in parallel; sends go out one at a time, 2 seconds apart.
 * Idempotent on (signal-takeaway, edition_date, panelist_slug).
 */
export async function runSignal(input: { subject: string; text: string; edition_date?: string }, now: Date, deps: RunDeps): Promise<SignalResult> {
  const date = input.edition_date ?? centralDate(now);
  const signal: SignalInput = { subject: input.subject, text: input.text };
  const prepared = await Promise.all(deps.panelists.map((panelist) => prepare({ kind: "signal-takeaway", panelist, date, signal }, deps)));
  const sleep = deps.sleep ?? realSleep;
  const outcomes: Outcome[] = [];
  let sentBefore = false;
  for (const p of prepared) {
    if (!p.outcome && sentBefore) await sleep(SIGNAL_SPACING_MS);
    const o = await deliver(p, deps);
    if (o.status === "sent") sentBefore = true;
    outcomes.push(o);
  }
  return { edition_date: date, subject: signalSubject(input.subject), outcomes };
}
