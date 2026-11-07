/**
 * Show notes (TH-37 deliverable 5): Markdown with the title, three signal bullets with source links, Constance
 * Wright's evidence grade per signal (grade only, never prose), the on-mic cast and the selection rationale.
 * Her grades live here, not in the audio.
 */
import type { SelectedSignal } from "./select-signals";
import type { Grades } from "./grade-signals";
import type { CastSlot } from "./select-cast";

export interface ShowNotesInput {
  show: string;
  title: string;
  episode_id: string;
  digest_date: string;
  signals: SelectedSignal[];
  grades: Grades;
  cast: CastSlot[];
  castNames: Record<string, string>; // slug -> display name
  castRationale: string[];
  selectionRule: string;
  considered: number;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function renderShowNotes(i: ShowNotesInput): string {
  const lines: string[] = [`# ${i.title}`, "", `${i.show} · ${i.episode_id} · digest of ${i.digest_date}`, "", "## Signals discussed", ""];
  for (const s of i.signals) {
    const link = s.source_url ? `[${oneLine(s.title)}](${s.source_url})` : oneLine(s.title);
    const grade = i.grades.grades[s.signal_id];
    lines.push(`- ${link}${s.publisher ? `, ${s.publisher}` : ""}. Evidence grade (Constance Wright): ${grade ?? "ungraded"}.`);
  }
  if (i.grades.degraded) lines.push("", `_Grading note: ${i.grades.reason ?? "degraded"}; ungraded signals are marked._`);
  lines.push("", "## On mic", "");
  for (const c of i.cast) lines.push(`- ${i.castNames[c.slug] ?? c.slug} (${c.role === "chair" ? "chair" : "voice"})`);
  lines.push("", "## How these signals were chosen", "", `From ${i.considered} signals in the ${i.digest_date} digest: ${i.selectionRule}.`, "");
  for (const s of i.signals) lines.push(`${s.rank}. ${oneLine(s.title)} — ${s.rationale}`);
  lines.push("", "Cast: " + i.castRationale.join("; ") + ".", "");
  return lines.join("\n");
}
