// Offline tests for the interview-to-dossier loop (Linear TH-52). Fixtures only; never touches Supabase.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArc } from "../../src/interview/guide.ts";
import { PANEL } from "../../src/data/panel.ts";
import { section } from "../lib/audit-core.ts";
import {
  assertProjectUrl, assertGuardCounts, assertSession, renderTranscript, turnLines, mapArc, buildNotes, notesMarkdown,
  personaAnchors, applyPersonaDelta, applyDossierDelta, midtermArtifact, midtermTags, midtermTitle, deltaBranch,
  DOSSIER_HEADING, MIDTERM_TAG, withoutAdditions, type SessionRow, type CastText, type Panelist, type Addition, type Turn,
} from "../lib/interview-notes-core.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SLUG = "gilbert-faraday";
const fixture = JSON.parse(read("scripts/tests/fixtures/interview-session.json")) as SessionRow & { transcript: Turn[]; asked_at: string };
// Baselines with any proposed additions stripped, so the tests also pass on a th-52-notes-<slug> branch.
const personaJson = withoutAdditions(read(`cast/${SLUG}/persona.json`));
const persona = JSON.parse(personaJson);
const dossierBase = applyDossierDelta(read(`cast/${SLUG}/dossier.md`), []);
const P: Panelist = { slug: SLUG, displayName: persona.display_name, role: persona.role };
const arc = parseArc(section(read("docs/interviews/guide.md"), "The fixed arc"));
const snapshot = JSON.parse(read("cast/_fixtures/people-snapshot.json")) as { people: { canonical_name: string }[] };
const cast: CastText = {
  corpus: [dossierBase, read(`cast/${SLUG}/linkedin.md`), personaJson].join("\n"),
  anchors: personaAnchors(persona),
  network: persona.network.map((n: { name: string }) => n.name),
  spine: snapshot.people.map((x) => x.canonical_name),
  known: [...PANEL.map((m) => m.name), "Myke", "ThoughtForge", "Faraday", ...arc],
};
const build = () => {
  const notes = buildNotes(fixture.id, fixture.transcript, arc, cast);
  return { notes, md: notesMarkdown(P, fixture, notes, arc.length) };
};

// ---------- guard ----------

test("guard: refuses the decoy and any other project, accepts the project of record", () => {
  assert.throws(() => assertProjectUrl(undefined), /not set/);
  assert.throws(() => assertProjectUrl("https://xgbpmlkanxewtfizloay.supabase.co"), /decoy/);
  assert.throws(() => assertProjectUrl("https://example.supabase.co"), /project of record/);
  assert.equal(assertProjectUrl("https://ycadmmngkdhvpcsrcuaq.supabase.co"), "https://ycadmmngkdhvpcsrcuaq.supabase.co");
});

test("guard: library counts below the thresholds stop the run", () => {
  assert.doesNotThrow(() => assertGuardCounts({ dcFacilities: 18000, artifacts: 100000 }));
  assert.throws(() => assertGuardCounts({ dcFacilities: 17999, artifacts: 250000 }), /dc_facilities/);
  assert.throws(() => assertGuardCounts({ dcFacilities: 20000, artifacts: 99999 }), /artifacts/);
  assert.throws(() => assertGuardCounts({ dcFacilities: null, artifacts: null }), /dc_facilities has 0/);
});

test("guard: a session that does not resolve, is not an interview or is another panelist's stops the run", () => {
  assert.throws(() => assertSession(null, "x", SLUG), /does not resolve/);
  assert.throws(() => assertSession({ ...fixture, kind: "panel" }, fixture.id, SLUG), /not 'interview'/);
  assert.throws(() => assertSession({ ...fixture, panelist: "margo-brandt" }, fixture.id, SLUG), /belongs to panelist/);
  assert.throws(() => assertSession({ ...fixture, transcript: [] }, fixture.id, SLUG), /no transcript/);
  assert.doesNotThrow(() => assertSession(fixture, fixture.id, SLUG));
});

// ---------- transcript rendering ----------

