// Offline tests for the Daily Signal Digest ingest (Linear TH-36, PP-02). Fixtures only; never touches Supabase.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import {
  parseDigest, parseYield, readEml, deriveTitle, decodeEncodedWords, decodeQuotedPrintable, subjectFacts, headerFacts,
  digestRow, signalRows, looksLikeEml, MIN_YIELD, TITLE_MAX,
} from "../../src/lib/digest/parse.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const EML = "fixtures/digests/2026-11-07.eml";
const EDGE = "fixtures/digests/2026-09-23-edge-cases.html";

test("real digest .eml: subject, date, message id and every signal", () => {
  const d = parseDigest(read(EML), { filename: "2026-11-07.eml" });
  assert.equal(d.subject, "Faraday Daily Signal Digest — 40 signals · 2026-11-07");
  assert.equal(d.digest_date, "2026-11-07");
  assert.equal(d.signal_count, 40);
  assert.equal(d.signals.length, 40);
  assert.equal(parseYield(d), 1);
  assert.equal(d.parser, "html");
  assert.deepEqual(d.warnings, []);
  assert.match(d.source_message_id ?? "", /@email\.amazonses\.com$/);
  assert.deepEqual(d.window, { start: "2026-11-06T08:00:00Z", end: "2026-11-07T08:00:00Z" });
  assert.deepEqual(d.signals.map((s) => s.position), Array.from({ length: 40 }, (_, i) => i + 1));
  assert.ok(d.raw_html && d.raw_html.includes("Daily Signal Digest"), "raw_html kept for re-parse");
  assert.ok(d.raw_text && d.raw_text.startsWith("FARADAY DAILY SIGNAL DIGEST"));
});

test("real digest: first signal fields, IDF domain verbatim from the section heading", () => {
  const s = parseDigest(read(EML)).signals[0];
  assert.equal(s.idf_domain, "Industry Media & Analyst Coverage");
  assert.equal(s.publisher, "Cloud News");
  assert.equal(s.source_url, "https://cloudnews.tech/china-will-wait-months-for-nvidias-rtx-pro-5500-just-1/");
  assert.match(s.summary ?? "", /^NVIDIA will deliver only approximately 1% of Chinese orders/);
  assert.ok(s.title.length <= TITLE_MAX);
  assert.equal(s.raw.title_derived, true);
  assert.equal(s.raw.section, "Industry Media & Analyst Coverage");
  assert.equal(s.confidence, null);
  assert.deepEqual(s.entities, []);
});

