/**
 * The live /api/ask event sequence (TH-46), factored out of the route so the
 * ordering is testable: retrieval(+notes) -> panelists -> factcheck -> ruling
 * -> saved -> done. `done` is emitted on every path, and a failed save never
 * blocks or hides the ruling (it is reported on the `saved` event).
 */
import type { Artifact } from "../retrieval";
import { describeError } from "../lib/errors";
import type { AskEvent, PanelSession } from "./sse";

export interface LiveDeps {
  retrieve: (question: string) => Promise<{ artifacts: Artifact[]; notes: string[] }>;
  runPanel: (o: { question: string; artifacts: Artifact[]; sessionId: string; emit: (ev: AskEvent) => void; signal?: AbortSignal }) => Promise<PanelSession>;
  saveSession: (session: PanelSession) => Promise<{ saved: boolean; note?: string }>;
  warn?: (msg: string) => void;
}

export async function runLive(
  o: { question: string; wantRetrieval: boolean; sessionId: string; emit: (ev: AskEvent) => void; signal?: AbortSignal },
  deps: LiveDeps,
): Promise<void> {
  const warn = deps.warn ?? (() => {});
  try {
    const { artifacts, notes } = o.wantRetrieval ? await deps.retrieve(o.question) : { artifacts: [], notes: [] };
    for (const n of notes) warn(`[ask] ${n}`);
    o.emit({ type: "retrieval", artifacts, notes });
    const session = await deps.runPanel({ question: o.question, artifacts, sessionId: o.sessionId, emit: o.emit, signal: o.signal });
    let saved: { saved: boolean; note?: string };
    try {
      saved = await deps.saveSession(session);
    } catch (err) {
      saved = { saved: false, note: `not saved: ${describeError(err)}` };
    }
    if (!saved.saved) warn(`[ask] ${saved.note}`);
    o.emit({ type: "saved", saved: saved.saved, ...(saved.note ? { note: saved.note } : {}) });
  } catch (err) {
    o.emit({ type: "error", message: err instanceof Error ? err.message : "The panel could not complete this session." });
  }
  o.emit({ type: "done", session_id: o.sessionId });
}
