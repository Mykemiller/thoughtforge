import { test } from "node:test";
import assert from "node:assert/strict";
import { runLive, type LiveDeps } from "./live";
import { eventsToSession, parseEvents, encodeEvent, type AskEvent } from "./sse";
import { loadMockSession } from "./mock";

const base = (over: Partial<LiveDeps> = {}): LiveDeps => ({
  retrieve: async () => ({ artifacts: [], notes: ["source A unavailable: Invalid API key"] }),
  runPanel: async (o) => { o.emit({ type: "panelist_start", slug: "x" }); o.emit({ type: "factcheck", items: [], verdicts: {} }); o.emit({ type: "ruling_end" }); return loadMockSession(); },
  saveSession: async () => ({ saved: true }),
  ...over,
});
async function run(deps: LiveDeps): Promise<AskEvent[]> {
  const ev: AskEvent[] = [];
  await runLive({ question: "q", wantRetrieval: true, sessionId: "sid", emit: (e) => ev.push(e) }, deps);
  return ev;
}

test("order: retrieval, panel, factcheck, ruling, saved, done", async () => {
  const ev = await run(base());
  assert.deepEqual(ev.map((e) => e.type), ["retrieval", "panelist_start", "factcheck", "ruling_end", "saved", "done"]);
  assert.deepEqual((ev[0] as { notes: string[] }).notes, ["source A unavailable: Invalid API key"]);
});

test("failed save is reported, never blocks done; thrown save too", async () => {
  const warns: string[] = [];
  const ev = await run(base({ saveSession: async () => ({ saved: false, note: "not saved: Invalid API key" }), warn: (m) => warns.push(m) }));
  assert.deepEqual(ev.slice(-2), [{ type: "saved", saved: false, note: "not saved: Invalid API key" }, { type: "done", session_id: "sid" }]);
  assert.ok(warns.some((w) => w.includes("not saved")));
  const t = await run(base({ saveSession: async () => { throw { message: "Invalid API key" }; } }));
  assert.match((t.at(-2) as { note: string }).note, /Invalid API key/);
});

test("done is emitted even when the panel throws", async () => {
  const ev = await run(base({ runPanel: async () => { throw new Error("model down"); } }));
  assert.deepEqual(ev.slice(-2).map((e) => e.type), ["error", "done"]);
});

test("session fold handles new events and old streams without them", () => {
  const s = eventsToSession([
    { type: "retrieval", artifacts: [], notes: ["n1"] },
    { type: "saved", saved: false, note: "not saved: x" },
  ]);
  assert.deepEqual(s.retrievalNotes, ["n1"]);
  assert.deepEqual(s.save, { saved: false, note: "not saved: x" });
  const old = eventsToSession([{ type: "retrieval", artifacts: [] }, { type: "done", session_id: "a" }]);
  assert.deepEqual(old.retrievalNotes, []);
  assert.equal(old.save, null);
  const round = parseEvents(encodeEvent({ type: "saved", saved: true }));
  assert.deepEqual(round, [{ type: "saved", saved: true }]);
});
