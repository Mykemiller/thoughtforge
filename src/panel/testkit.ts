/** Shared fixtures for the /api/panel tests and scripts/make-panel-fixtures.ts. No network, no model. */
import { chunkText, sessionToEvents } from "../ask/sse";
import { loadMockSession } from "../ask/mock";
import { PANEL_ORDER } from "../ask/roster";
import type { LiveDeps } from "../ask/live";
import type { JoinClient } from "./join";
import type { PanelBody } from "./schema";

export const CONVERSATION_ID = "0b7e1c52-6a43-4c1e-9d0a-5f3b2a7e8c11";
export const TOKEN = "test-token-not-a-secret";

const mock = loadMockSession();

/** Three context items reusing the mock session's artifact titles, so the recorded replies' tags stay consistent. */
export const sampleContext = (): PanelBody["context"] =>
  mock.artifacts.slice(0, 3).map((a, i) => ({
    n: i + 1,
    title: a.title,
    publisher: a.publisher ?? "",
    url: a.url,
    date: a.published_at,
    label: (["verified", "verified", "sourced"] as const)[i],
    excerpt: a.excerpt,
  }));

export function sampleBody(over: Partial<PanelBody> = {}): PanelBody {
  return {
    mode: "join",
    question: "Should the first two halls commit to 800 VDC now, or wait until 2027?",
    conversation: [
      { speaker: "user", text: "We are weighing 800 VDC for the first two halls." },
      { speaker: "mach-eigen", text: "The busbar math favors DC at that density, but vendor depth is thin." },
    ],
    context: sampleContext(),
    panelists: ["margo-brandt", "albert-thorne", "constance-wright"],
    settings: { horizon: 2, lens: "buildability" },
    source: "live_agent",
    conversation_id: CONVERSATION_ID,
    ...over,
  };
}

export const JOIN_REPLIES: Record<string, string> = {
  "margo-brandt":
    "Buildability first. The rectifier shelves and the DC busbar become the critical path, and that is a vendor-count problem {{c:3}}. {{read}}I expect lead times to stay long through 2026.{{/read}} Mach is right on the copper, but I would not commit both halls until a second vendor ships at volume.",
  "albert-thorne":
    "The tariff does not care what voltage runs inside the fence; the interconnection study cares about load shape and ramp {{c:2}}. {{read}}Flat profiles will likely keep moving up the queue.{{/read}} I would settle the study first and the standard second.",
};

export const JOIN_FACTCHECK = JSON.stringify({
  verdicts: {
    host: "Sound on the copper; vendor depth is asserted without a citation.",
    "margo-brandt": "Citation checks out; the lead-time sentence is correctly marked as her read.",
    "albert-thorne": "Citation checks out; the queue sentence is correctly marked as his read.",
  },
  items: [{ panelist: "host", claim: "The busbar math favors DC at that density", tag_given: "INF", tag_should_be: "EST", note: "A calculation with no method stated is an estimate at best." }],
});

type Script = { replies: Record<string, string>; factcheck: string; failFor?: string[]; refuseFor?: string[]; failFactcheck?: boolean };

/** A scripted stand-in for the Anthropic client. Records every request it receives in `calls`. */
export function fakeJoinClient(script: Script = { replies: JOIN_REPLIES, factcheck: JOIN_FACTCHECK }) {
  const calls: { kind: "stream" | "create"; params: Record<string, unknown> }[] = [];
  const client: JoinClient = {
    messages: {
      stream(params) {
        calls.push({ kind: "stream", params: params as unknown as Record<string, unknown> });
        const system = String((params as { system?: unknown }).system ?? "");
        const slug = Object.keys(script.replies).find((s) => system.includes(`# You are ${nameFor(s)},`)) ?? "";
        let cb: (t: string) => void = () => {};
        return {
          on(_e, f) {
            cb = f;
            return this;
          },
          async finalMessage() {
            if (script.failFor?.includes(slug)) throw new Error("529 overloaded_error: upstream detail that must never reach a user");
            if (script.refuseFor?.includes(slug)) return { stop_reason: "refusal" };
            for (const c of chunkText(script.replies[slug] ?? "", 4)) cb(c);
            return { stop_reason: "end_turn" };
          },
        };
      },
      async create(params) {
        calls.push({ kind: "create", params: params as unknown as Record<string, unknown> });
        if (script.failFactcheck) throw new Error("500 api_error: upstream detail");
        return { content: [{ type: "text", text: script.factcheck }] };
      },
    },
  };
  return { client, calls };
}

import { loadCast } from "../cast/loader";
const names = new Map(loadCast().map((m) => [m.slug, m.persona.display_name]));
const nameFor = (slug: string) => names.get(slug) ?? slug;

/** convene stand-in: replays the mock session through the real event shape, with the retrieved artifacts the caller supplied. */
export function fakeConveneDeps(saved: { sessions: unknown[]; tagsSeen: (string[] | undefined)[] }): Partial<LiveDeps> {
  return {
    runPanel: async (o) => {
      const session = { ...mock, question: o.question, session_id: o.sessionId, artifacts: o.artifacts };
      for (const ev of sessionToEvents(session, [...PANEL_ORDER])) if (ev.type !== "retrieval" && ev.type !== "done") o.emit(ev);
      return session;
    },
    saveSession: async (s) => {
      saved.sessions.push(s);
      return { saved: true };
    },
    warn: () => {},
  };
}
