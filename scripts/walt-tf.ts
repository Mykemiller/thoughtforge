// Walt-TF: produce one Panel Podcast episode's audio (Linear TH-38, PP-04).
//
//   pnpm walt:tf <episode_id> [--regen audio|all] [--regen-turn N] [--dry-run] [--row-file path]
//   pnpm walt:tf PP-20261107-01 --dry-run                  # plan only: no network, no database, no ffmpeg
//   pnpm walt:tf PP-20261101-01                            # TTS -> mixdown -> R2 -> tf_episodes (status audio_ready)
//   pnpm walt:tf PP-20261101-01 --regen-turn 7             # re-voice one bad turn, reuse the rest, re-mix, re-upload
//   pnpm walt:tf <id> --video                              # stub: video is PP-09
//
// Keys come from process.env (or .env.local from `vercel env pull .env.local`) and are never printed or written.
// A missing variable stops the run with one line naming it. Before any Supabase use the project ref is asserted to be
// ycadmmngkdhvpcsrcuaq. Voices are resolved by exact name from src/data/panel.ts; nothing is ever cloned.
// Per-turn MP3s stay in out/podcast/<id>/turns/ (gitignored) for 7 days so one bad turn can be redone cheaply.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PANEL } from "../src/data/panel.ts";
import { requireServiceEnv } from "./lib/supabase-guard.ts";
import {
  ct, dryRunPlan, ElevenLabs, missingEnv, produce, pruneTurnCaches, R2_BUCKET_NAME, validateRules, hasFfmpeg,
  type DictionaryCache, type EpisodeRepo, type EpisodeRow, type ObjectStore, type Regen, type VoiceCache,
} from "./lib/walt-tf-core.ts";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "out", "podcast");
const VOICE_CACHE = join(ROOT, "podcast", "voice-ids.json");
const DICT_CACHE = join(ROOT, "podcast", "pronunciation-dictionary.json");
const RULES = join(ROOT, "podcast", "pronunciation.json");
const log = (m: string) => console.error(`[walt-tf ${ct()}] ${m}`);

function loadDotEnvLocal() {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const readJson = <T>(p: string, fallback: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fallback);
const writeJson = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
const USAGE = "usage: pnpm walt:tf <episode_id> [--regen audio|all] [--regen-turn N] [--dry-run] [--row-file path] [--video]";

async function main(): Promise<number> {
  if (flag("video")) { console.error("video is PP-09"); return 2; }
  const episodeId = argv.find((a, i) => !a.startsWith("--") && !["--regen", "--regen-turn", "--row-file"].includes(argv[i - 1] ?? ""));
  if (!episodeId || !/^PP-\d{8}-\d{2}$/.test(episodeId)) { console.error(USAGE); return 2; }
  const regenRaw = opt("regen");
  if (regenRaw !== undefined && regenRaw !== "audio" && regenRaw !== "all") { console.error(USAGE); return 2; }
  const regen: Regen = (regenRaw as Regen) ?? null;
  const regenTurn = opt("regen-turn") !== undefined ? Number(opt("regen-turn")) : null;
  if (regenTurn !== null && (!Number.isInteger(regenTurn) || regenTurn < 1)) { console.error(USAGE); return 2; }
  const voiceCache = readJson<VoiceCache>(VOICE_CACHE, { voices: {} });

  if (flag("dry-run")) {
    const candidates = [opt("row-file"), join(OUT, episodeId, "episode-row.json"), join(ROOT, "fixtures", "podcast", episodeId, "episode-row.json")].filter(Boolean) as string[];
    const file = candidates.find((p) => existsSync(resolve(p)));
    if (!file) { console.error(`dry run needs a local episode row: --row-file, out/podcast/${episodeId}/episode-row.json or fixtures/podcast/${episodeId}/episode-row.json`); return 1; }
    const raw = JSON.parse(readFileSync(resolve(file), "utf8"));
    const r = dryRunPlan({ episodeId, outRoot: OUT }, raw, PANEL, voiceCache, process.env.R2_PUBLIC_BASE_URL);
    (r.exit === 0 ? console.log : console.error)(r.exit === 0 ? `${r.message}\n  source     ${file}` : r.message);
    return r.exit;
  }

  loadDotEnvLocal();
  const missing = missingEnv(process.env);
  if (missing) { console.error(`${missing} is not set (run \`vercel env pull .env.local\` in the linked checkout)`); return 1; }
  if (process.env.R2_BUCKET !== R2_BUCKET_NAME) { console.error(`R2_BUCKET must be ${R2_BUCKET_NAME}`); return 1; }
  if (!(await hasFfmpeg())) { console.error("ffmpeg and ffprobe must be on PATH"); return 1; }

  const { url, key } = requireServiceEnv(); // asserts ycadmmngkdhvpcsrcuaq, refuses the decoy
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const repo: EpisodeRepo = {
    async get(id) {
      const { data, error } = await sb.from("tf_episodes").select("episode_id,status,title,cast,script,word_count,audio_url").eq("episode_id", id).maybeSingle();
      if (error) throw new Error(`tf_episodes read: ${error.message}`);
      return (data as EpisodeRow | null) ?? null;
    },
    async markAudioReady(id, v) {
      const { error } = await sb.from("tf_episodes").update({ ...v, status: "audio_ready", failure_reason: null, updated_at: new Date().toISOString() }).eq("episode_id", id);
      if (error) throw new Error(error.message);
    },
    async markFailed(id, reason) {
      const { error } = await sb.from("tf_episodes").update({ status: "failed", failure_reason: reason.slice(0, 500), updated_at: new Date().toISOString() }).eq("episode_id", id);
      if (error) throw new Error(error.message);
    },
  };

  const bucket = process.env.R2_BUCKET!;
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  const store: ObjectStore = {
    async put(k, body, contentType) { await s3.send(new PutObjectCommand({ Bucket: bucket, Key: k, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000" })); },
    async delete(k) { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: k })); },
  };

  const pruned = pruneTurnCaches(OUT);
  if (pruned.length) log(`pruned turn caches older than 7 days: ${pruned.join(", ")}`);

  log(`start ${episodeId}${regen ? ` --regen ${regen}` : ""}${regenTurn ? ` --regen-turn ${regenTurn}` : ""}`);
  const r = await produce(
    { episodeId, regen, regenTurn, outRoot: OUT },
    {
      repo, store, el: new ElevenLabs(process.env.ELEVENLABS_API_KEY!), publicBaseUrl: process.env.R2_PUBLIC_BASE_URL!,
      panel: PANEL, rules: validateRules(readJson<{ rules: unknown }>(RULES, { rules: [] }).rules),
      voiceCache, dictionaryCache: readJson<DictionaryCache | null>(DICT_CACHE, null),
      saveVoiceCache: (c) => writeJson(VOICE_CACHE, c), saveDictionaryCache: (c) => writeJson(DICT_CACHE, c),
      readFile: (p) => readFileSync(p), log,
    },
  );
  (r.exit === 0 ? console.log : console.error)(r.message);
  return r.exit;
}

main().then((c) => process.exit(c), (e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
