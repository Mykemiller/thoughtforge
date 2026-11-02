/** Parse the Fact-Checker's JSON output defensively (TH-32 §4.1 step 2). */
import type { EvidenceTag, Factcheck, FactcheckItem } from "./sse";

const TAGS: EvidenceTag[] = ["VRF", "SRC", "EST", "INF"];
const asTag = (v: unknown): EvidenceTag | null => (typeof v === "string" && TAGS.includes(v.toUpperCase() as EvidenceTag) ? (v.toUpperCase() as EvidenceTag) : null);

export function parseFactcheck(raw: string, slugs: readonly string[]): Factcheck {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const verdicts: Record<string, string> = {};
  const items: FactcheckItem[] = [];
  if (start < 0 || end <= start) {
    for (const s of slugs) verdicts[s] = "Fact-check unavailable: the grader returned no structured output.";
    return { items, verdicts };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    for (const s of slugs) verdicts[s] = "Fact-check unavailable: the grader's output could not be parsed.";
    return { items, verdicts };
  }
  const obj = (parsed ?? {}) as { verdicts?: Record<string, unknown>; items?: unknown[] };
  for (const s of slugs) {
    const v = obj.verdicts?.[s];
    verdicts[s] = typeof v === "string" && v.trim() ? v.trim() : "No verdict returned.";
  }
  for (const it of Array.isArray(obj.items) ? obj.items : []) {
    const x = (it ?? {}) as Record<string, unknown>;
    const panelist = typeof x.panelist === "string" ? x.panelist : "";
    const given = asTag(x.tag_given);
    const should = asTag(x.tag_should_be);
    if (!slugs.includes(panelist) || !given || !should || given === should) continue;
    items.push({ panelist, claim: String(x.claim ?? "").slice(0, 300), tag_given: given, tag_should_be: should, note: String(x.note ?? "").slice(0, 300) });
  }
  return { items, verdicts };
}
