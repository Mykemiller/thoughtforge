// Offline tests for the Panel Podcast script generator (Linear TH-37, PP-03). No network, no Supabase, no key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadCastWithShared } from "../../src/cast/loader.ts";
import { composePanelistCore, composeSystemPrompt, EVIDENCE_LADDER_CONTRACT, PODCAST_CONTRACT, estimateTokens, PROMPT_TOKEN_LIMIT } from "../../src/cast/prompt.ts";
import { parseDigest } from "../../src/lib/digest/parse.ts";
import { selectSignals, gradeSignal, domainCode, type DigestSignalRow } from "../../src/lib/podcast/select-signals.ts";
import { selectCast, parseCastOverride, chairFor } from "../../src/lib/podcast/select-cast.ts";
import { scriptSchema, scriptWordCount, inWordBand, countWords, pronunciationTerms, type EpisodeScript } from "../../src/lib/podcast/script-schema.ts";
import { generateScript, planSteps, trimToWords, cleanTurn } from "../../src/lib/podcast/generate-script.ts";
import { buildEpisode } from "../../src/lib/podcast/episode.ts";
import { mockLlm } from "../../src/lib/podcast/mock-llm.ts";
import type { Llm } from "../../src/lib/podcast/llm.ts";
import { auditScript, buildLexicon } from "../lib/podcast-audit.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const cast = loadCastWithShared();
const digest = parseDigest(readFileSync(join(ROOT, "fixtures/digests/2026-11-07.eml"), "utf8"), { filename: "2026-11-07.eml" });
const rows: DigestSignalRow[] = digest.signals.map((s) => ({ id: `d-${s.position}`, ...s }));
const lex = buildLexicon(ROOT);

const row = (o: Partial<DigestSignalRow> & { id: string }): DigestSignalRow => ({
  position: 1, title: "t", summary: "s", source_url: "https://x.test/a", publisher: "P", published_at: null, idf_domain: "Construction", confidence: null, ...o,
});

// ---------- selector ----------
test("selector is deterministic and order-independent", () => {
  const a = selectSignals(rows);
  const b = selectSignals([...rows].reverse());
  assert.deepEqual(a.selected.map((s) => s.signal_id), b.selected.map((s) => s.signal_id));
  assert.deepEqual(selectSignals(rows), selectSignals(rows));
  assert.equal(a.selected.length, 3);
  assert.equal(a.considered, 40);
  for (const s of a.selected) assert.ok(s.rationale.length > 10);
});

test("selector ranks confidence first, then focus domain, then recency, then position", () => {
  const picked = selectSignals([
    row({ id: "low-focus", confidence: "CF2", idf_domain: "Power Architecture", position: 1 }),
    row({ id: "high-offfocus", confidence: "CF5", idf_domain: "Industry Media & Analyst Coverage", position: 2 }),
    row({ id: "high-focus-old", confidence: "CF5", idf_domain: "Power Architecture", position: 3, published_at: "2026-11-01T00:00:00Z" }),
    row({ id: "high-focus-new", confidence: "CF5", idf_domain: "Power Architecture", position: 4, published_at: "2026-11-06T00:00:00Z" }),
    row({ id: "no-date-early", confidence: "CF4", idf_domain: "Construction", position: 1 }),
    row({ id: "no-date-late", confidence: "CF4", idf_domain: "Construction", position: 9 }),
  ], 6).selected.map((s) => s.signal_id);
  assert.deepEqual(picked, ["high-focus-new", "high-focus-old", "high-offfocus", "no-date-early", "no-date-late", "low-focus"]);
});

test("a projection never outranks a sourced item, whatever the label says", () => {
  const g = gradeSignal(row({ id: "p", confidence: "CF5", summary: "Capacity is projected to double by 2030." }));
  assert.ok(g.cf < 3 && g.projection);
  const top = selectSignals([row({ id: "proj", confidence: "verified", summary: "Demand is forecast to triple." }), row({ id: "plain", confidence: "SRC", summary: "A utility filed a tariff." })], 2).selected;
  assert.equal(top[0].signal_id, "plain");
  assert.equal(gradeSignal(row({ id: "n", source_url: null })).cf, 1);
  assert.equal(gradeSignal(row({ id: "u" })).cf, 3);
});

