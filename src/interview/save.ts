/**
 * Interview persistence (TH-49, TF-DEC-87). After every turn the whole session
 * is upserted to tf_sessions (kind = 'interview') and its transcript artifact
 * is written or refreshed in tf_artifacts, so a dropped connection loses at
 * most the reply in flight. Degrades: any failure is a note, never a throw.
 * The service client asserts the project of record before any write.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient, hasServiceEnv } from "../lib/supabase";
import { describeError } from "../lib/errors";
import { loadCast } from "../cast/loader";
import type { InterviewSession } from "./sse";
import { firstQuestion, interviewArtifactTitle, transcriptMarkdown } from "./transcript";

export function interviewTags(session: InterviewSession): string[] {
  return ["interview", `panelist:${session.panelist}`, `session:${session.session_id}`];
}

export async function saveInterview(session: InterviewSession, client?: SupabaseClient): Promise<{ saved: boolean; note?: string }> {
  if (!client && !hasServiceEnv()) return { saved: false, note: "not saved: Supabase env not set" };
  try {
    const member = loadCast().find((m) => m.slug === session.panelist);
    if (!member) throw new Error(`unknown panelist ${session.panelist}`);
    const sb = client ?? getServiceClient();
    const now = new Date().toISOString();
    const row = {
      id: session.session_id,
      kind: "interview",
      panelist: session.panelist,
      asked_at: session.started_at,
      updated_at: now,
      question: firstQuestion(session.transcript),
      retrieved_artifact_ids: session.artifacts.filter((a) => a.origin === "tf_artifacts").map((a) => a.id),
      replies: {},
      factcheck: null,
      ruling: "",
      transcript: session.transcript,
      model_versions: session.model_versions,
    };
    const s = await sb.from("tf_sessions").upsert(row, { onConflict: "id" });
    if (s.error) throw s.error;

    const body = transcriptMarkdown({
      displayName: member.persona.display_name,
      role: member.persona.role,
      slug: member.slug,
      sessionId: session.session_id,
      startedAt: session.started_at,
      transcript: session.transcript,
    });
    const tags = interviewTags(session);
    const existing = await sb.from("tf_artifacts").select("id").contains("tags", [`session:${session.session_id}`]).limit(1);
    if (existing.error) throw existing.error;
    const artifact = {
      title: interviewArtifactTitle(member.persona.display_name, session.started_at),
      publisher: "ThoughtForge",
      url: null,
      published_at: session.started_at.slice(0, 10),
      body,
      source: "panel",
      idf_domains: member.persona.idf_domains.map((d) => d.code),
      tags,
      created_by: "thoughtforge",
    };
    const id = existing.data?.[0]?.id as string | undefined;
    const a = id ? await sb.from("tf_artifacts").update(artifact).eq("id", id) : await sb.from("tf_artifacts").insert(artifact);
    if (a.error) throw a.error;
    return { saved: true };
  } catch (err) {
    return { saved: false, note: `not saved: ${describeError(err)}` };
  }
}
