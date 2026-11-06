/**
 * Inbound mail (TH-47): Resend receives on panel.faraday-thoughtforge.com and posts an
 * email.received webhook to POST /api/email/inbound. This module verifies the webhook
 * (Svix signature, RESEND_WEBHOOK_SECRET), fetches the full message from Resend (the
 * webhook body is never trusted for content), classifies it, and dispatches:
 *
 *   digest             the forwarded Faraday Daily Signal Digest -> stored raw, then the ten takeaways
 *   gmail-confirmation Gmail's forwarding confirmation -> stored, body logged for Myke
 *   reply              the reader answering a panelist -> that panelist replies (reply.ts)
 *   ignored            everything else -> one row, no send
 *
 * Every non-failure returns 200 so Resend does not retry; 5xx only on a real failure.
 */
import { Webhook } from "svix";
import { bareAddress, panelistByAddress, SENDING_DOMAIN } from "./panelists";
import { findRoot, inboundRow, type InboundMessage, type ReplyDeps, type ReplyOutcome, runReply } from "./reply";
import { centralDate, chairFor } from "./rotation";
import { runSignal, type RunDeps, type SignalResult } from "./run";
import type { DigestStore } from "./store";
import type { EmailPanelist, SignalMode } from "./types";

export const DIGEST_SENDER = "signals@faraday-intelligence.ai";
export const DIGEST_SUBJECT_PREFIX = "Faraday Daily Signal Digest";
export const GMAIL_FORWARDING_SENDER = "forwarding-noreply@google.com";
/** Resend's signed timestamp may not be older than this. */
export const WEBHOOK_TOLERANCE_S = 5 * 60;

// ---------- webhook ----------

export class WebhookError extends Error {}

export interface WebhookHeaders {
  "svix-id": string;
  "svix-timestamp": string;
  "svix-signature": string;
}

export function svixHeaders(h: { get(name: string): string | null }): WebhookHeaders | null {
  const id = h.get("svix-id");
  const ts = h.get("svix-timestamp");
  const sig = h.get("svix-signature");
  if (!id || !ts || !sig) return null;
  return { "svix-id": id, "svix-timestamp": ts, "svix-signature": sig };
}

export interface ReceivedEvent {
  type: string;
  data?: { email_id?: string };
}

