// Generate one Panel Podcast episode script (Linear TH-37, PP-03): signals -> 3-voice dialogue + show notes.
//
//   npm run podcast:script -- --date 2026-11-01 [--nn 01] [--dry-run]
//   npm run podcast:script -- --date 2026-11-07 --digest-file fixtures/digests/2026-11-07.eml --dry-run   # offline signals
//   TF_MOCK=1 npm run podcast:script -- --date 2026-11-07 --digest-file fixtures/digests/2026-11-07.eml --dry-run --out fixtures/podcast
//   ... --cast gilbert-faraday,mach-eigen,ingrid-halverson      # chair,voice,voice override
//   ... --show "Name" --replace --out <dir>
//
// Reads signals from tf_signal_digests / tf_digest_signals (or --digest-file). Writes a tf_episodes row (status scripted,
// or failed with the reason) unless --dry-run, and always dumps script.json, show-notes.md, episode-row.json and audit.json
// to <out>/<episode_id>/ (default out/podcast). Before any Supabase use the project ref is asserted to be
// ycadmmngkdhvpcsrcuaq; keys come from .env.local or the environment and are never printed. TF_MOCK=1 uses the offline mock model.
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadCastWithShared } from "../src/cast/loader.ts";
import { parseDigest } from "../src/lib/digest/parse.ts";
import { buildEpisode, DEFAULT_SHOW, episodeId } from "../src/lib/podcast/episode.ts";
import { anthropicLlm, hasAnthropicKey } from "../src/lib/podcast/llm.ts";
import { isMock, mockLlm } from "../src/lib/podcast/mock-llm.ts";
import { selectSignals, type DigestSignalRow } from "../src/lib/podcast/select-signals.ts";
import { parseCastOverride, selectCast, type EpisodeHistory } from "../src/lib/podcast/select-cast.ts";
import type { EpisodeScript } from "../src/lib/podcast/script-schema.ts";
import { auditScript, buildLexicon } from "./lib/podcast-audit.ts";
import { requireServiceEnv } from "./lib/supabase-guard.ts";

const ROOT = resolve(import.meta.dirname, "..");
const log = (m: string) => console.error(`[podcast] ${m}`);

