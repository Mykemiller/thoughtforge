/**
 * Every completed panel session is itself an artifact (TH-32 §5).
 * Writes tf_sessions (the full session) and a tf_artifacts row with
 * source = 'panel' so later panels can cite the ruling as [SRC].
 * Degrades: any failure is returned as a note, never thrown.
 */
import { getServiceClient, hasServiceEnv } from "../lib/supabase";
import type { PanelSession } from "./sse";
import { PANEL_ORDER } from "./roster";
import { loadCast } from "../cast/loader";

export function panelArtifactTitle(question: string): string {
  return `Panel ruling: ${question.trim().slice(0, 80)}`;
}

export function panelArtifactBody(session: PanelSession): string {
  const names = new Map(loadCast().map((m) => [m.slug, m.persona.display_name]));
  const replies = PANEL_ORDER.filter((s) => s in session.replies).map((s) => `## ${names.get(s) ?? s}\n${session.replies[s]}`);
  return [`# Ruling\n${session.ruling}`, ...replies].join("\n\n");
}

export async function saveSession(session: PanelSession, modelVersions: Record<string, string>): Promise<{ saved: boolean; note?: string }> {
  if (!hasServiceEnv()) return { saved: false, note: "not saved: Supabase env not set" };
  try {
    const sb = getServiceClient();
    const sessionRow = {
      id: session.session_id,
      asked_at: new Date().toISOString(),
      question: session.question,
      retrieved_artifact_ids: session.artifacts.filter((a) => a.origin === "tf_artifacts").map((a) => a.id),
      replies: session.replies,
      factcheck: session.factcheck,
      ruling: session.ruling,
      model_versions: modelVersions,
    };
    const s = await sb.from("tf_sessions").insert(sessionRow);
    if (s.error) throw s.error;
    const a = await sb.from("tf_artifacts").insert({
      title: panelArtifactTitle(session.question),
      publisher: "ThoughtForge",
      url: null,
      published_at: new Date().toISOString().slice(0, 10),
      body: panelArtifactBody(session),
      source: "panel",
      idf_domains: [],
      tags: ["panel-ruling", `session:${session.session_id}`],
      created_by: "thoughtforge",
    });
    if (a.error) throw a.error;
    return { saved: true };
  } catch (err) {
    return { saved: false, note: `not saved: ${err instanceof Error ? err.message : String(err)}` };
  }
}
