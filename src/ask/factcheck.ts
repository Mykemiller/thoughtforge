/** Parse the Fact-Checker's JSON output defensively (TH-32 §4.1 step 2; TH-45 repair + degraded flag). */
import type { EvidenceTag, Factcheck, FactcheckItem } from "./sse";

const TAGS: EvidenceTag[] = ["VRF", "SRC", "EST", "INF"];
const asTag = (v: unknown): EvidenceTag | null => (typeof v === "string" && TAGS.includes(v.toUpperCase() as EvidenceTag) ? (v.toUpperCase() as EvidenceTag) : null);

/**
 * Close a JSON text that was cut off mid-stream (TH-45, D3).
 *
 * A string-aware bracket-stack scan records "safe cut points": places where
 * everything before is a complete value or key/value pair. The text is cut at
 * the last one and the still-open containers are closed in reverse order, so a
 * dangling key, colon, comma or half-written string is dropped rather than
 * patched. Objects inside arrays (the fact-check items) are atomic: an item is
 * kept only if its closing brace arrived.
 *
 * Returns the repaired text, or null when there is no safe point. If the root
 * value is already closed, the text up to that close is returned unchanged.
 */
export function repairTruncatedJson(text: string): string | null {
  const stack: string[] = []; // "{" | "["
  const expectKey: boolean[] = []; // parallel to stack; meaningful for "{"
  let inString = false;
  let escape = false;
  let stringIsKey = false;
  let safe: { at: number; stack: string } | null = null;

  const safeStack = () => {
    const lastArr = stack.lastIndexOf("[");
    return lastArr === -1 || lastArr === stack.length - 1;
  };
  const mark = (at: number) => {
    if (safeStack()) safe = { at, stack: stack.join("") };
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') {
        inString = false;
        if (!stringIsKey) mark(i + 1);
      }
      continue;
    }
    switch (ch) {
      case '"': {
        inString = true;
        const top = stack.length - 1;
        stringIsKey = top >= 0 && stack[top] === "{" && expectKey[top];
        break;
      }
      case "{":
      case "[":
        stack.push(ch);
        expectKey.push(ch === "{");
        mark(i + 1);
        break;
      case "}":
      case "]":
        stack.pop();
        expectKey.pop();
        if (stack.length === 0) return text.slice(0, i + 1);
        mark(i + 1);
        break;
      case ":":
        if (stack.length) expectKey[stack.length - 1] = false;
        break;
      case ",":
        mark(i);
        if (stack.length && stack[stack.length - 1] === "{") expectKey[stack.length - 1] = true;
        break;
      default:
        break;
    }
  }
  if (!safe) return null;
  const { at, stack: open } = safe as { at: number; stack: string };
  const closers = [...open].reverse().map((c) => (c === "{" ? "}" : "]")).join("");
  return text.slice(0, at) + closers;
}

const unavailable = (why: string, len: number) => `Fact-check unavailable: ${why} (grader output ${len} chars).`;

export function parseFactcheck(raw: string, slugs: readonly string[]): Factcheck {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const verdicts: Record<string, string> = {};
  const items: FactcheckItem[] = [];
  if (start < 0) {
    for (const s of slugs) verdicts[s] = unavailable("the grader returned no structured output", raw.length);
    return { items, verdicts, degraded: true, reason: "no_output" };
  }
  let parsed: unknown;
  let repaired = false;
  try {
    if (end <= start) throw new Error("unterminated");
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    const fixed = repairTruncatedJson(raw.slice(start));
    try {
      if (fixed === null) throw new Error("unrepairable");
      parsed = JSON.parse(fixed);
      repaired = true;
    } catch {
      for (const s of slugs) verdicts[s] = unavailable("the grader's output could not be parsed", raw.length);
      return { items, verdicts, degraded: true, reason: "parse_failed" };
    }
  }
  const obj = (parsed ?? {}) as { verdicts?: Record<string, unknown>; items?: unknown[] };
  for (const s of slugs) {
    const v = obj.verdicts?.[s];
    if (typeof v === "string" && v.trim()) verdicts[s] = v.trim();
    else verdicts[s] = repaired ? unavailable("the grader's output was cut off before this verdict", raw.length) : "No verdict returned.";
  }
  for (const it of Array.isArray(obj.items) ? obj.items : []) {
    const x = (it ?? {}) as Record<string, unknown>;
    const panelist = typeof x.panelist === "string" ? x.panelist : "";
    const given = asTag(x.tag_given);
    const should = asTag(x.tag_should_be);
    if (!slugs.includes(panelist) || !given || !should || given === should) continue;
    items.push({ panelist, claim: String(x.claim ?? "").slice(0, 300), tag_given: given, tag_should_be: should, note: String(x.note ?? "").slice(0, 300) });
  }
  return repaired ? { items, verdicts, degraded: true, reason: "repaired" } : { items, verdicts };
}
