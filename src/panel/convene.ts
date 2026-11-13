/**
 * `convene` (FDY-345): the full panel via runLive. Live Agent's context stands in for retrieval, mapped to the Artifact
 * shape in order. `origin: "faraday"` keeps the `la:` ids out of tf_sessions.retrieved_artifact_ids (uuid[]). The
 * session is saved with the Live Agent tags so it can be found again.
 */
import type { Artifact } from "../retrieval";
import { runLive, type LiveDeps } from "../ask/live";
import { modelVersions, runPanel } from "../ask/orchestrate";
import { saveSession } from "../ask/save";
import type { AskEvent } from "../ask/sse";
import type { ContextItem, PanelBody } from "./schema";

export function toArtifacts(context: ContextItem[], conversationId: string): Artifact[] {
  return context.map((c) => ({
    id: `la:${conversationId}:${c.n}`,
    title: c.title,
    publisher: c.publisher || null,
    url: c.url,
    published_at: c.date,
    excerpt: c.excerpt,
    source: c.label === "verified" ? "primary" : "secondary",
    origin: "faraday",
  }));
}

export const conveneTags = (conversationId: string) => ["source:live_agent", `conversation:${conversationId}`];

export function conveneDeps(body: PanelBody, over: Partial<LiveDeps> = {}): LiveDeps {
  const artifacts = toArtifacts(body.context, body.conversation_id);
  return {
    retrieve: async () => ({ artifacts, notes: [] }),
    runPanel,
    saveSession: (sess) => saveSession(sess, modelVersions(), undefined, conveneTags(body.conversation_id)),
    warn: (m) => console.warn(m),
    ...over,
  };
}

export async function runConvene(o: { body: PanelBody; sessionId: string; emit: (ev: AskEvent) => void; signal?: AbortSignal }, over: Partial<LiveDeps> = {}): Promise<void> {
  await runLive({ question: o.body.question, wantRetrieval: true, sessionId: o.sessionId, emit: o.emit, signal: o.signal }, conveneDeps(o.body, over));
}
