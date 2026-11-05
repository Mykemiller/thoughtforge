/**
 * Event framing for /api/interview (TH-49). Pure: no I/O.
 * Reuses encodeEvent / parseEvents from src/ask/sse.ts; one turn streams one reply.
 */
import type { Artifact } from "../retrieval";

export type InterviewRole = "user" | "assistant";

export interface InterviewMessage {
  role: InterviewRole;
  content: string;
}

export type InterviewEvent =
  | { type: "retrieval"; artifacts: Artifact[] }
  | { type: "reply_delta"; text: string }
  | { type: "reply_end" }
  | { type: "error"; message: string }
  | { type: "done"; session_id: string; saved: boolean };

/** One interview as the UI, the saver and the export see it. */
export interface InterviewSession {
  session_id: string;
  panelist: string; // slug
  started_at: string; // ISO
  transcript: InterviewMessage[];
  /** Every artifact any turn retrieved, deduped by id. */
  artifacts: Artifact[];
  model_versions: Record<string, string>;
}

/** Fold one turn's events into the reply text. Tolerates partial streams. */
export function eventsToReply(events: InterviewEvent[]): { text: string; artifacts: Artifact[]; error: string | null; session_id: string | null } {
  let text = "";
  let artifacts: Artifact[] = [];
  let error: string | null = null;
  let session_id: string | null = null;
  for (const ev of events) {
    switch (ev.type) {
      case "retrieval": artifacts = ev.artifacts; break;
      case "reply_delta": text += ev.text; break;
      case "reply_end": break;
      case "error": error = ev.message; break;
      case "done": session_id = ev.session_id; break;
    }
  }
  return { text, artifacts, error, session_id };
}

export function mergeArtifacts(existing: Artifact[], incoming: Artifact[]): Artifact[] {
  const seen = new Set(existing.map((a) => a.id));
  const out = [...existing];
  for (const a of incoming) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}
