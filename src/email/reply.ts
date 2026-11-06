/**
 * The reply loop (TH-47, Week 3 of TF-DEC-47 pulled forward): the reader writes back to a
 * panelist, the same panelist answers in the same thread. Single panelist only: no Gilbert
 * ruling, no Constance pass, the same shape as the 1:1 interview room (TH-49).
 *
 * Idempotent on the inbound Resend email id (tf_email_inbound.resend_email_id is unique),
 * so a re-delivered webhook never sends a second reply.
 */
import { makeMessageId, type Sender } from "./send";
import { bareAddress } from "./panelists";
import { centralDate } from "./rotation";
import type { EmailStore, InboundStore, StoredEmail, ThreadStore } from "./store";
import type { Composer, EmailPanelist, ThreadMessage } from "./types";

/** A received email as the route hands it over (fetched from Resend, never trusted from the webhook body alone). */
export interface InboundMessage {
  /** Resend's id for the received email. */
  id: string;
  from: string;
  to: string[];
  subject: string;
  text: string | null;
  html: string | null;
  headers: Record<string, string> | null;
  /** The Message-ID header of the received email. */
  messageId: string;
  /** ISO timestamp from Resend. */
  receivedAt: string;
}

export interface ReplyDeps {
  panelists: EmailPanelist[];
  compose: Composer;
  sender: Sender;
  store: EmailStore;
  threads: ThreadStore;
  inbound: InboundStore;
  readerName?: string;
  /** Loop guard: replies per thread per US Central day. */
  maxRepliesPerThreadPerDay: number;
  log?: (line: string) => void;
}

export interface ReplyOutcome {
  status: "sent" | "ignored" | "failed";
  slug?: string;
  thread_key?: string;
  resend_id?: string;
  reason?: string;
}