test("digest headings and IDF codes both map to domain codes", () => {
  assert.equal(domainCode("Power Architecture"), "D2");
  assert.equal(domainCode("D7.3"), "D7");
  assert.equal(domainCode("Chips & Density"), "D1");
  assert.equal(domainCode("Something Else"), null);
});

// ---------- roster ----------
test("roster: mapped voices, gilbert chairs, off-mic personas never seated", () => {
  const c = selectCast(["D7", "D13", "D2"]);
  assert.deepEqual(c.cast, [
    { slug: "gilbert-faraday", role: "chair" },
    { slug: "ingrid-halverson", role: "voice" },
    { slug: "hartford-nakamura", role: "voice" },
  ]);
  const all = selectCast(["D22", "D5", null]).cast.map((x) => x.slug);
  assert.ok(!all.includes("constance-wright") && !all.includes("delia-marchetti"));
  assert.equal(all.length, 3);
});

test("roster: least recently on-mic wins the tie, never-on-mic first, slug order last", () => {
  const history = [{ when: "2026-11-05", cast: [{ slug: "mach-eigen" }] }, { when: "2026-11-01", cast: [{ slug: "albert-thorne" }] }];
  assert.equal(selectCast(["D3", "D7"], history).cast[1].slug, "albert-thorne");
  assert.equal(selectCast(["D3", "D7"], [{ when: "2026-11-05", cast: [{ slug: "albert-thorne" }] }]).cast[1].slug, "mach-eigen");
  assert.equal(selectCast(["D3", "D7"]).cast[1].slug, "albert-thorne"); // both never: slug order
});

test("roster: chair rule and --cast override validation", () => {
  assert.equal(chairFor(["mach-eigen", "gilbert-faraday"]), "margo-brandt");
  const o = parseCastOverride("gilbert-faraday,mach-eigen,ingrid-halverson", cast.members.map((m) => m.slug));
  assert.deepEqual(o.cast.map((c) => c.slug), ["gilbert-faraday", "mach-eigen", "ingrid-halverson"]);
  const slugs = cast.members.map((m) => m.slug);
  assert.throws(() => parseCastOverride("gilbert-faraday,mach-eigen,constance-wright", slugs), /never on-mic/);
  assert.throws(() => parseCastOverride("gilbert-faraday,mach-eigen", slugs), /exactly three/);
  assert.throws(() => parseCastOverride("gilbert-faraday,mach-eigen,nobody-here", slugs), /unknown/);
  assert.doesNotThrow(() => parseCastOverride("margo-brandt,gilbert-faraday,mach-eigen", slugs));
  assert.throws(() => parseCastOverride("mach-eigen,gilbert-faraday,ingrid-halverson", slugs), /margo-brandt must chair/);
});

// ---------- prompt mode ----------
test("podcast mode swaps the contract, leaves ask mode byte-identical, stays within the token budget", () => {
  for (const m of cast.members) {
    const ask = composePanelistCore(m, cast.shared);
    assert.equal(ask, composePanelistCore(m, cast.shared, "ask"));
    assert.ok(ask.endsWith(EVIDENCE_LADDER_CONTRACT));
    const pod = composePanelistCore(m, cast.shared, "podcast");
    assert.ok(pod.endsWith(PODCAST_CONTRACT));
    assert.ok(!pod.includes("Replies are 120 to 220 words"));
    assert.ok(estimateTokens(pod) < PROMPT_TOKEN_LIMIT, m.slug);
  }
  const sys = composeSystemPrompt(cast.members[0], cast.shared, { artifacts: [], mode: "podcast", turnInstructions: "## This turn\nx" });
  assert.ok(sys.includes("Evidence-ladder contract (spoken)"));
});

