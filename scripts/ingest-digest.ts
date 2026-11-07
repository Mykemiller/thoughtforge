// Ingest Faraday Daily Signal Digest emails into tf_signal_digests + tf_digest_signals (Linear TH-36, PP-02).
//
//   npm run ingest:digest -- inbox/digests/some-digest.eml
//   npm run ingest:digest -- inbox/digests                 # every .eml / .html / .htm in the directory
//   npm run ingest:digest -- inbox/digests --dry-run       # parse only, print JSON, never touch Supabase
//   npm run ingest:digest -- file.eml --dry-run --full     # include raw_html / raw_text in the JSON
//
// Idempotent on digest_date: the digest row is upserted, then its signals are deleted and re-inserted.
// Exits non-zero if any file fails to parse or yields fewer than 80% of the signals its subject line states;
// such a file is never written. Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local or
// the environment and refuses any project other than ycadmmngkdhvpcsrcuaq. Never prints a key.
// Logs carry US Central (America/Chicago) timestamps.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, basename, extname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseDigest, parseYield, digestRow, signalRows, MIN_YIELD, type ParsedDigest } from "../src/lib/digest/parse.ts";
import { requireServiceEnv } from "./lib/supabase-guard.ts";

const EXTENSIONS = new Set([".eml", ".html", ".htm"]);

function ct(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")} ${g("timeZoneName")}`;
}
const log = (msg: string) => console.error(`[${ct()}] ${msg}`);

function loadDotEnvLocal() {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

function listDigestFiles(target: string): string[] {
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target)
    .filter((f) => EXTENSIONS.has(extname(f).toLowerCase()) && !f.startsWith("."))
    .sort()
    .map((f) => join(target, f));
}

function summaryJson(d: ParsedDigest, full: boolean) {
  const { raw_html, raw_text, ...rest } = d;
  return full ? d : { ...rest, raw_html_chars: raw_html?.length ?? 0, raw_text_chars: raw_text?.length ?? 0 };
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const full = args.includes("--full");
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error("usage: npm run ingest:digest -- <file.eml | file.html | directory> [--dry-run] [--full]");
  process.exit(2);
}
const files = listDigestFiles(target);
if (!files.length) {
  console.error(`no .eml / .html files in ${target}`);
  process.exit(1);
}

type Sb = ReturnType<typeof createClient>;
let sb: Sb | null = null;
if (!dryRun) {
  loadDotEnvLocal();
  const { url, key } = requireServiceEnv(); // throws unless the URL names ycadmmngkdhvpcsrcuaq
  sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

let failed = 0;
const out: unknown[] = [];
for (const file of files) {
  const name = basename(file);
  let d: ParsedDigest;
  try {
    d = parseDigest(readFileSync(file, "utf8"), { filename: name });
  } catch (err) {
    failed++;
    log(`${name}: parse error: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  const y = parseYield(d);
  const yieldText = `${d.signals.length}/${d.signal_count ?? "?"} signals (${Math.round(y * 100)}%, ${d.parser})`;
  for (const w of d.warnings) log(`${name}: warning: ${w}`);
  if (y < MIN_YIELD) {
    failed++;
    log(`${name}: ${d.digest_date} yield ${yieldText} is below ${MIN_YIELD * 100}%; not written`);
    if (dryRun) out.push(summaryJson(d, full));
    continue;
  }
  if (dryRun || !sb) {
    log(`${name}: ${d.digest_date} parsed ${yieldText} (dry run)`);
    out.push(summaryJson(d, full));
    continue;
  }
  try {
    const { data, error } = await sb.from("tf_signal_digests").upsert(digestRow(d) as never, { onConflict: "digest_date" }).select("id").single();
    if (error) throw error;
    const digestId = (data as { id: string }).id;
    const del = await sb.from("tf_digest_signals").delete().eq("digest_id", digestId);
    if (del.error) throw del.error;
    const rows = signalRows(d, digestId);
    if (rows.length) {
      const ins = await sb.from("tf_digest_signals").insert(rows as never);
      if (ins.error) throw ins.error;
    }
    log(`${name}: ${d.digest_date} -> ${digestId}, ${yieldText} written`);
  } catch (err) {
    failed++;
    const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
    log(`${name}: write error: ${msg}`);
  }
}
if (dryRun) console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));
log(`${files.length - failed}/${files.length} digest file(s) ok${dryRun ? " (dry run, Supabase untouched)" : ""}`);
process.exit(failed ? 1 : 0);
