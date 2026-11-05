/**
 * Reads docs/interviews/guide.md (TH-48) for the interview route (TH-49).
 *
 * What the panelist's prompt gets is deliberately limited: the fixed arc, the
 * shared Q6 briefing and the rules in force. The per-panelist interview-plan.md
 * (follow-ups, consistency tells, do-nots) is Myke's, not the panelist's; giving
 * it to the model would let the panelist read the test it is being given.
 * The arc is also returned as a list so the UI can offer the questions as chips.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { dossierSection } from "../cast/loader";

export interface InterviewGuide {
  /** The nine questions of the fixed arc, numbered text without the bold label. */
  arc: string[];
  /** Markdown of the sections the panelist is shown. */
  forPanelist: string;
}

function guidePath(): string {
  return join(process.cwd(), "docs", "interviews", "guide.md");
}

export function parseArc(section: string): string[] {
  return section
    .split("\n")
    .map((l) => l.match(/^\d+\.\s+(?:\*\*[^*]+\*\*\s*)?(.+)$/)?.[1]?.trim() ?? "")
    .filter(Boolean);
}

let cache: InterviewGuide | null = null;

export function loadGuide(): InterviewGuide {
  if (cache) return cache;
  const p = guidePath();
  if (!existsSync(p)) throw new Error("interview: docs/interviews/guide.md is missing (TH-48)");
  const md = readFileSync(p, "utf8");
  const arcSection = dossierSection(md, "The fixed arc");
  const briefing = dossierSection(md, "Briefing loaded before every interview");
  const rules = dossierSection(md, "Rules in force");
  const arc = parseArc(arcSection);
  if (arc.length < 9) throw new Error(`interview: expected 9 arc questions in guide.md, found ${arc.length}`);
  const forPanelist = [
    "## The interview arc",
    "The interviewer works through these questions, in this order, then two questions tailored to you. Expect them; do not recite or pre-empt them.",
    arcSection.trim(),
    "## Shared briefing for the midterm question",
    briefing.trim(),
    "## Rules in force",
    rules.trim(),
  ].join("\n\n");
  cache = { arc, forPanelist };
  return cache;
}