// ---------- schema ----------
const goodScript = (): EpisodeScript => {
  const t = (speaker: string, n: number) => ({ speaker, text: Array.from({ length: n }, (_, i) => `word${i}`).join(" "), est_seconds: n / 2.5 });
  const segments = [
    { kind: "cold_open" as const, turns: [t("gilbert-faraday", 80)] },
    ...["a", "b", "c"].map((id) => ({ kind: "signal" as const, signal_id: id, turns: [t("gilbert-faraday", 55), t("mach-eigen", 85), t("albert-thorne", 85)] })),
    { kind: "the_read" as const, turns: [t("gilbert-faraday", 75)] },
    { kind: "sign_off" as const, turns: [t("gilbert-faraday", 30)] },
  ];
  return { episode_id: "PP-20261101-01", show: "S", title: "T", segments, pronunciation_terms: [], word_count: scriptWordCount({ segments }) };
};

test("schema accepts a well-formed script and rejects each contract breach", () => {
  assert.doesNotThrow(() => scriptSchema.parse(goodScript()));
  const bad = (f: (s: EpisodeScript) => void) => { const s = goodScript(); f(s); return () => scriptSchema.parse(s); };
  assert.throws(bad((s) => { s.episode_id = "PP-1"; }));
  assert.throws(bad((s) => { s.word_count += 1; }), /word_count/);
  assert.throws(bad((s) => { s.segments.reverse(); }), /segment order/);
  assert.throws(bad((s) => { delete s.segments[1].signal_id; }), /signal_id/);
  assert.throws(bad((s) => { s.segments[0].signal_id = "x"; }), /signal_id/);
  assert.throws(bad((s) => { s.segments[0].turns[0].text = "Claim here [SRC: A title]."; s.word_count = scriptWordCount(s); }), /evidence tags/);
  assert.throws(bad((s) => { s.segments[0].turns[0].speaker = "Gilbert"; }));
  assert.throws(bad((s) => { s.segments[0].turns[0].text = Array.from({ length: 91 }, () => "w").join(" "); s.word_count = scriptWordCount(s); }), /at most 90/);
});

test("pronunciation terms pick acronyms and mixed-case terms, not ordinary words or AI", () => {
  assert.deepEqual(pronunciationTerms("ERCOT and SiC and CoWoS reached 18GW, said the AI desk about the grid."), ["18GW", "CoWoS", "ERCOT", "SiC"]);
});

// ---------- generation: word band, regeneration, failure ----------
const steps = () => planSteps({ show: "S", digest_date: "2026-11-07", signals: selectSignals(rows).selected, cast: selectCast(["D2", "D13"]).cast, members: cast.members });
const baseInput = () => {
  const sel = selectSignals(rows).selected;
  return { episode_id: "PP-20261107-01", show: "S", title: "T", digest_date: "2026-11-07", signals: sel, cast: selectCast(sel.map((s) => s.idf_domain_code)).cast, members: cast.members, shared: cast.shared };
};

test("plan: 3 signal segments of 7 turns, chair bookends, two voices disagree-prompted, cold open + read on set pieces", () => {
  const p = steps();
  assert.equal(p.filter((s) => s.kind === "signal").length, 21);
  assert.equal(p[0].kind, "cold_open");
  assert.equal(p.at(-1)!.kind, "sign_off");
  const seg1 = p.filter((s) => s.tag.startsWith("signal1:"));
  assert.deepEqual(seg1.map((s) => s.tag.split(":")[1]), ["ask", "a1", "b1", "probe", "a2", "b2", "rule"]);
  assert.match(seg1[2].instruction, /must disagree/);
  assert.match(seg1[6].instruction, /exactly one sentence that restates the disagreement/);
  assert.equal(p.filter((s) => s.chairSetPiece).map((s) => s.tag).join(), "cold_open,read1,read2");
});

test("generation with the mock model lands in band and every turn is under 90 words", async () => {
  const r = await generateScript({ ...baseInput(), llm: mockLlm });
  assert.equal(r.status, "scripted");
  assert.ok(inWordBand(r.script!.word_count), String(r.script!.word_count));
  for (const seg of r.script!.segments) for (const t of seg.turns) assert.ok(countWords(t.text) <= 90);
  assert.deepEqual(new Set(r.script!.segments.flatMap((s) => s.turns.map((t) => t.speaker))), new Set(baseInput().cast.map((c) => c.slug)));
  assert.ok(!r.script!.segments.some((s) => s.turns.some((t) => ["constance-wright", "delia-marchetti"].includes(t.speaker))));
});

