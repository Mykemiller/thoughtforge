// Offline tests for the GDELT smoke helpers and the network resolver (Linear TH-14, TH-15).
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { docUrl, parseTimeline } from "../lib/gdelt.ts";
import { resolveDraft, snapshotSource, projectRefFromUrl, isAnonKey, type Draft } from "../lib/network-core.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const snap = JSON.parse(readFileSync(join(ROOT, "cast/_fixtures/people-snapshot.json"), "utf8"));
const jwt = (payload: object) => ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

test("docUrl builds a timelinevol query with the 90-day default", () => {
  const u = new URL(docUrl('"data center moratorium"', "timelinevol"));
  assert.equal(u.searchParams.get("mode"), "timelinevol");
  assert.equal(u.searchParams.get("timespan"), "90d");
  assert.equal(u.searchParams.get("format"), "json");
  assert.equal(u.searchParams.get("query"), '"data center moratorium"');
});

test("parseTimeline counts rows", () => {
  const body = JSON.stringify({ timeline: [{ series: "Volume Intensity", data: [{ date: "20260801T000000Z", value: 0.01 }, { date: "20260802T000000Z", value: 0.02 }] }] });
  assert.deepEqual(parseTimeline(body), { ok: true, rows: 2, series: "Volume Intensity", first: "20260801T000000Z", last: "20260802T000000Z" });
});

test("parseTimeline treats GDELT's plain-text answers as failures", () => {
  const r = parseTimeline("Please limit requests to one every 5 seconds.");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.rateLimited, true);
  assert.equal(parseTimeline("Your search contained a phrase that was too short.").ok, false);
});

test("guard: only the project of record and only an anon key", () => {
  assert.equal(projectRefFromUrl("https://ycadmmngkdhvpcsrcuaq.supabase.co"), "ycadmmngkdhvpcsrcuaq");
  assert.equal(projectRefFromUrl("https://xgbpmlkanxewtfizloay.supabase.co"), "xgbpmlkanxewtfizloay");
  assert.equal(projectRefFromUrl("https://example.com"), null);
  assert.equal(isAnonKey(jwt({ role: "anon" })), true);
  assert.equal(isAnonKey(jwt({ role: "service_role" })), false);
  assert.equal(isAnonKey("sb_publishable_abc"), true);
  assert.equal(isAnonKey("sb_secret_abc"), false);
});

test("fixture dry run: one exact, one alias, one unresolved", async () => {
  const draft = parse(readFileSync(join(ROOT, "cast/_fixtures/network.draft.yaml"), "utf8")) as Draft;
  const r = await resolveDraft(draft, snapshotSource(snap));
  assert.deepEqual(r.resolved.map((x) => [x.name, x.resolution]), [["James Hamilton", "exact"], ["Albertazzi Giordano", "alias"]]);
  assert.equal(r.resolved[1].canonical_name, "Giordano Albertazzi");
  assert.deepEqual(r.unresolved.map((x) => x.name), ["Jim Hamiltn"]);
});

test("officeholders take their seat from office_occupancies", async () => {
  const r = await resolveDraft({ slug: "t", entries: [{ name: "David Rosner", relationship_kind: "follows", venue: "FERC statements", since: 2024, evidence: "" }] }, snapshotSource(snap));
  assert.equal(r.resolved[0].current_affiliation?.source, "office_occupancies");
  assert.match(r.resolved[0].current_affiliation?.employer ?? "", /Federal Energy Regulatory Commission/);
  assert.equal(r.resolved[0].domain_tags[0], "D3.4"); // primary tag first
});

test("bad drafts are kept as unresolved, never dropped", async () => {
  const r = await resolveDraft({
    slug: "t",
    entries: [
      { name: "James Hamilton", relationship_kind: "friend", venue: "x", since: 2010, evidence: "" },
      { name: "Joe Kava", relationship_kind: "follows", venue: "x", since: 2025, evidence: "" },
      { name: "Rich Miller", relationship_kind: "follows", venue: "x", since: 2008, evidence: "", expected_person_id: "00000000-0000-0000-0000-000000000000" },
    ],
  }, snapshotSource(snap));
  assert.equal(r.resolved.length, 0);
  assert.deepEqual(r.unresolved.map((u) => u.reason.split(" ")[0]), ["forbidden", "since", "person_id"]);
});

test("every cast draft resolves completely against the snapshot", async () => {
  const slugs = ["albert-thorne", "constance-wright", "delia-marchetti", "gilbert-faraday", "hartford-caldwell", "ingrid-halverson", "mach-eigen", "margo-brandt", "rosalind-ferraro", "victoria-stroud"];
  for (const slug of slugs) {
    const draft = parse(readFileSync(join(ROOT, "cast", slug, "network.draft.yaml"), "utf8")) as Draft;
    const r = await resolveDraft(draft, snapshotSource(snap));
    assert.equal(r.unresolved.length, 0, `${slug}: ${r.unresolved.map((u) => `${u.name} (${u.reason})`).join("; ")}`);
    assert.ok(r.resolved.length >= 6 && r.resolved.length <= 15, `${slug}: ${r.resolved.length} entries`);
  }
});

// ---------- cast audit (TH-30) ----------
import { properNouns, classify, archetypeHits, type Lexicon } from "../lib/audit-core.ts";

const lex: Lexicon = {
  fictionalNames: ["Margo Brandt", "Leif Brandt"], fictionalTokens: new Set(["Margo", "Brandt", "Leif"]),
  orgs: ["Mortenson", "Burns & McDonnell"], events: [], allow: ["Grant Park", "Minneapolis"],
  archetypes: ["Riker", "Obama"], spineNames: ["Jensen Huang", "Rich Miller"],
};

test("extractor finds names and skips sentence starts and codes", () => {
  const n = properNouns("- R03, 2019, with Margo Brandt: she built it in Minneapolis for Mortenson.\nShe met Rich Miller at Grant Park.");
  assert.ok(n.includes("Margo Brandt"));
  assert.ok(n.includes("Rich Miller"));
  assert.ok(n.includes("Grant Park"));
  assert.ok(!n.includes("R03"));
  assert.ok(!n.includes("She"));
});

test("classify: fictional, real org, network voice, spine outside network, archetype, unknown", () => {
  assert.equal(classify("Leif Brandt", lex, []), "FIC");
  assert.equal(classify("Burns & McDonnell", lex, []), "REAL-ORG");
  assert.equal(classify("Jensen Huang", lex, ["Jensen Huang"]), "VOICE");
  assert.equal(classify("Jensen Huang", lex, []), "SPINE-OUTSIDE-NETWORK");
  assert.equal(classify("Riker", lex, []), "ARCHETYPE");
  assert.equal(classify("Paul McCartney", lex, []), "UNCLASSIFIED");
});

test("archetype hits honor exceptions and word boundaries", () => {
  assert.deepEqual(archetypeHits("A Rice University alum, not Obama.", ["Rice", "Obama"], ["Rice University"]), ["Obama"]);
  assert.deepEqual(archetypeHits("Price and Ricer", ["Rice"]), []);
});
