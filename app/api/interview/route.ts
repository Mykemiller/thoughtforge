/**
 * POST /api/interview (TH-49): streams one 1:1 interview turn as text/event-stream.
 * Body: {
 *   slug: string,                       // panelist
 *   transcript: { role, content }[],    // whole conversation so far; last turn is the interviewer's
 *   session_id?: uuid,                  // omit on the first turn; echoed back in `done`
 *   started_at?: ISO,                   // first turn's timestamp, echoed by the client afterwards
 *   prior_artifacts?: Artifact[],       // what earlier turns retrieved, so the saved session keeps them
 *   retrieval?: boolean                 // default true
 * }
 * Gated by proxy.ts (TF_ACCESS_KEY). TF_MOCK=1 streams a canned reply and saves nothing.
 * The whole session is upserted after every reply (src/interview/save.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { retrieve, type Artifact } from "@/src/retrieval";
import { encodeEvent } from "@/src/ask/sse";
import { hasAnthropicKey } from "@/src/ask/orchestrate";
import { isMock } from "@/src/ask/mock";
import { acquire, release } from "@/src/ask/inflight";
import { getMember } from "@/src/cast/load";
import { interviewModelVersions, runInterviewTurn, validateTranscript } from "@/src/interview/run";
import { runMockTurn } from "@/src/interview/mock";
import { saveInterview } from "@/src/interview/save";
import { mergeArtifacts, type InterviewEvent, type InterviewSession } from "@/src/interview/sse";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<Response> {
  let body: { slug?: unknown; transcript?: unknown; session_id?: unknown; started_at?: unknown; prior_artifacts?: unknown; retrieval?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { slug, transcript, session_id?, started_at?, prior_artifacts?, retrieval? }" }, { status: 400 });
  }
  const slug = typeof body.slug === "string" ? body.slug : "";
  const member = slug ? getMember(slug) : undefined;
  if (!member) return NextResponse.json({ error: "slug must name a panelist" }, { status: 400 });
  let transcript;
  try {
    transcript = validateTranscript(body.transcript);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "transcript is invalid" }, { status: 400 });
  }
  if (body.session_id !== undefined && !(typeof body.session_id === "string" && UUID.test(body.session_id))) {
    return NextResponse.json({ error: "session_id must be a UUID" }, { status: 400 });
  }
  const sessionId = (body.session_id as string | undefined) ?? crypto.randomUUID();
  const startedAt = typeof body.started_at === "string" && !Number.isNaN(Date.parse(body.started_at)) ? new Date(body.started_at).toISOString() : new Date().toISOString();
  const priorArtifacts = Array.isArray(body.prior_artifacts) ? (body.prior_artifacts as Artifact[]).filter((a) => a && typeof a.id === "string") : [];
  const wantRetrieval = body.retrieval === undefined ? true : Boolean(body.retrieval);
  const latest = transcript[transcript.length - 1].content;

  const key = req.cookies.get("tf_access")?.value ?? "anonymous";
  if (!acquire(key)) return NextResponse.json({ error: "One turn at a time; the panelist is still answering." }, { status: 429 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (ev: InterviewEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(ev)));
        } catch {
          closed = true;
        }
      };
      try {
        if (isMock()) {
          await runMockTurn(member, latest, emit);
          emit({ type: "done", session_id: sessionId, saved: false });
        } else if (!hasAnthropicKey()) {
          emit({ type: "error", message: "ANTHROPIC_API_KEY is not set on this deployment, so the panelist cannot answer. Set TF_MOCK=1 to demo." });
          emit({ type: "done", session_id: sessionId, saved: false });
        } else {
          const { artifacts, notes } = wantRetrieval ? await retrieve(latest) : { artifacts: [], notes: [] };
          for (const n of notes) console.warn(`[interview] ${n}`);
          emit({ type: "retrieval", artifacts });
          const reply = await runInterviewTurn({ member, transcript, artifacts, emit, signal: req.signal });
          const session: InterviewSession = {
            session_id: sessionId,
            panelist: member.slug,
            started_at: startedAt,
            transcript: [...transcript, { role: "assistant", content: reply }],
            artifacts: mergeArtifacts(priorArtifacts, artifacts),
            model_versions: interviewModelVersions(),
          };
          const saved = await saveInterview(session);
          if (!saved.saved) {
            console.warn(`[interview] ${saved.note}`);
            emit({ type: "error", message: `This turn was not saved: ${saved.note ?? "unknown reason"}` });
          }
          emit({ type: "done", session_id: sessionId, saved: saved.saved });
        }
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "The interview turn could not complete." });
        emit({ type: "done", session_id: sessionId, saved: false });
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