const sized = (words: number): Llm => async (req) => {
  if (req.meta.tag === "grade") return "{}";
  return Array.from({ length: Math.min(words, 88) }, (_, i) => (i % 9 === 8 ? "ends." : "word")).join(" ");
};

test("word band: an out-of-band script is regenerated twice, then fails with status failed", async () => {
  let calls = 0;
  const counting: Llm = async (req) => { calls++; return sized(40)(req); };
  const r = await generateScript({ ...baseInput(), llm: counting });
  assert.equal(r.status, "failed");
  assert.equal(r.script, null);
  assert.equal(r.attempts.length, 3);
  assert.ok(r.attempts.every((a) => a.outcome === "out_of_band"));
  assert.equal(calls, 3 * steps().length);
  assert.match(r.reason!, /no valid script after 3 attempts/);
});

test("word band: first attempt out of band, second in band succeeds and records both", async () => {
  let n = 0;
  const llm: Llm = async (req) => (n++ < steps().length ? sized(40)(req) : mockLlm(req));
  const r = await generateScript({ ...baseInput(), llm });
  assert.equal(r.status, "scripted");
  assert.deepEqual(r.attempts.map((a) => a.outcome), ["out_of_band", "ok"]);
});

test("an over-long turn is retried once, then trimmed to 90 words", async () => {
  const long = Array.from({ length: 140 }, (_, i) => (i % 12 === 11 ? "ok." : "w")).join(" ");
  assert.ok(countWords(trimToWords(long)) <= 90);
  assert.ok(trimToWords(long).endsWith("."));
  const r = await generateScript({ ...baseInput(), llm: async () => long, maxRegenerations: 0 });
  assert.equal(r.status, "scripted");
  for (const seg of r.script!.segments) for (const t of seg.turns) assert.ok(countWords(t.text) <= 90);
  assert.equal(cleanTurn("Gilbert Faraday: **Hello** there [SRC] friend.", "Gilbert Faraday"), "Hello there friend.");
});

test("a model error fails the attempt rather than storing a partial script", async () => {
  const r = await generateScript({ ...baseInput(), llm: async () => { throw new Error("boom"); }, maxRegenerations: 1 });
  assert.equal(r.status, "failed");
  assert.deepEqual(r.attempts.map((a) => a.outcome), ["error", "error"]);
});

// ---------- real-name audit ----------
const onMic = ["gilbert-faraday", "mach-eigen", "albert-thorne"];
const ctxFor = (signalText: string) => ({ lexicon: lex.lexicon, archetypeExceptions: lex.archetypeExceptions, networks: lex.networks, castSlugs: lex.castSlugs, signalText });
const withLine = (text: string, speaker = "mach-eigen"): EpisodeScript => {
  const s = goodScript();
  s.segments[1].turns[1] = { speaker, text, est_seconds: 5 };
  s.word_count = scriptWordCount(s);
  return s;
};
const SIGNAL = "Marvell Technology agreed to acquire Lumentum. Jensen Huang said NVIDIA will ship fewer chips to China.";

test("audit: the mock script passes", async () => {
  const r = await generateScript({ ...baseInput(), llm: mockLlm });
  const a = auditScript(r.script!, ctxFor(baseInput().signals.map((s) => `${s.title} ${s.summary}`).join("\n")), baseInput().cast.map((c) => c.slug));
  assert.deepEqual(a.failures, []);
});

test("audit: a public figure may be the subject of a signal, never a friend, mentor or endorser", () => {
  const ok = auditScript(withLine("Jensen Huang said NVIDIA will ship fewer chips, and I think that is optimistic."), ctxFor(SIGNAL), onMic);
  assert.deepEqual(ok.failures, []);
  const friend = auditScript(withLine("My friend Jensen Huang told me this will be fine."), ctxFor(SIGNAL), onMic);
  assert.equal(friend.ok, false);
  assert.match(friend.failures.join(), /friend\/mentor\/endorser/);
  const endorser = auditScript(withLine("Jensen Huang endorsed that view last year."), ctxFor(SIGNAL), onMic);
  assert.equal(endorser.ok, false);
});

