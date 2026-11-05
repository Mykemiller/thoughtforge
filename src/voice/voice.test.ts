import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_SPOKEN_CHARS, SentenceBuffer, spokenText, splitSentences } from "./sentences";
import { pickVoice, VoiceError } from "./resolve";
import { PANEL } from "../data/panel";

test("spokenText drops evidence tags and markdown but keeps the words", () => {
  const s = spokenText("At 1 MW per rack you have a busbar problem [SRC: OCP spec]. **Start** there [INF].");
  assert.equal(s, "At 1 MW per rack you have a busbar problem. Start there.");
});

test("splitSentences splits on terminal punctuation and keeps closing quotes", () => {
  assert.deepEqual(splitSentences('I started in Tacoma. "The deck lies," he said. Why? Because.'), ["I started in Tacoma.", '"The deck lies," he said.', "Why?", "Because."]);
});

test("SentenceBuffer emits whole sentences from deltas, merges short ones, and flushes the tail", () => {
  const b = new SentenceBuffer();
  const out: string[] = [];
  for (const d of ["Where I ", "started was Tacoma. My father ", "kept the cranes running [SRC: dossier]. Yes. ", "That taught me the physical world does not care about the slide deck"]) out.push(...b.push(d));
  out.push(...b.flush());
  assert.deepEqual(out, ["Where I started was Tacoma.", "My father kept the cranes running.", "Yes. That taught me the physical world does not care about the slide deck"]);
  for (const s of out.slice(0, -1)) assert.ok(s.length >= MIN_SPOKEN_CHARS || s === out[out.length - 1]);
  assert.deepEqual(b.flush(), []);
});

test("pickVoice needs exactly one exact-name match", () => {
  const voices = [
    { voice_id: "a", name: "Gil Faraday" },
    { voice_id: "b", name: "Gil Faraday " },
    { voice_id: "c", name: "Sarah - Mature, Reassuring, Confident" },
  ];
  assert.equal(pickVoice(voices, "Sarah - Mature, Reassuring, Confident").voice_id, "c");
  assert.throws(() => pickVoice(voices, "Gil Faraday"), (e: unknown) => e instanceof VoiceError && e.code === "ambiguous");
  assert.throws(() => pickVoice(voices, "Nobody"), (e: unknown) => e instanceof VoiceError && e.code === "missing");
});

test("the manifest names voices for the two custom and three proposed panelists and nothing is an id", () => {
  const named = PANEL.filter((m) => m.elevenLabsVoiceName);
  assert.deepEqual(
    named.map((m) => m.slug).sort(),
    ["albert-thorne", "gilbert-faraday", "ingrid-halverson", "mach-eigen", "margo-brandt"],
  );
  for (const m of named) assert.ok(!/^[A-Za-z0-9]{20}$/.test(m.elevenLabsVoiceName!), `${m.slug} carries an id, not a name`);
  const names = named.map((m) => m.elevenLabsVoiceName);
  assert.equal(new Set(names).size, names.length, "two panelists share a voice");
});
