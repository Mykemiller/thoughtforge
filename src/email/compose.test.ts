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
  replySubject,
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

test("opener rule and reader name are in every persona system prompt; length rule follows the kind", () => {
  for (const kind of ["briefing", "cold-open", "signal-takeaway", "reply"] as const) {
    const sys = emailSystemPrompt(delia, kind);
    assert.ok(sys.includes("## Opener"), `${kind} lacks the opener rule`);
    assert.ok(sys.includes("Use the reader's first name once"));
    assert.ok(!sys.includes("Do not open with a greeting that names anyone"));
  }
  assert.ok(emailSystemPrompt(delia, "reply").includes("80 to 200 words"));
  assert.ok(emailSystemPrompt(delia, "roundtable-opener").includes("At most 60 words"));
});

test("briefing prompt: with a digest it names the edition and asks the opener to; without one it never mentions the missing digest (TH-66)", () => {
  const withDigest = userPrompt("briefing", delia, { date: "2026-11-05", signal: { ...SAMPLE_SIGNAL, editionDate: "2026-11-05" } });
  assert.match(withDigest, /edition 2026-11-05/);
  assert.match(withDigest, /Your opener names that edition/);
  assert.ok(withDigest.includes(SAMPLE_SIGNAL.text));
  assert.match(withDigest, /note to Myke/);
  const without = userPrompt("briefing", delia, { date: "2026-11-05" });
  assert.doesNotMatch(without, /No Signal Digest has landed/);
  assert.doesNotMatch(without, /says so plainly/);
  assert.match(without, /Pick the one thing that matters most this morning/);
  assert.match(userPrompt("cold-open", delia, { date: "2026-11-05", readerName: "Sam" }), /writing to Sam unprompted/);
});

test("reply prompt carries the thread oldest first with the reader's name, and the reply subject never stacks Re:", async () => {
  const thread = [
    { author: "Delia Marchetti", side: "panelist" as const, date: "2026-11-05", text: "My note." },
    { author: "Myke", side: "reader" as const, date: "2026-11-05", text: "Why that order?" },
  ];
  const p = userPrompt("reply", delia, { date: "2026-11-05", thread, replySubject: "Re: Morning note from Delia: x" });
  assert.ok(p.indexOf("Delia Marchetti wrote on 2026-11-05") < p.indexOf("Myke wrote on 2026-11-05"));
  assert.match(p, /acknowledges what Myke said/);
  assert.equal(replySubject("Re: Morning note from Delia: x"), "Re: Morning note from Delia: x");
  assert.equal(replySubject("Morning note from Delia: x"), "Re: Morning note from Delia: x");
  assert.equal(replySubject("Fwd: Re: Faraday Daily Signal Digest · 2026-11-05"), "Re: Faraday Daily Signal Digest · 2026-11-05");
  const r = await composeEmail({ panelist: delia, kind: "reply", context: { date: "2026-11-05", thread, replySubject: "Re: Morning note from Delia: x" } }, fixed(`Myke, the order is deliberate. ${LONG}`));
  assert.equal(r.subject, "Re: Morning note from Delia: x");
  assert.ok(r.body.endsWith(signature(delia)));
  assert.throws(() => userPrompt("reply", delia, { date: "2026-11-05" }), /needs context.thread/);
});

test("roundtable opener: fixed subject, at most two paragraphs, no signature appended", async () => {
  const sig = { ...SAMPLE_SIGNAL, editionDate: "2026-11-05" };
  const r = await composeEmail({ panelist: hart, kind: "roundtable-opener", context: { date: "2026-11-05", signal: sig } }, fixed("Here is today's edition.\n\nTen takeaways follow.\n\nA third paragraph that is cut."));
  assert.equal(r.subject, `Panel roundtable: Re: ${SAMPLE_SIGNAL.subject}`);
  assert.equal(r.body, "Here is today's edition.\n\nTen takeaways follow.");
  assert.ok(!r.body.includes(signature(hart)));
  assert.match(userPrompt("roundtable-opener", hart, { date: "2026-11-05", signal: sig }), /Write the opener only/);
});

test("mock model names the edition it was given, so previews show the opener contract", async () => {
  const sig = { ...SAMPLE_SIGNAL, editionDate: "2026-11-05" };
  const b = await composeEmail({ panelist: delia, kind: "briefing", context: { date: "2026-11-05", signal: sig } }, mockModel);
  assert.match(b.body.split("\n")[0], /2026-11-05/);
  const t = await composeEmail({ panelist: delia, kind: "signal-takeaway", context: { date: "2026-11-05", signal: sig } }, mockModel);
  assert.match(t.body.split("\n")[1], /2026-11-05/);
});
