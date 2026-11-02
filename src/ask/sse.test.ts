import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeEvent, parseEvents, eventsToSession, sessionToEvents, chunkText, type PanelSession, type AskEvent } from "./sse";
import { PANEL_ORDER } from "./roster";

const fixture = JSON.parse(readFileSync(join(process.cwd(), "src/cast/__fixtures__/mock-session.json"), "utf8")) as PanelSession;

test("SSE framing round-trips: session -> events -> wire -> events -> session", () => {
  const events = sessionToEvents(fixture, PANEL_ORDER);
  assert.equal(events[0].type, "retrieval");
  assert.equal(events.filter((e) => e.type === "panelist_start").length, 8);
  assert.equal(events.filter((e) => e.type === "panelist_end").length, 8);
  assert.equal(events.at(-1)?.type, "done");
  const wire = events.map(encodeEvent).join("");
  assert.match(wire, /^event: retrieval\ndata: \{/);
  const back = parseEvents(wire);
  assert.equal(back.length, events.length);
  const session = eventsToSession(back, { question: fixture.question });
  assert.deepEqual(session.replies, fixture.replies);
  assert.equal(session.ruling, fixture.ruling);
  assert.deepEqual(session.factcheck, fixture.factcheck);
  assert.equal(session.session_id, fixture.session_id);
  assert.equal(session.artifacts.length, fixture.artifacts.length);
});

test("the mock fixture carries eight replies, a factcheck and a ruling with the two closing lines", () => {
  assert.deepEqual(Object.keys(fixture.replies).sort(), [...PANEL_ORDER].sort());
  assert.ok(fixture.factcheck && fixture.factcheck.items.length >= 1);
  assert.match(fixture.ruling, /Dissent on the record:/);
  assert.match(fixture.ruling, /What would change my mind:/);
  for (const [slug, text] of Object.entries(fixture.replies)) {
    const words = text.trim().split(/\s+/).length;
    assert.ok(words >= 100 && words <= 240, `${slug} reply is ${words} words`);
    assert.match(text, /\[(VRF|SRC|EST|INF)/, `${slug} reply carries tags`);
  }
});

test("parseEvents tolerates a partial trailing frame and chunkText keeps every character", () => {
  const partial = encodeEvent({ type: "panelist_start", slug: "margo-brandt" }) + "event: panelist_delta\ndata: {\"slug\":";
  const evs: AskEvent[] = parseEvents(partial.slice(0, partial.lastIndexOf("\n\n") + 2));
  assert.deepEqual(evs, [{ type: "panelist_start", slug: "margo-brandt" }]);
  const text = "one two three four five six seven eight nine";
  assert.equal(chunkText(text, 4).join(""), text);
});
