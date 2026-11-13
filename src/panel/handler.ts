/**
 * POST /api/panel (FDY-345): the Live Agent bridge. Server-to-server, NOT behind the TF_ACCESS_KEY gate (not in
 * GATED_PREFIXES, not in proxy.ts's matcher): authenticated by `Authorization: Bearer <LA_PANEL_TOKEN>`, compared via
 * SHA-256 hashes in constant time. Auth runs before the body is read.
 *
 *  - LA_PANEL_TOKEN unset  -> 503
 *  - token missing / wrong -> 401, empty body
 *  - bad body              -> 400 { error, issues }
 *  - one panel call at a time per conversation (429)
 * The stream uses /api/ask's wire format and event names so one client parser serves both modes.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { acquire, release } from "../ask/inflight";
import { hasAnthropicKey } from "../ask/orchestrate";
import { isMock } from "../ask/mock";
import { encodeEvent, parseEvents, type AskEvent } from "../ask/sse";
import { queryKeyMatches } from "../lib/access";
import type { LiveDeps } from "../ask/live";
import { runConvene } from "./convene";
import { runJoin, type JoinClient } from "./join";
import { parsePanelBody, type PanelBody } from "./schema";

export interface PanelDeps {
  /** Replaces the Anthropic client for join (tests). */
  joinClient?: () => JoinClient;
  /** Overrides for convene's runPanel / saveSession / retrieve (tests). */
  live?: Partial<LiveDeps>;
  /** Delay between replayed deltas under TF_MOCK=1 (default 12 ms; tests pass 0). */
  mockDelayMs?: number;
}

export const inflightKey = (conversationId: string) => `la:${conversationId}`;

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1].trim() : null;
}

const json = (status: number, payload: unknown) => Response.json(payload, { status });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** TF_MOCK=1: replay the committed recording for the requested mode (fixtures/panel/<mode>.sse). */
async function replayFixture(mode: PanelBody["mode"], emit: (ev: AskEvent) => void, delayMs = 12): Promise<void> {
  const text = readFileSync(joinPath(process.cwd(), "fixtures", "panel", `${mode}.sse`), "utf8");
  for (const ev of parseEvents(text)) {
    emit(ev);
    if (ev.type === "panelist_delta" || ev.type === "ruling_delta") await sleep(delayMs);
    if (ev.type === "factcheck") await sleep(delayMs * 20);
  }
}

export async function handlePanel(req: Request, deps: PanelDeps = {}): Promise<Response> {
  const token = process.env.LA_PANEL_TOKEN;
  if (!token) return json(503, { error: "The panel bridge is not configured." });
  if (!(await queryKeyMatches(bearer(req), token))) {
    return new Response(null, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { error: "Body must be JSON." });
  }
  const parsed = parsePanelBody(raw);
  if (!parsed.ok) return json(400, { error: "Invalid body.", issues: parsed.issues });
  const body = parsed.body;

  const key = inflightKey(body.conversation_id);
  if (!acquire(key)) return json(429, { error: "A panel call is already running for this conversation." });

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
        if (isMock()) {
          await replayFixture(body.mode, emit, deps.mockDelayMs);
        } else if (!hasAnthropicKey()) {
          emit({ type: "error", message: "ANTHROPIC_API_KEY is not set on this deployment, so the panel cannot convene. Set TF_MOCK=1 to demo with the canned session." });
          emit({ type: "done", session_id: sessionId });
        } else if (body.mode === "join") {
          await runJoin({ body, emit, signal: req.signal, client: deps.joinClient ? deps.joinClient() : (new Anthropic() as unknown as JoinClient) });
          emit({ type: "done", session_id: sessionId });
        } else {
          await runConvene({ body, sessionId, emit, signal: req.signal }, deps.live);
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