test("transcript: rendered through transcriptMarkdown with the session header and every turn", () => {
  const t = renderTranscript(P, fixture);
  assert.match(t, /^# Interview: Gilbert Faraday, Chief of Staff\n\nSession 00000000-0000-4000-8000-0000000000a1, started 2026-11-09T15:00:00Z\./);
  assert.equal((t.match(/^\*\*Myke:\*\*/gm) ?? []).length, 8);
  assert.equal((t.match(/^\*\*Gilbert Faraday:\*\*/gm) ?? []).length, 8);
});

test("transcript: turnLines points at the line where each turn starts", () => {
  const lines = renderTranscript(P, fixture).split("\n");
  turnLines(fixture.transcript).forEach((n, i) => {
    const who = fixture.transcript[i].role === "user" ? "Myke" : "Gilbert Faraday";
    assert.ok(lines[n - 1].startsWith(`**${who}:** ${fixture.transcript[i].content.trim().split("\n")[0]}`), `turn ${i + 1} at line ${n}`);
  });
});

test("arc: questions map to interviewer turns; a skipped question is a gap", () => {
  const m = mapArc(fixture.transcript, arc);
  assert.equal(arc.length, 9);
  assert.equal(m[0], 0); // Q1 start
  assert.equal(m[5], 10); // Q6 midterms
  assert.equal(m[7], -1); // Q8 reverse was not asked
});

// ---------- held / drifted / new and the delta proposer ----------

test("notes: held, drifted and new on the fixture, each tagged with turn and line", () => {
  const { notes, md } = build();
  assert.deepEqual(notes.held.map((h) => h.text.split(":")[0]), ["Tacoma", "Helen", "San Juan Islands"]);
  assert.equal(notes.drifted.length, 2);
  assert.match(notes.drifted[0].text, /^Q6 number with no grade: "County boards will move faster than 40 percent/);
  assert.match(notes.drifted[1].text, /Marc Ganzi, a real person outside this panelist's network/);
  assert.deepEqual(notes.additions.map((a) => [a.phrase, a.turn]), [["Kettle Ridge Yard", 4]]);
  assert.deepEqual(notes.arcGaps, [8]);
  // every line reference points at the quoted text in the notes file itself
  const lines = md.split("\n");
  for (const n of [...notes.held, ...notes.drifted, ...notes.added]) {
    const quote = n.text.match(/"([^"]+)"/)?.[1] ?? "";
    assert.ok(lines[n.line - 1].includes(quote.slice(0, 30)), `L${n.line} holds "${quote.slice(0, 30)}"`);
  }
  assert.match(md, /\n## What held, what drifted, what was new\n/);
  assert.match(md, /### What held\n\n- Tacoma: "Tacoma\." \(T2, L7\)/);
});

test("notes: graded Q6 numbers are not drift, and nothing is proposed that the dossier already says", () => {
  const { notes } = build();
  assert.ok(!notes.drifted.some((d) => /36 months|25 to 75/.test(d.text)));
  assert.ok(!notes.additions.some((a) => /Tacoma|Helen|San Juan/.test(a.phrase)));
  for (const a of notes.additions) assert.ok(fixture.transcript[a.turn - 1].content.includes(a.quote), "every addition quotes its turn verbatim");
});

test("deltas: persona.json gains interview_additions only; existing fields are untouched", () => {
  const { notes } = build();
  const next = JSON.parse(applyPersonaDelta(personaJson, fixture.id, notes.additions));
  const { interview_additions, ...rest } = next;
  assert.deepEqual(rest, persona);
  assert.equal(interview_additions.length, 1);
  assert.equal(interview_additions[0].status, "proposed");
});

test("deltas: dossier gains one proposed section at the end; the rest is byte-identical", () => {
  const dossier = dossierBase;
  const { notes } = build();
  const next = applyDossierDelta(dossier, notes.additions);
  assert.ok(next.startsWith(dossier));
  assert.match(next.slice(dossier.length), new RegExp(`^\\n${DOSSIER_HEADING.replace(/[()]/g, "\\$&")}\\n`));
  assert.match(next, /- Kettle Ridge Yard \(T4\): "The crew foreman at Kettle Ridge Yard/);
  assert.equal(applyDossierDelta(next, []), dossier, "removing every addition restores the dossier");
});

test("deltas: a branch per panelist, never main", () => {
  assert.equal(deltaBranch(SLUG), "th-52-notes-gilbert-faraday");
});

// ---------- idempotency ----------

test("idempotent: a second run on the same session gives byte-identical notes and deltas", () => {
  const a = build();
  const b = build();
  assert.equal(a.md, b.md);
  const p1 = applyPersonaDelta(personaJson, fixture.id, a.notes.additions);
  const p2 = applyPersonaDelta(p1, fixture.id, b.notes.additions);
  assert.equal(p1, p2);
  const all = JSON.parse(p2).interview_additions as Addition[];
  const d1 = applyDossierDelta(dossierBase, all);
  assert.equal(applyDossierDelta(d1, all), d1);
});

test("idempotent: persona.json round-trips unchanged for every panelist when there is nothing to add", () => {
  const slugs = readdirSync(join(ROOT, "cast")).filter((s) => !s.startsWith("_") && existsSync(join(ROOT, "cast", s, "persona.json")));
  assert.equal(slugs.length, 10);
  for (const s of slugs) {
    const raw = read(`cast/${s}/persona.json`);
    assert.equal(applyPersonaDelta(raw, "no-such-session", []), raw, s);
  }
});

// ---------- the midterm artifact ----------

test("midterm: titled per D1, tagged for a per-panelist upsert, and never sharing the transcript's session tag", () => {
  const { notes } = build();
  assert.ok(notes.q6);
  const art = midtermArtifact(P, fixture.id, fixture.asked_at, notes.q6!, ["D2"]);
  assert.equal(art.title, "[Temper Mark] Gilbert Faraday on the 2026 midterms");
  assert.equal(midtermTitle("Dr. Ingrid Halverson"), "[Temper Mark] Dr. Ingrid Halverson on the 2026 midterms");
  assert.deepEqual(midtermTags(SLUG, fixture.id), ["interview", "temper-mark", MIDTERM_TAG, "panelist:gilbert-faraday", `from-session:${fixture.id}`]);
  assert.ok(!art.tags.includes(`session:${fixture.id}`), "src/interview/save.ts looks up the transcript artifact by session:<id>");
  assert.equal(art.source, "panel");
  assert.equal(art.published_at, "2026-11-09");
  assert.match(art.body, /\*\*Myke:\*\* What are the implications/);
  assert.match(art.body, /Underwrite 36 months to energization, EST\./);
});