export const DEFAULT_MAX_REPLIES_PER_THREAD_PER_DAY = 6;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Header lookup that ignores case. */
export function header(headers: Record<string, string> | null | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

/** Every <message-id> in In-Reply-To and References, most recent first. */
export function referencedIds(headers: Record<string, string> | null | undefined): string[] {
  const ids = new Set<string>();
  for (const name of ["In-Reply-To", "References"]) {
    for (const m of (header(headers, name) ?? "").matchAll(/<[^<>\s]+>/g)) ids.add(m[0]);
  }
  return [...ids];
}

/** Quoted history and signatures cut from a reply, so only the new words reach the thread. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^On .+ wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim())) break;
    if (/^From:\s.+$/.test(line.trim()) && out.length) break;
    if (/^--\s*$/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Finds the outbound email this message answers, by its threading headers. */
export async function findRoot(headers: Record<string, string> | null | undefined, threads: ThreadStore): Promise<StoredEmail | null> {
  for (const id of referencedIds(headers)) {
    const row = await threads.findByMessageId(id);
    if (row) return row;
  }
  return null;
}

/** The thread as the panelist sees it: outbound and inbound rows merged, oldest first, ending with this message. */
export async function buildThread(threadKey: string, msg: InboundMessage, readerName: string, deps: ReplyDeps): Promise<ThreadMessage[]> {
  const nameOf = new Map(deps.panelists.map((p) => [p.slug, p.name]));
  const outbound = (await deps.threads.threadMessages(threadKey)).map((r) => ({
    author: nameOf.get(r.panelist_slug) ?? r.panelist_slug,
    side: "panelist" as const,
    date: r.created_at ?? `${r.send_date}T00:00:00Z`,
    text: r.body,
  }));
  const inbound = (await deps.inbound.threadMessages(threadKey))
    .filter((r) => r.resend_email_id !== msg.id)
    .map((r) => ({ author: readerName, side: "reader" as const, date: r.received_at ?? "", text: r.raw_text ?? "" }));
  const all = [...outbound, ...inbound].sort((a, b) => a.date.localeCompare(b.date));
  all.push({ author: readerName, side: "reader", date: msg.receivedAt, text: stripQuotedReply(msg.text ?? "") });
  return all.map((m) => ({ ...m, date: m.date.slice(0, 10) }));
}

/**
 * Answers one inbound reply as `panelist`. `root` is the outbound email it answers when the
 * headers named one; otherwise the reader started the thread by writing to the panelist's address.
 */
export async function runReply(msg: InboundMessage, panelist: EmailPanelist, root: StoredEmail | null, now: Date, deps: ReplyDeps): Promise<ReplyOutcome> {
  const date = centralDate(now);
  const readerName = deps.readerName?.trim() || "Myke";
  const threadKey = root ? (root.thread_key ?? root.message_id ?? msg.messageId) : msg.messageId;
  try {
    if (root && !root.thread_key && root.message_id) await deps.threads.setThreadKey(root.id, threadKey);
    const today = await deps.threads.countReplies(threadKey, date);
    if (today >= deps.maxRepliesPerThreadPerDay) {
      await deps.inbound.insert(inboundRow(msg, "ignored", `reply cap ${deps.maxRepliesPerThreadPerDay}/day reached`, threadKey));
      return { status: "ignored", slug: panelist.slug, thread_key: threadKey, reason: "reply cap reached" };
    }
    await deps.inbound.insert(inboundRow(msg, "accepted", `reply:${panelist.slug}`, threadKey));
  } catch (e) {
    return { status: "failed", slug: panelist.slug, thread_key: threadKey, reason: errMsg(e) };
  }

  let composed: { subject: string; body: string };
  try {
    const thread = await buildThread(threadKey, msg, readerName, deps);
    composed = await deps.compose({ panelist, kind: "reply", context: { date, thread, replySubject: msg.subject, readerName } });
  } catch (e) {
    return { status: "failed", slug: panelist.slug, thread_key: threadKey, reason: errMsg(e) };
  }

  const messageId = makeMessageId();
  let reservation: { id: string } | null;
  try {
    reservation = await deps.store.reserve({
      kind: "reply",
      send_date: date,
      panelist_slug: panelist.slug,
      subject: composed.subject,
      body: composed.body,
      resend_id: null,
      message_id: messageId,
      in_reply_to: msg.messageId,
      thread_key: threadKey,
    });
  } catch (e) {
    return { status: "failed", slug: panelist.slug, thread_key: threadKey, reason: errMsg(e) };
  }
  if (!reservation) return { status: "ignored", slug: panelist.slug, thread_key: threadKey, reason: "already answered" };
  try {
    const chain = [...referencedIds(msg.headers).reverse(), msg.messageId].filter((id, i, a) => a.indexOf(id) === i);
    const res = await deps.sender.send({
      from: panelist.from,
      to: bareAddress(msg.from),
      replyTo: panelist.replyTo,
      subject: composed.subject,
      text: composed.body,
      messageId,
      inReplyTo: msg.messageId,
      references: chain,
      idempotencyKey: `reply/${msg.id}`,
    });
    try {
      await deps.store.markSent(reservation.id, { resend_id: res.resendId, message_id: res.messageId });
    } catch (e) {
      deps.log?.(`[email] reply ${panelist.slug}: sent but the row was not updated: ${errMsg(e)}`);
    }
    deps.log?.(`[email] reply ${panelist.slug}: sent (${res.resendId}) in thread ${threadKey}`);
    return { status: "sent", slug: panelist.slug, thread_key: threadKey, resend_id: res.resendId };
  } catch (e) {
    await deps.store.release(reservation.id).catch(() => undefined);
    return { status: "failed", slug: panelist.slug, thread_key: threadKey, reason: errMsg(e) };
  }
}

export function inboundRow(msg: InboundMessage, status: "accepted" | "ignored" | "gmail-confirmation" | "error", note: string | null, threadKey: string | null) {
  return {
    resend_email_id: msg.id,
    from_address: bareAddress(msg.from),
    subject: msg.subject,
    status,
    note,
    message_id: msg.messageId || null,
    in_reply_to: referencedIds(msg.headers)[0] ?? null,
    thread_key: threadKey,
    raw_text: msg.text ? stripQuotedReply(msg.text) : null,
  };
}