function loadDotEnvLocal() {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<number> {
  loadDotEnvLocal();
  const date = arg("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run podcast:script -- --date YYYY-MM-DD [--nn 01] [--dry-run] [--digest-file f] [--cast chair,voice,voice] [--show name] [--replace] [--out dir]");
    return 2;
  }
  const dryRun = flag("dry-run");
  const mock = isMock();
  if (!mock && !hasAnthropicKey()) { console.error("ANTHROPIC_API_KEY is not set (set TF_MOCK=1 for the offline mock model)"); return 2; }

  const digestFile = arg("digest-file");
  const wantsDb = !digestFile || !dryRun;
  let sb: SupabaseClient | null = null;
  if (wantsDb || (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    const { url, key } = requireServiceEnv(); // asserts ycadmmngkdhvpcsrcuaq; refuses the decoy
    sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  let rows: DigestSignalRow[];
  if (digestFile) {
    const d = parseDigest(readFileSync(resolve(digestFile), "utf8"), { filename: digestFile });
    if (d.digest_date !== date) log(`warning: ${digestFile} is the ${d.digest_date} digest, building for ${date}`);
    rows = d.signals.map((s) => ({ id: `digest-${d.digest_date}-${s.position}`, ...s }));
  } else {
    const { data: dg, error: de } = await sb!.from("tf_signal_digests").select("id").eq("digest_date", date).maybeSingle();
    if (de) throw new Error(`tf_signal_digests: ${de.message}`);
    if (!dg) { console.error(`no digest for ${date} in tf_signal_digests (run npm run ingest:digest first)`); return 1; }
    const { data, error } = await sb!.from("tf_digest_signals").select("id,position,title,summary,source_url,publisher,published_at,idf_domain,idf_subdomain,confidence,signal_type").eq("digest_id", dg.id).order("position");
    if (error) throw new Error(`tf_digest_signals: ${error.message}`);
    rows = (data ?? []) as DigestSignalRow[];
  }
  log(`${rows.length} signals for ${date}`);

  let history: EpisodeHistory[] = [];
  let nn = arg("nn");
  if (sb) {
    const { data, error } = await sb.from("tf_episodes").select("episode_id,digest_date,cast,status").neq("status", "failed").order("digest_date", { ascending: false }).limit(60);
    if (error) log(`warning: tf_episodes history unavailable (${error.message}); rotation falls back to slug order`);
    else history = (data ?? []).map((e: { digest_date: string; cast: { slug: string }[] }) => ({ when: e.digest_date, cast: e.cast ?? [] }));
    if (!nn) {
      const { data: same } = await sb.from("tf_episodes").select("episode_id").eq("digest_date", date);
      const used = (same ?? []).map((r: { episode_id: string }) => Number(r.episode_id.slice(-2))).filter((x) => !Number.isNaN(x));
      nn = String((used.length ? Math.max(...used) : 0) + 1).padStart(2, "0");
    }
  }
  nn = (nn ?? "01").padStart(2, "0");
  const id = episodeId(date, nn);

  const { members, shared } = loadCastWithShared();
  const lex = buildLexicon(ROOT);
  const sel = selectSignals(rows);
  const cast = arg("cast") ? parseCastOverride(arg("cast")!, members.map((m) => m.slug)) : selectCast(sel.selected.map((s) => s.idf_domain_code), history);
  const auditCtx = {
    lexicon: lex.lexicon, archetypeExceptions: lex.archetypeExceptions, networks: lex.networks, castSlugs: lex.castSlugs,
    signalText: sel.selected.map((s) => `${s.title} ${s.summary ?? ""} ${s.publisher ?? ""}`).join("\n"),
  };
  const audit = (script: EpisodeScript) => auditScript(script, auditCtx, cast.cast.map((c) => c.slug));

  {
    const built = await buildEpisode({
      digest_date: date, nn, show: arg("show") ?? DEFAULT_SHOW, rows, history, castOverride: arg("cast"), members, shared,
      llm: mock ? mockLlm : anthropicLlm(), audit, log,
    });
    const row = built.row;
    const finalAudit = row.script ? audit(row.script) : null;

    const dir = join(resolve(arg("out") ?? join(ROOT, "out", "podcast")), id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "episode-row.json"), JSON.stringify(row, null, 2) + "\n");
    if (row.script) writeFileSync(join(dir, "script.json"), JSON.stringify(row.script, null, 2) + "\n");
    if (row.show_notes_md) writeFileSync(join(dir, "show-notes.md"), row.show_notes_md);
    writeFileSync(join(dir, "audit.json"), JSON.stringify({ attempts: built.attempts, real_name_audit: finalAudit, grading: built.grades }, null, 2) + "\n");
    log(`dumped ${dir}`);

    if (!dryRun) {
      const existing = await sb!.from("tf_episodes").select("episode_id,status").eq("episode_id", id).maybeSingle();
      if (existing.error) throw new Error(`tf_episodes: ${existing.error.message}`);
      if (existing.data && !flag("replace")) { console.error(`${id} already exists (status ${existing.data.status}); pass --replace to overwrite a scripted or failed row`); return 1; }
      if (existing.data && !["scripted", "failed"].includes(existing.data.status)) { console.error(`${id} is ${existing.data.status}; only scripted or failed rows can be replaced`); return 1; }
      const { error } = await sb!.from("tf_episodes").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "episode_id" });
      if (error) throw new Error(`tf_episodes write: ${error.message}`);
      log(`wrote tf_episodes ${id} (${row.status})`);
    } else log("dry run: tf_episodes not written");

    console.log(JSON.stringify({ episode_id: id, status: row.status, word_count: row.word_count, target_minutes: row.target_minutes, attempts: built.attempts.map((a) => `${a.n}:${a.outcome}`), audit_review_items: finalAudit?.review.length ?? null, reason: row.status === "failed" ? (row.signals as { failure?: { reason: string } }).failure?.reason : null }, null, 2));
    return row.status === "scripted" ? 0 : 1;
  }
}

main().then((c) => process.exit(c), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
