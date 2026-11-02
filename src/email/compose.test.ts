import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bodyProblems,
  briefingSubject,
  cleanHook,
  coldOpenSubject,
  composeEmail,
  emailSystemPrompt,
  finalizeBody,
  mockModel,
  parseModelOutput,
  signalSubject,
  TAKEAWAY_OPENER,
  userPrompt,
  type EmailModel,
} from "./compose";
import { loadEmailPanelists, signature } from "./panelists";
import { SAMPLE_SIGNAL } from "./sample-signal";

const panel = loadEmailPanelists();
const delia = panel.find((p) => p.slug === "delia-marchetti")!;
const hart = panel.find((p) => p.slug === "hartford-caldwell")!;
const fixed = (text: string): EmailModel => async () => ({ text, stopReason: "end_turn" });
const LONG = "I keep coming back to one thing this morning. ".repeat(14).trim();

test("subject formats", () => {
  assert.equal(briefingSubject("Delia", "the tariff line that lands on page one"), "Morning note from Delia: the tariff line that lands on page one");
  assert.equal(coldOpenSubject("Hart"), "Hart: you should be looking at this");
  assert.equal(signalSubject("Faraday Signal: Nov 3"), "Re: Faraday Signal: Nov 3");
});

test("hook is cleaned to one line of at most eight words", () => {
  assert.equal(cleanHook('Hook: "Transformers, not turbines, set the date."'), "Transformers, not turbines, set the date");
  assert.equal(cleanHook("one two three four five six seven eight nine ten"), "one two three four five six seven eight");
  assert.equal(cleanHook("**Bold hook here today friends**\nsecond line"), "Bold hook here today friends");
});

test("briefing: hook parsed into the subject, body signed; cold open and signal subjects are fixed", async () => {
  const b = await composeEmail({ panelist: delia, kind: "briefing", context: { date: "2026-11-03" } }, fixed(`Hook: What the county will hear first\n\n${LONG}`));
  assert.equal(b.subject, "Morning note from Delia: What the county will hear first");
  assert.ok(b.body.startsWith("I keep coming back"));
  assert.ok(b.body.endsWith(`\n\n${signature(delia)}`));

  const c = await composeEmail({ panelist: hart, kind: "cold-open", context: { date: "2026-11-03" } }, fixed(LONG));
  assert.equal(c.subject, "Hart: you should be looking at this");

  for (const p of panel) {
    const s = await composeEmail({ panelist: p, kind: "signal-takeaway", context: { date: "2026-11-03", signal: SAMPLE_SIGNAL } }, fixed(LONG));
    assert.equal(s.subject, `Re: ${SAMPLE_SIGNAL.subject}`);
    assert.equal(s.body.split("\n")[0], TAKEAWAY_OPENER);
  }
});

test("briefing with no usable hook falls back to a dated hook, never an empty subject", async () => {
  const b = await composeEmail({ panelist: delia, kind: "briefing", context: { date: "2026-11-03" } }, fixed(LONG));
  assert.equal(b.subject, "Morning note from Delia: what matters on 2026-11-03");
});

test("signal takeaway opener is on its own line whether or not the model wrote it", () => {
  const withIt = finalizeBody("signal-takeaway", `${TAKEAWAY_OPENER} the transformer queue.\nMore.`, delia);
  assert.ok(withIt.startsWith(`${TAKEAWAY_OPENER}\nthe transformer queue.`));
  const without = finalizeBody("signal-takeaway", "The transformer queue.", delia);
  assert.ok(without.startsWith(`${TAKEAWAY_OPENER}\nThe transformer queue.`));
});

test("a model sign-off is dropped so the signature appears once", () => {
  const b = finalizeBody("cold-open", `${LONG}\n\nDelia`, delia);
  assert.equal(b, `${LONG}\n\n${signature(delia)}`);
});

test("hard-rule violations are retried once, then refused", async () => {
  let calls = 0;
  const flaky: EmailModel = async () => ({ text: calls++ === 0 ? "As an AI, I think\n- one\n- two" : LONG, stopReason: "end_turn" });
  const ok = await composeEmail({ panelist: delia, kind: "cold-open", context: { date: "2026-11-03" } }, flaky);
  assert.equal(calls, 2);
  assert.ok(ok.body.startsWith("I keep"));
  await assert.rejects(
    composeEmail({ panelist: delia, kind: "cold-open", context: { date: "2026-11-03" } }, fixed("- a list\n- of things")),
    /broke the email rules twice: contains a list/,
  );
  await assert.rejects(composeEmail({ panelist: delia, kind: "cold-open", context: { date: "2026-11-03" } }, async () => ({ text: "", stopReason: "refusal" })), /declined/);
  assert.deepEqual(bodyProblems("I am a fictional character."), ["forbidden phrase \\bfictional\\b"]);
});

test("prompts carry the voice from the cast files and the hard rules; the Signal goes in full", () => {
  const sys = emailSystemPrompt(delia);
  assert.ok(sys.includes(delia.voiceBrief));
  assert.ok(sys.includes("120 to 220 words"));
  assert.ok(sys.includes("(EST)"));
  assert.ok(sys.includes("Do not name real people"));
  const u = userPrompt("signal-takeaway", delia, { date: "2026-11-03", signal: SAMPLE_SIGNAL });
  assert.ok(u.includes(SAMPLE_SIGNAL.text));
  assert.throws(() => userPrompt("signal-takeaway", delia, { date: "2026-11-03" }), /needs context.signal/);
  assert.equal(parseModelOutput("cold-open", "Hook: x y z\n\nbody").hook, null);
});

test("TF_MOCK canned compose produces a marked placeholder for every panelist and kind", async () => {
  for (const p of panel) {
    for (const kind of ["briefing", "cold-open", "signal-takeaway"] as const) {
      const e = await composeEmail({ panelist: p, kind, context: { date: "2026-11-03", signal: SAMPLE_SIGNAL } }, mockModel);
      assert.ok(e.body.includes("TF_MOCK=1"), `${p.slug} ${kind}`);
      assert.ok(e.body.endsWith(signature(p)));
    }
  }
});
