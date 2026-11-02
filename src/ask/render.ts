/**
 * Pure helpers for rendering a reply with evidence badges and contested markers
 * (TH-32 §4.3). No React here so the segmentation is unit-testable.
 */
import type { EvidenceTag, FactcheckItem } from "./sse";

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "tag"; tag: EvidenceTag; title: string | null }
  | { kind: "contested"; text: string; item: FactcheckItem };

const TAG = /\[(VRF|SRC|EST|INF)(?::\s*([^\]]+))?\]/g;

function splitTags(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "tag", tag: m[1] as EvidenceTag, title: m[2]?.trim() ?? null });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Split a reply into text, tag badges and contested spans (claims the Fact-Checker downgraded). */
export function segmentReply(text: string, contested: FactcheckItem[]): Segment[] {
  const marks: { start: number; end: number; item: FactcheckItem }[] = [];
  const lower = text.toLowerCase();
  for (const item of contested) {
    const needle = item.claim.trim().toLowerCase();
    if (needle.length < 8) continue;
    const i = lower.indexOf(needle);
    if (i < 0) continue;
    const end = i + needle.length;
    if (marks.some((m) => i < m.end && end > m.start)) continue;
    marks.push({ start: i, end, item });
  }
  marks.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let cursor = 0;
  for (const m of marks) {
    if (m.start > cursor) out.push(...splitTags(text.slice(cursor, m.start)));
    out.push({ kind: "contested", text: text.slice(m.start, m.end), item: m.item });
    cursor = m.end;
  }
  if (cursor < text.length) out.push(...splitTags(text.slice(cursor)));
  return out;
}

export interface RulingParts {
  body: string;
  dissent: string | null;
  wouldChange: string | null;
}

/** Pull the two closing lines out of the ruling text. */
export function splitRuling(ruling: string): RulingParts {
  const lines = ruling.split("\n");
  let dissent: string | null = null;
  let wouldChange: string | null = null;
  const body: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^\**dissent on the record:?\**/i.test(t)) dissent = t.replace(/^\**dissent on the record:?\**\s*/i, "").trim();
    else if (/^\**what would change my mind:?\**/i.test(t)) wouldChange = t.replace(/^\**what would change my mind:?\**\s*/i, "").trim();
    else body.push(line);
  }
  return { body: body.join("\n").trim(), dissent, wouldChange };
}

export const TAG_LABEL: Record<EvidenceTag, string> = {
  VRF: "Verified against a retrieved primary source",
  SRC: "Sourced to a named document or publication",
  EST: "Estimate from sourced inputs, method stated",
  INF: "Inference, no direct source",
};
