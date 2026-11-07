/**
 * Episode assembly (TH-37): selection -> roster -> script -> grades -> show notes -> a tf_episodes row.
 * Pure orchestration over injected pieces (rows, history, llm, audit), so the CLI and the tests share one path.
 */
import type { CastMember, SharedSkills } from "../../cast/types";
import { generateScript, type AuditResult, type Attempt } from "./generate-script";
import { gradeSignals, type Grades } from "./grade-signals";
import type { Llm } from "./llm";
import type { EpisodeScript } from "./script-schema";
import { parseCastOverride, selectCast, type CastSelection, type EpisodeHistory } from "./select-cast";
import { DOMAIN_NAMES, selectSignals, type DigestSignalRow, type SelectionResult } from "./select-signals";
import { renderShowNotes } from "./show-notes";

export const DEFAULT_SHOW = "The ThoughtForge Panel";

export interface TfEpisodeRow {
  episode_id: string;
  show: string;
  title: string;
  digest_date: string;
  status: "scripted" | "failed";
  cast: CastSelection["cast"];
  signals: Record<string, unknown>;
  script: EpisodeScript | null;
  show_notes_md: string | null;
  word_count: number | null;
  target_minutes: number | null;
}

export interface BuildInput {
  digest_date: string; // YYYY-MM-DD
  nn: string; // "01"
  show?: string;
  rows: DigestSignalRow[];
  history?: EpisodeHistory[];
  castOverride?: string;
  members: CastMember[];
  shared: SharedSkills;
  llm: Llm;
  audit?: (script: EpisodeScript) => AuditResult;
  log?: (msg: string) => void;
}
export interface BuildOutput {
  row: TfEpisodeRow;
  selection: SelectionResult;
  castSelection: CastSelection;
  grades: Grades | null;
  attempts: Attempt[];
}

export const episodeId = (digestDate: string, nn: string) => `PP-${digestDate.replaceAll("-", "")}-${nn.padStart(2, "0")}`;

function longDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function episodeTitle(digestDate: string, domains: (string | null)[]): string {
  const names = [...new Set(domains.filter((x): x is string => Boolean(x)))];
  return `${longDate(digestDate)}: ${names.length ? names.join(", ") : "The Daily Signal Digest"}`;
}

export async function buildEpisode(i: BuildInput): Promise<BuildOutput> {
  const show = i.show ?? DEFAULT_SHOW;
  const selection = selectSignals(i.rows);
  if (selection.selected.length < 3) throw new Error(`digest ${i.digest_date} has ${i.rows.length} signals; need at least 3 to build an episode`);
  const castSelection = i.castOverride
    ? parseCastOverride(i.castOverride, i.members.map((m) => m.slug))
    : selectCast(selection.selected.map((s) => s.idf_domain_code), i.history ?? []);
  const id = episodeId(i.digest_date, i.nn);
  const title = episodeTitle(i.digest_date, selection.selected.map((s) => s.idf_domain_code ? DOMAIN_NAMES[s.idf_domain_code] : s.idf_domain));
  const signalsJson = { rule: selection.rule, considered: selection.considered, selected: selection.selected, cast_rationale: castSelection.rationale };

  const gen = await generateScript({
    episode_id: id, show, title, digest_date: i.digest_date, signals: selection.selected, cast: castSelection.cast,
    members: i.members, shared: i.shared, llm: i.llm, audit: i.audit, log: i.log,
  });
  if (gen.status === "failed" || !gen.script) {
    return {
      row: { episode_id: id, show, title, digest_date: i.digest_date, status: "failed", cast: castSelection.cast, signals: { ...signalsJson, failure: { reason: gen.reason, attempts: gen.attempts } }, script: null, show_notes_md: null, word_count: gen.word_count, target_minutes: null },
      selection, castSelection, grades: null, attempts: gen.attempts,
    };
  }
  const constance = i.members.find((m) => m.slug === "constance-wright") as CastMember;
  const grades = await gradeSignals(i.llm, constance, i.shared, selection.selected);
  const castNames = Object.fromEntries(i.members.map((m) => [m.slug, m.persona.display_name]));
  const notes = renderShowNotes({
    show, title, episode_id: id, digest_date: i.digest_date, signals: selection.selected, grades, cast: castSelection.cast, castNames,
    castRationale: castSelection.rationale, selectionRule: selection.rule, considered: selection.considered,
  });
  return {
    row: {
      episode_id: id, show, title, digest_date: i.digest_date, status: "scripted", cast: castSelection.cast,
      signals: { ...signalsJson, grades: grades.grades, grading: grades.degraded ? { degraded: true, reason: grades.reason } : { degraded: false } },
      script: gen.script, show_notes_md: notes, word_count: gen.script.word_count,
      target_minutes: Math.round((gen.script.word_count / 150) * 10) / 10,
    },
    selection, castSelection, grades, attempts: gen.attempts,
  };
}

