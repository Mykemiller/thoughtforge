/**
 * Server-sent-event framing for /api/ask (TH-32 §4.1). Pure: no I/O.
 *
 * Wire format per event:  `event: <type>\ndata: <json>\n\n`
 */
import type { Artifact } from "../retrieval";

export type EvidenceTag = "VRF" | "SRC" | "EST" | "INF";

export interface FactcheckItem {
  panelist: string; // slug
  claim: string;
  tag_given: EvidenceTag;
  tag_should_be: EvidenceTag;
  note: string;
}

export interface Factcheck {
  items: FactcheckItem[];
  /** One-line verdict per panelist slug. */
  verdicts: Record<string, string>;
}

export type AskEvent =
  | { type: "retrieval"; artifacts: Artifact[] }
  | { type: "panelist_start"; slug: string }
  | { type: "panelist_delta"; slug: string; text: string }
  | { type: "panelist_end"; slug: string }
  | { type: "factcheck"; items: FactcheckItem[]; verdicts: Record<string, string> }
  | { type: "ruling_delta"; text: string }
  | { type: "ruling_end" }
  | { type: "error"; message: string }
  | { type: "done"; session_id: string };

export type AskEventType = AskEvent["type"];

/** One complete panel session, as the UI and the saver see it. */
export interface PanelSession {
  session_id: string;
  question: string;
  artifacts: Artifact[];
  /** slug -> full reply text, in the order replies finished. */
  replies: Record<string, string>;
  factcheck: Factcheck | null;
  ruling: string;
  error: string | null;
}

export function encodeEvent(ev: AskEvent): string {
  const { type, ...data } = ev;
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Parse a complete SSE text body (or any prefix of whole frames) back into events. */
export function parseEvents(text: string): AskEvent[] {
  const out: AskEvent[] = [];
  for (const frame of text.split(/\n\n/)) {
    if (!frame.trim()) continue;
    let type: string | null = null;
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!type) continue;
    const data = dataLines.length ? JSON.parse(dataLines.join("\n")) : {};
    out.push({ type, ...data } as AskEvent);
  }
  return out;
}

/** Fold a stream of events into a session. Tolerates partial streams. */
export function eventsToSession(events: AskEvent[], seed: Partial<PanelSession> = {}): PanelSession {
  const s: PanelSession = { session_id: "", question: "", artifacts: [], replies: {}, factcheck: null, ruling: "", error: null, ...seed };
  for (const ev of events) {
    switch (ev.type) {
      case "retrieval": s.artifacts = ev.artifacts; break;
      case "panelist_start": s.replies[ev.slug] = s.replies[ev.slug] ?? ""; break;
      case "panelist_delta": s.replies[ev.slug] = (s.replies[ev.slug] ?? "") + ev.text; break;
      case "panelist_end": break;
      case "factcheck": s.factcheck = { items: ev.items, verdicts: ev.verdicts }; break;
      case "ruling_delta": s.ruling += ev.text; break;
      case "ruling_end": break;
      case "error": s.error = ev.message; break;
      case "done": s.session_id = ev.session_id; break;
    }
  }
  return s;
}

/** Split text into word-sized chunks (used by the mock stream). */
export function chunkText(text: string, words = 4): string[] {
  const parts = text.split(/(\s+)/);
  const out: string[] = [];
  let buf = "";
  let count = 0;
  for (const p of parts) {
    buf += p;
    if (/\S/.test(p)) count++;
    if (count >= words) { out.push(buf); buf = ""; count = 0; }
  }
  if (buf) out.push(buf);
  return out;
}

/** Turn a finished session into the event sequence the live route would have emitted. */
export function sessionToEvents(s: PanelSession, order: readonly string[]): AskEvent[] {
  const ev: AskEvent[] = [{ type: "retrieval", artifacts: s.artifacts }];
  const slugs = order.filter((slug) => slug in s.replies);
  for (const slug of slugs) ev.push({ type: "panelist_start", slug });
  // Round-robin the deltas so the mock looks like eight concurrent streams.
  const chunks = new Map(slugs.map((slug) => [slug, chunkText(s.replies[slug])]));
  let any = true;
  while (any) {
    any = false;
    for (const slug of slugs) {
      const c = chunks.get(slug)!;
      if (c.length) { ev.push({ type: "panelist_delta", slug, text: c.shift()! }); any = true; }
    }
  }
  for (const slug of slugs) ev.push({ type: "panelist_end", slug });
  if (s.factcheck) ev.push({ type: "factcheck", items: s.factcheck.items, verdicts: s.factcheck.verdicts });
  for (const text of chunkText(s.ruling)) ev.push({ type: "ruling_delta", text });
  ev.push({ type: "ruling_end" });
  if (s.error) ev.push({ type: "error", message: s.error });
  ev.push({ type: "done", session_id: s.session_id });
  return ev;
}

/** Evidence tags in a reply, in order of appearance. */
export const TAG_RE = /\[(VRF|SRC|EST|INF)(?::\s*([^\]]+))?\]/g;