/** Verifies the Svix signature and timestamp, then parses the event. Throws WebhookError. */
export function verifyWebhook(rawBody: string, headers: WebhookHeaders | null, secret: string | undefined, now: Date = new Date()): ReceivedEvent {
  if (!secret) throw new WebhookError("RESEND_WEBHOOK_SECRET is not set");
  if (!headers) throw new WebhookError("missing svix headers");
  const ts = Number(headers["svix-timestamp"]);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > WEBHOOK_TOLERANCE_S) throw new WebhookError("stale webhook timestamp");
  try {
    // svix 2.x verify() throws on a bad signature and returns nothing; the body is parsed after it passes.
    new Webhook(secret).verify(rawBody, headers);
  } catch (e) {
    throw new WebhookError(`bad webhook signature: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    return JSON.parse(rawBody) as ReceivedEvent;
  } catch {
    throw new WebhookError("webhook body is not JSON");
  }
}

// ---------- classification ----------

export type Classification =
  | { kind: "digest"; subject: string; editionDate: string; signalCount: number | null; originalFrom: string }
  | { kind: "gmail-confirmation" }
  /** panelist is the one the To address names; null when only the threading headers identify the thread (the caller resolves from the root row). */
  | { kind: "reply"; panelist: EmailPanelist | null; rootMessageId: string | null }
  | { kind: "ignored"; reason: string };

/** "Fwd: Fwd: X" -> "X". */
export const stripForwardPrefix = (subject: string) => subject.replace(/^(\s*(?:fwd?|fw)\s*:\s*)+/i, "").trim();

/** The original sender when Gmail wrapped the message as a forward: the first "From:" line in the body. */
export function forwardedFrom(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/^\s*From:\s*(.+)$/m);
  return m ? bareAddress(m[1]) : null;
}

/** "... · 2026-11-01" at the end of the subject; else the given fallback date. */
export function editionDateOf(subject: string, fallback: string): string {
  const m = subject.match(/(\d{4}-\d{2}-\d{2})\s*$/);
  return m ? m[1] : fallback;
}

/** "— 37 signals" anywhere in the subject. */
export function signalCountOf(subject: string): number | null {
  const m = subject.match(/(\d+)\s+signals?\b/i);
  return m ? Number(m[1]) : null;
}

export interface ClassifyOptions {
  panelists: EmailPanelist[];
  /** Lower-cased addresses allowed to talk to the panel. */
  replyAllowlist: string[];
  /** US Central date of the webhook, the edition-date fallback. */
  today: string;
  /** The outbound email a reply's headers point at, if the caller found one. */
  rootMessageId?: string | null;
}

export function classify(msg: InboundMessage, opt: ClassifyOptions): Classification {
  const from = bareAddress(msg.from);
  if (from === GMAIL_FORWARDING_SENDER) return { kind: "gmail-confirmation" };
  if (from.endsWith(`@${SENDING_DOMAIN}`)) return { kind: "ignored", reason: "mail from the panel's own sending domain" };
  if (/auto-?reply|out of (the )?office|automatic reply/i.test(msg.subject)) return { kind: "ignored", reason: "auto-reply" };

  const subject = stripForwardPrefix(msg.subject);
  const originalFrom = from === DIGEST_SENDER ? from : forwardedFrom(msg.text);
  if (originalFrom === DIGEST_SENDER && subject.startsWith(DIGEST_SUBJECT_PREFIX)) {
    return { kind: "digest", subject, editionDate: editionDateOf(subject, opt.today), signalCount: signalCountOf(subject), originalFrom };
  }

  const addressed = msg.to.map((t) => panelistByAddress(opt.panelists, t)).find(Boolean) ?? null;
  if (opt.rootMessageId || addressed) {
    if (!opt.replyAllowlist.includes(from)) return { kind: "ignored", reason: `sender ${from} is not on the reply allowlist` };
    return { kind: "reply", panelist: addressed, rootMessageId: opt.rootMessageId ?? null };
  }
  return { kind: "ignored", reason: "not a Signal Digest and not a reply to a panelist" };
}

// ---------- handler ----------

export interface InboundDeps {
  fetchEmail: (id: string) => Promise<InboundMessage>;
  run: RunDeps;
  reply: ReplyDeps;
  digests: DigestStore;
  replyAllowlist: string[];
  signalMode: SignalMode;
  now: () => Date;
  log?: (line: string) => void;
}

export type InboundResult =
  | { status: "digest"; digest_date: string; signal: SignalResult }
  | { status: "gmail-confirmation" }
  | { status: "reply"; outcome: ReplyOutcome }
  | { status: "ignored"; reason: string }
  | { status: "duplicate" }
  | { status: "unhandled-event"; type: string };

/** Handles one verified email.received event end to end. */
export async function handleReceived(event: ReceivedEvent, deps: InboundDeps): Promise<InboundResult> {
  if (event.type !== "email.received" || !event.data?.email_id) return { status: "unhandled-event", type: event.type };
  const id = event.data.email_id;
  if (await deps.reply.inbound.seen(id)) return { status: "duplicate" };
  const msg = await deps.fetchEmail(id);
  const now = deps.now();
  const today = centralDate(now);

  const root = await findRoot(msg.headers, deps.reply.threads);
  const c = classify(msg, { panelists: deps.run.panelists, replyAllowlist: deps.replyAllowlist, today, rootMessageId: root?.message_id ?? null });

  switch (c.kind) {
    case "gmail-confirmation": {
      await deps.reply.inbound.insert(inboundRow(msg, "gmail-confirmation", "Gmail forwarding confirmation; body logged", null));
      // Myke needs the confirmation link or code; it is not a secret of ours.
      deps.log?.(`[email:inbound] Gmail forwarding confirmation received at ${today}. Body follows.\n${msg.text ?? "(no text body)"}`);
      return { status: "gmail-confirmation" };
    }
    case "digest": {
      const text = msg.text ?? "";
      await deps.digests.upsert({
        digest_date: c.editionDate,
        subject: c.subject,
        signal_count: c.signalCount,
        source_message_id: msg.messageId || null,
        raw_html: msg.html,
        raw_text: text,
      });
      await deps.reply.inbound.insert(inboundRow(msg, "accepted", `digest:${c.editionDate}`, null));
      const signal = await runSignal({ subject: c.subject, text, edition_date: c.editionDate, mode: deps.signalMode }, now, deps.run);
      return { status: "digest", digest_date: c.editionDate, signal };
    }
    case "reply": {
      // The thread's panelist wins over the address written to, so a forwarded reply still reaches the right voice.
      const order = deps.run.panelists.map((p) => p.slug);
      // A roundtable email's ten rows share one Message-ID; its chair answers for the panel.
      const rootSlug = root ? (root.subject.startsWith("Panel roundtable:") ? chairFor(root.send_date, order) : root.panelist_slug) : null;
      const panelist = (rootSlug && deps.run.panelists.find((p) => p.slug === rootSlug)) || c.panelist;
      if (!panelist) {
        await deps.reply.inbound.insert(inboundRow(msg, "ignored", "reply to an unknown panelist", null));
        return { status: "ignored", reason: "reply to an unknown panelist" };
      }
      const outcome = await runReply(msg, panelist, root, now, deps.reply);
      return { status: "reply", outcome };
    }
    case "ignored": {
      await deps.reply.inbound.insert(inboundRow(msg, "ignored", c.reason, null));
      return { status: "ignored", reason: c.reason };
    }
  }
}