test("audit: cast names are fine; an off-cast speaker, an off-mic persona and archetype references fail", () => {
  assert.deepEqual(auditScript(withLine("As Albert Thorne said last week, the queue is the constraint."), ctxFor(SIGNAL), onMic).failures, []);
  assert.match(auditScript(withLine("A line.", "victoria-stroud"), ctxFor(SIGNAL), onMic).failures.join(), /not on this episode's cast/);
  assert.match(auditScript(withLine("A line.", "constance-wright"), ctxFor(SIGNAL), [...onMic, "constance-wright"]).failures.join(), /never on-mic/);
  const arche = lex.lexicon.archetypes[0];
  assert.match(auditScript(withLine(`This panel is basically ${arche} and nothing more.`), ctxFor(SIGNAL), onMic).failures.join(), /archetype/);
});

test("audit: a real person from the people spine outside the speaker's network fails", () => {
  const spine = lex.lexicon.spineNames.find((n) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(n) && !lex.lexicon.fictionalNames.includes(n));
  assert.ok(spine, "the spine fixture has at least one plain two-word name");
  const a = auditScript(withLine(`Then ${spine} weighed in on the grid.`), ctxFor("unrelated"), onMic);
  assert.equal(a.ok, false);
  assert.match(a.failures.join(), /outside mach-eigen's network/);
});

test("audit: an unexplained person-shaped name is listed for review, not failed", () => {
  const a = auditScript(withLine("Ruth Quimby ran the study that nobody cited."), ctxFor(SIGNAL), onMic);
  assert.equal(a.ok, true);
  assert.ok(a.review.some((r) => r.startsWith("Ruth Quimby")));
});

test("a failing audit regenerates and then fails the episode", async () => {
  const r = await generateScript({ ...baseInput(), llm: mockLlm, audit: () => ({ ok: false, failures: ["x"] }) });
  assert.equal(r.status, "failed");
  assert.ok(r.attempts.every((a) => a.outcome === "audit"));
});

// ---------- end to end ----------
test("buildEpisode (mock): a scripted row with show notes, grades and cast rationale; override respected", async () => {
  const out = await buildEpisode({ digest_date: "2026-11-07", nn: "02", rows, members: cast.members, shared: cast.shared, llm: mockLlm, castOverride: "gilbert-faraday,mach-eigen,ingrid-halverson" });
  const r = out.row;
  assert.equal(r.episode_id, "PP-20261107-02");
  assert.equal(r.status, "scripted");
  assert.ok(inWordBand(r.word_count!));
  assert.deepEqual(r.cast.map((c) => c.slug), ["gilbert-faraday", "mach-eigen", "ingrid-halverson"]);
  assert.match(r.show_notes_md!, /Evidence grade \(Constance Wright\): (VRF|SRC|EST|INF)/);
  assert.doesNotMatch(JSON.stringify(r.script), /Constance Wright|constance-wright/);
  assert.equal((r.signals.selected as unknown[]).length, 3);
  assert.equal(scriptSchema.safeParse(r.script).success, true);
});

test("buildEpisode: a digest with fewer than three signals is refused", async () => {
  await assert.rejects(buildEpisode({ digest_date: "2026-11-07", nn: "01", rows: rows.slice(0, 2), members: cast.members, shared: cast.shared, llm: mockLlm }), /need at least 3/);
});

test("the committed example fixture is a valid in-band script that passes the audit", () => {
  const dir = join(ROOT, "fixtures/podcast/PP-20261107-01");
  const script = scriptSchema.parse(JSON.parse(readFileSync(join(dir, "script.json"), "utf8")));
  assert.ok(inWordBand(script.word_count));
  const sel = selectSignals(rows).selected;
  const a = auditScript(script, ctxFor(sel.map((s) => `${s.title} ${s.summary}`).join("\n")), selectCast(sel.map((s) => s.idf_domain_code)).cast.map((c) => c.slug));
  assert.deepEqual(a.failures, []);
});
