/**
 * POST /api/ask (TH-32 §4.1): streams one panel session as text/event-stream.
 * Body: { question: string, retrieval?: boolean } (retrieval defaults to true).
 * Gated by middleware.ts (TF_ACCESS_KEY). TF_MOCK=1 replays the fixture.
 */
import { NextResponse, type NextRequest } from "next/server";
import { retrieve } from "@/src/retrieval";
import { encodeEvent, type AskEvent, type PanelSession } from "@/src/ask/sse";
import { hasAnthropicKey, modelVersions, runPanel } from "@/src/ask/orchestrate";
import { isMock, runMock } from "@/src/ask/mock";
import { acquire, release } from "@/src/ask/inflight";
import { saveSession } from "@/src/ask/save";
import { LIMITS } from "@/src/ask/roster";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  let body: { question?: unknown; retrieval?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { question, retrieval? }" }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });
  if (question.length > LIMITS.questionMaxChars) {
    return NextResponse.json({ error: `question is over ${LIMITS.questionMaxChars} characters` }, { status: 400 });
  }
  const wantRetrieval = body.retrieval === undefined ? true : Boolean(body.retrieval);

  const key = req.cookies.get("tf_access")?.value ?? "anonymous";
  if (!acquire(key)) return NextResponse.json({ error: "One question at a time; a panel session is already running." }, { status: 429 });

  const encoder = new TextEncoder();
  const sessionId = crypto.randomUUID();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (ev: AskEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(ev)));
        } catch {
          closed = true;
        }
      };
      try {
        let session: PanelSession;
        if (isMock()) {
          session = await runMock(question, emit);
          emit({ type: "done", session_id: session.session_id });
        } else if (!hasAnthropicKey()) {
          emit({ type: "error", message: "ANTHROPIC_API_KEY is not set on this deployment, so the panel cannot convene. Set TF_MOCK=1 to demo with the canned session." });
          emit({ type: "done", session_id: sessionId });
        } else {
          const { artifacts, notes } = wantRetrieval ? await retrieve(question) : { artifacts: [], notes: [] };
          for (const n of notes) console.warn(`[ask] ${n}`);
          emit({ type: "retrieval", artifacts });
          session = await runPanel({ question, artifacts, sessionId, emit, signal: req.signal });
          emit({ type: "done", session_id: sessionId });
          const saved = await saveSession(session, modelVersions());
          if (!saved.saved) console.warn(`[ask] ${saved.note}`);
        }
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "The panel could not complete this session." });
        emit({ type: "done", session_id: sessionId });
      } finally {
        release(key);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      }
    },
    cancel() {
      release(key);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
