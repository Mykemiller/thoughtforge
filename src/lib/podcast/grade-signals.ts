/**
 * Constance Wright's evidence grade per signal (TH-37 deliverable 5). She is off-mic: this is the fact-check pass
 * run over the three selected signals, and only the grade comes back (no prose), for show notes.
 * Uses the same persona prompt, model and levers as the /api/ask Fact-Checker (src/ask/orchestrate.ts factcheckRequest):
 * claude-sonnet-5-5, no thinking field, effort high.
 */
import { composeSystemPrompt } from "../../cast/prompt";
import type { CastMember, SharedSkills } from "../../cast/types";
import { LIMITS } from "../../ask/roster";
import { PODCAST_MODELS, type Llm } from "./llm";
import type { SelectedSignal } from "./select-signals";

export type Grade = "VRF" | "SRC" | "EST" | "INF";
export interface Grades {
  grades: Record<string, Grade | null>;
  degraded: boolean;
  reason: string | null;
}

const TAGS: Grade[] = ["VRF", "SRC", "EST", "INF"];

export function parseGrades(raw: string, ids: string[]): Grades {
  const grades: Record<string, Grade | null> = Object.fromEntries(ids.map((id) => [id, null]));
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { grades, degraded: true, reason: "no_json" };
  let obj: unknown;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return { grades, degraded: true, reason: "unparseable" };
  }
  const g = (obj as { grades?: Record<string, unknown> }).grades ?? {};
  for (const id of ids) {
    const v = typeof g[id] === "string" ? (g[id] as string).toUpperCase() : "";
    if ((TAGS as string[]).includes(v)) grades[id] = v as Grade;
  }
  const missing = ids.filter((id) => !grades[id]);
  return { grades, degraded: missing.length > 0, reason: missing.length ? `ungraded: ${missing.length}` : null };
}

export async function gradeSignals(llm: Llm, constance: CastMember, shared: SharedSkills, signals: SelectedSignal[]): Promise<Grades> {
  const ids = signals.map((s) => s.signal_id);
  const system = composeSystemPrompt(constance, shared, {
    artifacts: signals.map((s) => ({ title: s.title, publisher: s.publisher, published_at: null, excerpt: s.summary ?? s.title, source: "secondary" as const })),
    turnInstructions: `## This turn\nYou are grading the signals below, not panel replies. For each signal give one evidence grade for the claim as stated: VRF verified against a primary source, SRC sourced to a named publication, EST an estimate or projection, INF an inference with no direct source. A projection is never SRC.\nReturn ONLY compact JSON, no prose: {"grades":{${ids.map((i) => `"${i}":"<VRF|SRC|EST|INF>"`).join(",")}}}`,
  });
  const user = signals.map((s) => `- ${s.signal_id}: ${s.title}${s.publisher ? ` (${s.publisher})` : ""}${s.source_url ? ` ${s.source_url}` : ""}\n  ${s.summary ?? ""}`).join("\n");
  try {
    const raw = await llm({
      model: PODCAST_MODELS.factcheck, effort: LIMITS.factcheckEffort, maxTokens: 800, system, user: `## Signals\n${user}`,
      meta: { tag: "grade", speaker: constance.slug, target: 0 },
    });
    return parseGrades(raw, ids);
  } catch (err) {
    return { grades: Object.fromEntries(ids.map((id) => [id, null])), degraded: true, reason: `api_error: ${err instanceof Error ? err.message.slice(0, 120) : "unknown"}` };
  }
}