test("real digest: every signal has a summary, a source and a known section; the moratorium appendix is not a signal", () => {
  const d = parseDigest(read(EML));
  for (const s of d.signals) {
    assert.ok(s.summary && s.summary.length > 40, `summary at ${s.position}`);
    assert.match(s.source_url ?? "", /^https:\/\//, `source at ${s.position}`);
    assert.ok(s.publisher, `publisher at ${s.position}`);
    assert.ok(s.idf_domain && !/moratori/i.test(s.idf_domain), `domain at ${s.position}`);
    assert.ok(!/[<>]|&amp;/.test(s.summary ?? ""), `clean text at ${s.position}`);
  }
  assert.equal(new Set(d.signals.map((s) => s.idf_domain)).size, 14);
  assert.equal(d.appendix.length, 1);
  assert.equal(d.appendix[0].section, "Counties with Moratoriums");
  assert.equal(d.appendix[0].items.length, 20);
  assert.match(d.appendix[0].note ?? "", /^Showing the 20 most recently enacted of 392/);
  assert.ok(!/IDF Domain Registry/.test(JSON.stringify(d.signals)), "footer never lands in a signal");
});

test("text/plain fallback yields the same signals as the HTML body", () => {
  const eml = readEml(read(EML));
  const textOnly = `Subject: ${eml.subject}\nContent-Type: text/plain; charset=utf-8\n\n${eml.text}`;
  const t = parseDigest(textOnly);
  const h = parseDigest(read(EML));
  assert.equal(t.parser, "text");
  assert.equal(t.signals.length, 40);
  assert.deepEqual(t.signals.map((s) => s.source_url), h.signals.map((s) => s.source_url));
  assert.deepEqual(t.signals.map((s) => s.publisher), h.signals.map((s) => s.publisher));
  assert.deepEqual(t.signals.map((s) => s.idf_domain), h.signals.map((s) => s.idf_domain));
  assert.equal(t.appendix[0]?.items.length, 20);
});

test("HTML-only export: header date and count, top-N-of-M, tolerant of missing sources and unknown blocks", () => {
  const d = parseDigest(read(EDGE), { filename: "2026-09-23-edge-cases.html" });
  assert.equal(looksLikeEml(read(EDGE)), false);
  assert.equal(d.subject, null);
  assert.equal(d.digest_date, "2026-09-23");
  assert.equal(d.signal_count, 4);
  assert.equal(d.total_before_cut, 6);
  assert.equal(d.signals.length, 4);
  const [a, b, c] = d.signals;
  assert.equal(a.summary, "A hypothetical chipmaker's accelerator ships at 1.4 kW per package. Rack densities above 130 kW follow.");
  assert.equal(a.title, "A hypothetical chipmaker's accelerator ships at 1.4 kW per package.");
  assert.equal(a.source_url, "https://example.com/news/accelerator?id=1&src=digest");
  assert.equal(b.source_url, null);
  assert.equal(b.raw.missing_source, true);
  assert.equal(c.idf_domain, "Grid & Regulatory");
  assert.equal(c.confidence, "High", "confidence label kept verbatim");
  assert.equal(c.idf_subdomain, "D2.3", "IDF code kept as it appears");
  assert.deepEqual(c.raw.extra, ["Confidence: High · D2.3"], "unknown block kept in raw");
  assert.equal(d.appendix[0].items.length, 1);
});

test("subject and header helpers", () => {
  assert.deepEqual(subjectFacts("Faraday Daily Signal Digest — 37 signals · 2026-11-01"), { date: "2026-11-01", count: 37 });
  assert.deepEqual(subjectFacts(null), { date: null, count: null });
  const h = headerFacts("2026-09-22 08:00 -> 2026-09-23 08:00 UTC · 50 signals · showing top 50 of 54");
  assert.deepEqual(h, { start: "2026-09-22T08:00:00Z", end: "2026-09-23T08:00:00Z", count: 50, total: 54 });
  assert.equal(decodeEncodedWords("=?UTF-8?Q?Faraday_Daily_Signal_Digest_=E2=80=94_40?=\n =?UTF-8?Q?_signals_=C2=B7_2026-11-07?=".replace(/\n/, "")), "Faraday Daily Signal Digest — 40 signals · 2026-11-07");
  assert.equal(decodeEncodedWords("=?utf-8?B?w6l0w6k=?="), "été");
  assert.equal(decodeQuotedPrintable("caf=C3=A9 =\nau lait"), "café au lait");
});

test("deriveTitle: first sentence, capped on a word boundary", () => {
  assert.equal(deriveTitle("Short one. Second sentence."), "Short one.");
  assert.equal(deriveTitle("Price is $1.5 billion today. Next."), "Price is $1.5 billion today.");
  const long = deriveTitle(`${"word ".repeat(60)}end.`);
  assert.ok(long.length <= TITLE_MAX && long.endsWith("…"));
});

test("yield gate: 80% of the subject count", () => {
  assert.equal(MIN_YIELD, 0.8);
  assert.ok(parseYield({ signals: new Array(32).fill(null), signal_count: 40 }) >= MIN_YIELD);
  assert.ok(parseYield({ signals: new Array(31).fill(null), signal_count: 40 }) < MIN_YIELD);
  assert.equal(parseYield({ signals: [], signal_count: null }), 0);
});

test("row shapes match tf_signal_digests and tf_digest_signals", () => {
  const d = parseDigest(read(EML));
  assert.deepEqual(Object.keys(digestRow(d)).sort(), ["digest_date", "raw_html", "raw_text", "signal_count", "source_message_id", "subject"]);
  const [row] = signalRows(d, "00000000-0000-0000-0000-000000000000");
  assert.deepEqual(Object.keys(row).sort(), [
    "confidence", "digest_id", "entities", "idf_domain", "idf_subdomain", "jurisdiction", "position", "published_at",
    "publisher", "raw", "signal_type", "source_url", "summary", "title",
  ]);
  const sql = read("supabase/migrations/20261107_pp02_signal_digests.sql");
  for (const col of Object.keys(row)) assert.match(sql, new RegExp(`\\b${col}\\b`), `migration has ${col}`);
  assert.match(sql, /enable row level security/);
  assert.doesNotMatch(sql, /create policy/i, "service role only: no policies");
});

// ---------- dry-run integration: the CLI end to end, with Supabase credentials pointed at nothing ----------

function cli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/ingest-digest.ts", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    // A decoy URL and no key: any attempt to reach Supabase would fail the guard. Dry run must never get that far.
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://xgbpmlkanxewtfizloay.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "" },
  });
}

test("CLI --dry-run over the fixtures directory prints parsed JSON and exits 0 without Supabase", () => {
  const r = cli(["fixtures/digests", "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout) as { digest_date: string; signals: unknown[]; raw_html?: string; raw_html_chars: number }[];
  assert.deepEqual(out.map((d) => [d.digest_date, d.signals.length]), [["2026-09-23", 4], ["2026-11-07", 40]]);
  assert.equal(out[1].raw_html, undefined, "raw bodies omitted without --full");
  assert.ok(out[1].raw_html_chars > 10000);
  assert.match(r.stderr, /2\/2 digest file\(s\) ok \(dry run, Supabase untouched\)/);
  assert.match(r.stderr, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} C[SD]T\]/, "US Central timestamps");
});

test("CLI exits non-zero when yield is under 80% of the subject count", () => {
  const html = read(EDGE).replace("· 4 signals · showing top 4 of 6", "· 9 signals");
  const dir = mkdtempSync(join(tmpdir(), "tf-digest-"));
  const path = join(dir, "low-yield-2026-09-23.html");
  writeFileSync(path, html);
  try {
    const r = cli([path, "--dry-run"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /yield 4\/9 signals \(44%, html\) is below 80%; not written/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI without --dry-run refuses the decoy project before any write", () => {
  const r = cli([EML]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /refusing the decoy Supabase project/);
});
