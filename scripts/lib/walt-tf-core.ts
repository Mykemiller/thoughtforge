// Walt-TF core (Linear TH-38, PP-04): one tf_episodes script -> per-turn ElevenLabs TTS -> ffmpeg mixdown -> R2 -> tf_episodes.
//
// Ported from the Throughline Walt pipeline shape (generate mode, idempotency check, R2 upload with one retry, R2 rollback on
// a Supabase write failure, one report at the end), with the ThoughtForge bindings: three panelists per episode, voices named
// in src/data/panel.ts and resolved by exact name (never cloned, never a hand-copied id), bucket thoughtforge-episodes,
// record tf_episodes, no Airtable. Audio only; video is PP-09.
//
// Everything that touches the network, the database, the bucket or ffmpeg is injected, so the tests drive the real pipeline
// against a fake ElevenLabs server, an in-memory store and an in-memory episode repo. Keys are read by the CLI from
// process.env and are never logged or written anywhere.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { pickVoice, VoiceError, type VoiceEntry } from "../../src/voice/resolve.ts";
import { scriptSchema, type EpisodeScript } from "../../src/lib/podcast/script-schema.ts";

const run = promisify(execFile);

export const ELEVENLABS_API = "https://api.elevenlabs.io";
export const TTS_MODEL = "eleven_multilingual_v2";
export const TTS_OUTPUT_FORMAT = "mp3_44100_128";
export const TTS_VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0.2 } as const;
export const TTS_CONCURRENCY = 3;
export const TTS_MAX_RETRIES = 3;
export const SAMPLE_RATE = 44100;
export const GAP_TURN_MS = 350;
export const GAP_SEGMENT_MS = 900;
export const DURATION_MIN_S = 9 * 60;
export const DURATION_MAX_S = 15 * 60 + 30;
export const TURN_CACHE_DAYS = 7;
export const R2_BUCKET_NAME = "thoughtforge-episodes";
export const DICTIONARY_NAME = "thoughtforge-podcast";
export const r2Key = (episodeId: string) => `episodes/${episodeId}/audio.mp3`;

/** Live-run environment, in the order a missing one is reported. HEYGEN_API_KEY is not needed until PP-09 (video). */
export const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ELEVENLABS_API_KEY",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
] as const;

export function missingEnv(env: Record<string, string | undefined>): string | null {
  for (const k of REQUIRED_ENV) if (!env[k] || !env[k]!.trim()) return k;
  return null;
}

/** "2026-11-14 14:52:07 CT" — logs are in US Central. */
export function ct(d = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} CT`;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// ---------------------------------------------------------------------------------------------------------------- plan

export interface PlannedTurn {
  n: number; // 1-based, across the whole episode
  segment: number; // 0-based segment index
  speaker: string; // cast slug
  text: string;
  file: string; // NNN-<slug>.mp3
  gapBeforeMs: number; // 0 for the first turn, 900 at a segment boundary, else 350
}

export function planTurns(script: Pick<EpisodeScript, "segments">): PlannedTurn[] {
  const out: PlannedTurn[] = [];
  script.segments.forEach((seg, si) => {
    seg.turns.forEach((t, ti) => {
      const n = out.length + 1;
      out.push({
        n, segment: si, speaker: t.speaker, text: t.text,
        file: `${String(n).padStart(3, "0")}-${t.speaker}.mp3`,
        gapBeforeMs: n === 1 ? 0 : ti === 0 ? GAP_SEGMENT_MS : GAP_TURN_MS,
      });
    });
  });
  return out;
}

export interface PanelVoice { slug: string; elevenLabsVoiceName?: string }

/** The first speaker with no ElevenLabs voice name in the manifest, or null. No fallback voice, ever. */
export function speakerWithoutVoice(turns: PlannedTurn[], panel: PanelVoice[]): string | null {
  const bySlug = new Map(panel.map((p) => [p.slug, p]));
  for (const t of turns) if (!bySlug.get(t.speaker)?.elevenLabsVoiceName?.trim()) return t.speaker;
  return null;
}

export function estimateSeconds(script: EpisodeScript, turns: PlannedTurn[]): number {
  const speech = script.segments.reduce((n, s) => n + s.turns.reduce((m, t) => m + t.est_seconds, 0), 0);
  return Math.round(speech + turns.reduce((n, t) => n + t.gapBeforeMs, 0) / 1000);
}

export function durationProblem(seconds: number, min = DURATION_MIN_S, max = DURATION_MAX_S): string | null {
  if (!Number.isFinite(seconds)) return "ffprobe could not measure the mixdown duration";
  if (seconds > max) return `duration ${mmss(seconds)} is above ${mmss(max)}`;
  if (seconds < min) return `duration ${mmss(seconds)} is below ${mmss(min)}`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------- elevenlabs

export interface DictionaryRule { type: "alias"; string_to_replace: string; alias: string }
export interface DictionaryLocator { pronunciation_dictionary_id: string; version_id: string }
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ElevenLabs {
  constructor(
    private readonly key: string,
    private readonly base = ELEVENLABS_API,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: Sleep = realSleep,
  ) {}

  private async req(path: string, init: RequestInit = {}, retries = TTS_MAX_RETRIES): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers: { "xi-api-key": this.key, ...(init.headers ?? {}) } });
      } catch (e) {
        // network-level failure (reset, DNS): retry like a 5xx; the message never carries headers
        if (attempt >= retries) throw new Error(`ElevenLabs ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${(e as Error).message}`);
        await this.sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) {
        const detail = (await res.text().catch(() => "")).slice(0, 160).replace(/\s+/g, " ");
        throw new Error(`ElevenLabs ${init.method ?? "GET"} ${path.split("?")[0]} failed (${res.status})${detail ? `: ${detail}` : ""}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      await res.body?.cancel().catch(() => {});
      await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1000 * 2 ** attempt);
    }
  }

  async listVoices(): Promise<VoiceEntry[]> {
    const body = (await (await this.req("/v1/voices")).json()) as { voices?: { voice_id: string; name: string }[] };
    return (body.voices ?? []).map((v) => ({ voice_id: v.voice_id, name: v.name }));
  }

  async listDictionaries(): Promise<{ id: string; name: string; latest_version_id: string }[]> {
    const body = (await (await this.req("/v1/pronunciation-dictionaries?page_size=100")).json()) as {
      pronunciation_dictionaries?: { id: string; name: string; latest_version_id: string }[];
    };
    return body.pronunciation_dictionaries ?? [];
  }

  async createDictionary(name: string, rules: DictionaryRule[]): Promise<DictionaryLocator> {
    const res = await this.req("/v1/pronunciation-dictionaries/add-from-rules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, rules, description: "ThoughtForge Panel Podcast (TH-38); source podcast/pronunciation.json" }),
    });
    const b = (await res.json()) as { id: string; version_id: string };
    return { pronunciation_dictionary_id: b.id, version_id: b.version_id };
  }

  async setDictionaryRules(id: string, rules: DictionaryRule[]): Promise<DictionaryLocator> {
    const res = await this.req(`/v1/pronunciation-dictionaries/${encodeURIComponent(id)}/set-rules`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }),
    });
    const b = (await res.json()) as { id: string; version_id: string };
    return { pronunciation_dictionary_id: b.id, version_id: b.version_id };
  }

  async tts(voiceId: string, text: string, locators: DictionaryLocator[]): Promise<Buffer> {
    const res = await this.req(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${TTS_OUTPUT_FORMAT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: TTS_MODEL, voice_settings: TTS_VOICE_SETTINGS, pronunciation_dictionary_locators: locators }),
    });
    return Buffer.from(await res.arrayBuffer());
  }
}

export interface VoiceCache { voices: Record<string, { voice_id: string; resolved_at: string }> }

/** Resolve every speaker's voice name to an id against the account's voices (exact name; zero or several matches fail). */
export function resolveSpeakerVoices(speakers: string[], panel: PanelVoice[], voices: VoiceEntry[], cache: VoiceCache, now = new Date()): { ids: Map<string, string>; cache: VoiceCache } {
  const next: VoiceCache = { voices: { ...cache.voices } };
  const ids = new Map<string, string>();
  for (const slug of speakers) {
    const name = panel.find((p) => p.slug === slug)?.elevenLabsVoiceName;
    if (!name) throw new VoiceError(`no ElevenLabs voice for ${slug} in src/data/panel.ts`, "missing");
    let hit: VoiceEntry;
    try { hit = pickVoice(voices, name); } catch (e) { throw new VoiceError(`${slug}: ${(e as Error).message}`, (e as VoiceError).code ?? "missing"); }
    ids.set(slug, hit.voice_id);
    if (next.voices[name]?.voice_id !== hit.voice_id) next.voices[name] = { voice_id: hit.voice_id, resolved_at: now.toISOString() };
  }
  return { ids, cache: next };
}

export interface DictionaryCache { name: string; id: string; version_id: string; rules_sha256: string }
export const rulesHash = (rules: DictionaryRule[]) => createHash("sha256").update(JSON.stringify(rules)).digest("hex");

export function validateRules(rules: unknown): DictionaryRule[] {
  if (!Array.isArray(rules)) throw new Error("podcast/pronunciation.json: rules must be an array");
  const seen = new Set<string>();
  for (const r of rules as DictionaryRule[]) {
    if (r?.type !== "alias" || !r.string_to_replace?.trim() || !r.alias?.trim()) throw new Error(`podcast/pronunciation.json: bad rule ${JSON.stringify(r)} (alias rules only: they work with ${TTS_MODEL})`);
    if (seen.has(r.string_to_replace)) throw new Error(`podcast/pronunciation.json: "${r.string_to_replace}" appears twice`);
    seen.add(r.string_to_replace);
  }
  return rules as DictionaryRule[];
}

/** Create the "thoughtforge-podcast" dictionary once; push new rules only when podcast/pronunciation.json changed. */
export async function ensureDictionary(el: ElevenLabs, rules: DictionaryRule[], cache: DictionaryCache | null, log: (m: string) => void): Promise<{ locator: DictionaryLocator; cache: DictionaryCache }> {
  const sha = rulesHash(rules);
  if (cache && cache.name === DICTIONARY_NAME && cache.rules_sha256 === sha) {
    return { locator: { pronunciation_dictionary_id: cache.id, version_id: cache.version_id }, cache };
  }
  const existing = (await el.listDictionaries()).find((d) => d.name === DICTIONARY_NAME);
  let locator: DictionaryLocator;
  if (!existing) {
    locator = await el.createDictionary(DICTIONARY_NAME, rules);
    log(`created pronunciation dictionary ${DICTIONARY_NAME} (${rules.length} rules)`);
  } else {
    locator = await el.setDictionaryRules(existing.id, rules);
    log(`synced pronunciation dictionary ${DICTIONARY_NAME} to ${rules.length} rules (podcast/pronunciation.json changed or no cache)`);
  }
  return { locator, cache: { name: DICTIONARY_NAME, id: locator.pronunciation_dictionary_id, version_id: locator.version_id, rules_sha256: sha } };
}

// -------------------------------------------------------------------------------------------------------------- turns

export async function pool<T>(items: T[], size: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (i < items.length && !failed) {
      const x = items[i++];
      try { await fn(x); } catch (e) { failed ??= e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  if (failed) throw failed;
}

export const TURN_MANIFEST = "manifest.json";
type TurnManifest = Record<string, string>; // file -> content key

/** What a cached turn file must match to be reused: voice, text, model, settings and dictionary version. */
export function turnKey(voiceId: string, text: string, locators: DictionaryLocator[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ voiceId, text, model: TTS_MODEL, format: TTS_OUTPUT_FORMAT, settings: TTS_VOICE_SETTINGS, dict: locators.map((l) => `${l.pronunciation_dictionary_id}@${l.version_id}`) }))
    .digest("hex");
}

function readManifest(dir: string): TurnManifest {
  try { return JSON.parse(readFileSync(join(dir, TURN_MANIFEST), "utf8")) as TurnManifest; } catch { return {}; }
}

function writeAtomic(path: string, data: string | Buffer) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

const fresh = (path: string, now: number) => existsSync(path) && statSync(path).size > 0 && now - statSync(path).mtimeMs < TURN_CACHE_DAYS * 86_400_000;

/**
 * Synthesize each turn into dir. A turn file is reused only if it is younger than 7 days AND its manifest key matches
 * the current voice id, text, model, settings and dictionary version (so a replaced script or new pronunciation rules
 * re-voice exactly the turns that changed). Returns how many were synthesized.
 */
export async function synthesizeTurns(
  turns: PlannedTurn[], dir: string, el: ElevenLabs, voiceIds: Map<string, string>, locators: DictionaryLocator[],
  opts: { force?: boolean; forceTurns?: Set<number>; concurrency?: number; now?: number } = {},
): Promise<{ synthesized: number; reused: number }> {
  mkdirSync(dir, { recursive: true });
  const now = opts.now ?? Date.now();
  const manifest = readManifest(dir);
  const keys = new Map(turns.map((t) => [t.n, turnKey(voiceIds.get(t.speaker)!, t.text, locators)]));
  const todo = turns.filter((t) => opts.force || opts.forceTurns?.has(t.n) || manifest[t.file] !== keys.get(t.n) || !fresh(join(dir, t.file), now));
  try {
    await pool(todo, opts.concurrency ?? TTS_CONCURRENCY, async (t) => {
      const audio = await el.tts(voiceIds.get(t.speaker)!, t.text, locators);
      if (!audio.length) throw new Error(`turn ${t.n} (${t.speaker}): ElevenLabs returned no audio`);
      writeAtomic(join(dir, t.file), audio);
      manifest[t.file] = keys.get(t.n)!;
    });
  } finally {
    writeAtomic(join(dir, TURN_MANIFEST), JSON.stringify(manifest, null, 2) + "\n"); // keep what did succeed
  }
  return { synthesized: todo.length, reused: turns.length - todo.length };
}

/** Remove per-turn caches whose newest file is older than 7 days under out/podcast/<episode>/turns. */
export function pruneTurnCaches(podcastOut: string, now = Date.now()): string[] {
  if (!existsSync(podcastOut)) return [];
  const removed: string[] = [];
  for (const ep of readdirSync(podcastOut)) {
    const turns = join(podcastOut, ep, "turns");
    if (!existsSync(turns)) continue;
    const newest = Math.max(statSync(turns).mtimeMs, ...readdirSync(turns).map((f) => statSync(join(turns, f)).mtimeMs));
    if (now - newest > TURN_CACHE_DAYS * 86_400_000) {
      rmSync(turns, { recursive: true, force: true });
      removed.push(ep);
    }
  }
  return removed;
}

// ------------------------------------------------------------------------------------------------------------- ffmpeg

export async function hasFfmpeg(): Promise<boolean> {
  try { await run("ffmpeg", ["-version"]); await run("ffprobe", ["-version"]); return true; } catch { return false; }
}

/** The ffmpeg argument list for the mixdown (exported for tests): 44.1 kHz mono throughout, loudnorm to -16 LUFS. */
export function mixdownArgs(turnPaths: string[], gapsMs: number[], wavOut: string, mp3Out: string): string[] {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const p of turnPaths) args.push("-i", p);
  const parts: string[] = [];
  const order: string[] = [];
  turnPaths.forEach((_, i) => {
    if (gapsMs[i] > 0) {
      parts.push(`anullsrc=r=${SAMPLE_RATE}:cl=mono,atrim=duration=${(gapsMs[i] / 1000).toFixed(3)}[g${i}]`);
      order.push(`[g${i}]`);
    }
    parts.push(`[${i}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=mono[t${i}]`);
    order.push(`[t${i}]`);
  });
  parts.push(`${order.join("")}concat=n=${order.length}:v=0:a=1[cat]`);
  parts.push(`[cat]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=${SAMPLE_RATE},asplit=2[w][m]`);
  args.push("-filter_complex", parts.join(";"));
  args.push("-map", "[w]", "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", wavOut);
  args.push("-map", "[m]", "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "libmp3lame", "-b:a", "128k", mp3Out);
  return args;
}

export async function mixdown(turns: PlannedTurn[], turnDir: string, outDir: string): Promise<{ mp3: string; wav: string }> {
  mkdirSync(outDir, { recursive: true });
  const wav = join(outDir, "audio.wav");
  const mp3 = join(outDir, "audio.mp3");
  try {
    await run("ffmpeg", mixdownArgs(turns.map((t) => join(turnDir, t.file)), turns.map((t) => t.gapBeforeMs), wav, mp3), { maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = (e as { stderr?: string }).stderr?.trim().split("\n").slice(-2).join(" ") || (e as Error).message;
    throw new Error(`ffmpeg mixdown failed: ${err}`);
  }
  return { mp3, wav };
}

export async function probe(path: string): Promise<{ seconds: number; sampleRate: number; channels: number }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels:format=duration", "-of", "json", path]);
  const j = JSON.parse(stdout) as { streams?: { sample_rate?: string; channels?: number }[]; format?: { duration?: string } };
  return { seconds: Number(j.format?.duration ?? NaN), sampleRate: Number(j.streams?.[0]?.sample_rate ?? NaN), channels: Number(j.streams?.[0]?.channels ?? NaN) };
}

// ------------------------------------------------------------------------------------------------ store, repo, report

export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export async function putWithRetry(store: ObjectStore, key: string, body: Buffer, sleep: Sleep = realSleep): Promise<void> {
  try { await store.put(key, body, "audio/mpeg"); } catch {
    await sleep(2000);
    await store.put(key, body, "audio/mpeg");
  }
}

export const publicUrl = (base: string, key: string) => `${base.replace(/\/+$/, "")}/${key}`;

export interface EpisodeRow {
  episode_id: string;
  status: string;
  title: string | null;
  cast: { slug: string; role: string }[] | null;
  script: unknown;
  word_count: number | null;
  audio_url: string | null;
}

export interface EpisodeRepo {
  get(episodeId: string): Promise<EpisodeRow | null>;
  markAudioReady(episodeId: string, v: { audio_url: string; duration_seconds: number }): Promise<void>;
  markFailed(episodeId: string, reason: string): Promise<void>;
}

export type Regen = "audio" | "all" | null;

export function statusGate(row: EpisodeRow, regen: Regen): { exit: number; message: string } | null {
  if (row.audio_url && row.status !== "failed" && !regen) return { exit: 0, message: `${row.episode_id} already has audio: ${row.audio_url} (pass --regen audio|all to rebuild)` };
  if (row.status === "scripted" || row.status === "failed") return null;
  if (row.status === "audio_ready" && regen) return null;
  if (row.status === "audio_ready") return { exit: 1, message: `${row.episode_id} is audio_ready; pass --regen audio|all to rebuild` };
  return { exit: 1, message: `${row.episode_id} is ${row.status}; walt-tf only runs on scripted or failed episodes (audio_ready with --regen)` };
}

export interface Report {
  episode_id: string;
  cast: string;
  duration: string;
  audio_url: string;
  word_count: number | null;
  turns: string;
  warnings: string[];
}

export function formatReport(r: Report): string {
  return [
    `walt-tf report · ${ct()}`,
    `  episode    ${r.episode_id}`,
    `  cast       ${r.cast}`,
    `  duration   ${r.duration}`,
    `  audio      ${r.audio_url}`,
    `  words      ${r.word_count ?? "?"}`,
    `  turns      ${r.turns}`,
    `  warnings   ${r.warnings.length ? r.warnings.join("; ") : "none"}`,
  ].join("\n");
}

// --------------------------------------------------------------------------------------------------------- orchestrate

export interface ProduceOptions {
  episodeId: string;
  regen: Regen;
  regenTurn: number | null;
  outRoot: string; // out/podcast
  durationMin?: number;
  durationMax?: number;
}

export interface ProduceDeps {
  repo: EpisodeRepo;
  el: ElevenLabs;
  store: ObjectStore;
  publicBaseUrl: string;
  panel: PanelVoice[];
  rules: DictionaryRule[];
  voiceCache: VoiceCache;
  dictionaryCache: DictionaryCache | null;
  saveVoiceCache: (c: VoiceCache) => void;
  saveDictionaryCache: (c: DictionaryCache) => void;
  readFile: (p: string) => Buffer;
  log: (m: string) => void;
  sleep?: Sleep;
}

export interface ProduceResult { exit: number; message: string; report?: Report }

export function parseScript(raw: unknown): { script: EpisodeScript } | { error: string } {
  const p = scriptSchema.safeParse(raw);
  if (p.success) return { script: p.data };
  return { error: `script does not match the PP-03 schema: ${p.error.issues.slice(0, 2).map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}` };
}

export async function produce(o: ProduceOptions, d: ProduceDeps): Promise<ProduceResult> {
  const row = await d.repo.get(o.episodeId);
  if (!row) return { exit: 1, message: `no tf_episodes row ${o.episodeId} (run npm run podcast:script first)` };
  const gate = statusGate(row, o.regenTurn ? (o.regen ?? "audio") : o.regen);
  if (gate) return gate;

  const parsed = parseScript(row.script);
  if ("error" in parsed) return { exit: 1, message: `${o.episodeId}: ${parsed.error}` };
  const script = parsed.script;
  const turns = planTurns(script);
  if (o.regenTurn !== null && !turns.some((t) => t.n === o.regenTurn)) return { exit: 1, message: `--regen-turn ${o.regenTurn} is out of range (1-${turns.length})` };
  const noVoice = speakerWithoutVoice(turns, d.panel);
  if (noVoice) return { exit: 1, message: `no ElevenLabs voice for ${noVoice} in src/data/panel.ts` };

  const speakers = [...new Set(turns.map((t) => t.speaker))];
  const warnings: string[] = [];
  const fail = async (reason: string): Promise<ProduceResult> => {
    let note = "";
    try { await d.repo.markFailed(o.episodeId, reason); } catch (e) { note = ` (could not record the failure on tf_episodes: ${(e as Error).message})`; }
    return { exit: 1, message: `${o.episodeId} failed: ${reason}${note}` };
  };

  let voiceIds: Map<string, string>;
  try {
    const r = resolveSpeakerVoices(speakers, d.panel, await d.el.listVoices(), d.voiceCache);
    voiceIds = r.ids;
    if (JSON.stringify(r.cache) !== JSON.stringify(d.voiceCache)) d.saveVoiceCache(r.cache);
  } catch (e) {
    return { exit: 1, message: (e as Error).message }; // a naming problem, not an episode failure: status unchanged
  }
  d.log(`voices: ${speakers.map((s) => `${s}=${voiceIds.get(s)}`).join(", ")}`);

  const dict = await ensureDictionary(d.el, d.rules, d.dictionaryCache, d.log);
  if (JSON.stringify(dict.cache) !== JSON.stringify(d.dictionaryCache)) d.saveDictionaryCache(dict.cache);

  const epDir = join(o.outRoot, o.episodeId);
  const turnDir = join(epDir, "turns");
  let counts: { synthesized: number; reused: number };
  try {
    counts = await synthesizeTurns(turns, turnDir, d.el, voiceIds, [dict.locator], {
      force: o.regen === "all", forceTurns: o.regenTurn ? new Set([o.regenTurn]) : undefined,
    });
  } catch (e) {
    return fail(`TTS: ${(e as Error).message}`);
  }
  d.log(`turns: ${counts.synthesized} synthesized, ${counts.reused} reused from ${turnDir}`);

  let files: { mp3: string; wav: string };
  let seconds: number;
  try {
    files = await mixdown(turns, turnDir, epDir);
    const p = await probe(files.mp3);
    seconds = Math.round(p.seconds);
    if (p.sampleRate !== SAMPLE_RATE || p.channels !== 1) warnings.push(`mixdown is ${p.sampleRate} Hz / ${p.channels} ch`);
  } catch (e) {
    return fail((e as Error).message);
  }
  const bad = durationProblem(seconds, o.durationMin, o.durationMax);
  if (bad) return fail(bad);
  d.log(`mixdown ${mmss(seconds)} -> ${files.mp3} (+ audio.wav master)`);

  const key = r2Key(o.episodeId);
  try {
    await putWithRetry(d.store, key, d.readFile(files.mp3), d.sleep);
  } catch (e) {
    return { exit: 1, message: `${o.episodeId}: R2 upload of ${key} failed after one retry: ${(e as Error).message}` };
  }
  const audioUrl = publicUrl(d.publicBaseUrl, key);
  try {
    await d.repo.markAudioReady(o.episodeId, { audio_url: audioUrl, duration_seconds: seconds });
  } catch (e) {
    const why = `${o.episodeId}: tf_episodes update failed (${(e as Error).message})`;
    if (row.audio_url) {
      // a --regen overwrote the key the row already points at: deleting it would leave the row pointing at a 404
      return { exit: 1, message: `${why}; R2 object ${key} was overwritten with the new mix and kept, because the row still points at it` };
    }
    try { await d.store.delete(key); } catch (e2) { return { exit: 1, message: `${why}; R2 rollback of ${key} ALSO failed (${(e2 as Error).message}): delete it by hand` }; }
    return { exit: 1, message: `${why}; R2 object ${key} removed` };
  }

  const roles = new Map((row.cast ?? []).map((c) => [c.slug, c.role]));
  const report: Report = {
    episode_id: o.episodeId,
    cast: speakers.map((s) => `${s}${roles.get(s) === "chair" ? " (chair)" : ""}`).join(", "),
    duration: mmss(seconds),
    audio_url: audioUrl,
    word_count: script.word_count ?? row.word_count,
    turns: `${turns.length} (${counts.synthesized} synthesized, ${counts.reused} reused)`,
    warnings,
  };
  return { exit: 0, message: formatReport(report), report };
}

/** Dry run: no network, no database, no ffmpeg. Validates the local row and prints the plan. */
export function dryRunPlan(o: { episodeId: string; outRoot: string }, raw: { script?: unknown; cast?: { slug: string; role: string }[] }, panel: PanelVoice[], voiceCache: VoiceCache, publicBaseUrl?: string): ProduceResult {
  const parsed = parseScript(raw.script);
  if ("error" in parsed) return { exit: 1, message: `${o.episodeId}: ${parsed.error}` };
  const turns = planTurns(parsed.script);
  const noVoice = speakerWithoutVoice(turns, panel);
  if (noVoice) return { exit: 1, message: `no ElevenLabs voice for ${noVoice} in src/data/panel.ts` };
  const speakers = [...new Set(turns.map((t) => t.speaker))];
  const est = estimateSeconds(parsed.script, turns);
  const voiceLines = speakers.map((s) => {
    const name = panel.find((p) => p.slug === s)!.elevenLabsVoiceName!;
    return `    ${s.padEnd(18)} "${name}" ${voiceCache.voices[name] ? `(cached id ${voiceCache.voices[name].voice_id})` : "(resolved at run time)"}`;
  });
  const key = r2Key(o.episodeId);
  const lines = [
    `walt-tf dry run · ${ct()} · no network, no database, no ffmpeg`,
    `  episode    ${o.episodeId} (${parsed.script.word_count} words)`,
    `  turns      ${turns.length} in ${parsed.script.segments.length} segments -> ${join(o.outRoot, o.episodeId, "turns")}/NNN-<slug>.mp3`,
    `  voices`,
    ...voiceLines,
    `  tts        ${TTS_MODEL}, ${TTS_OUTPUT_FORMAT}, stability ${TTS_VOICE_SETTINGS.stability} / similarity ${TTS_VOICE_SETTINGS.similarity_boost} / style ${TTS_VOICE_SETTINGS.style}, dictionary "${DICTIONARY_NAME}", concurrency ${TTS_CONCURRENCY}`,
    `  mixdown    gaps ${GAP_TURN_MS} ms / ${GAP_SEGMENT_MS} ms, loudnorm I=-16 TP=-1.5 LRA=11, audio.mp3 128 kbps mono + audio.wav, ${SAMPLE_RATE} Hz`,
    `  estimate   ${mmss(est)} from est_seconds (gate ${mmss(DURATION_MIN_S)}-${mmss(DURATION_MAX_S)}${durationProblem(est) ? `; WARNING ${durationProblem(est)}` : ""})`,
    `  upload     R2 ${R2_BUCKET_NAME}/${key}${publicBaseUrl ? ` -> ${publicUrl(publicBaseUrl, key)}` : ""}`,
  ];
  return { exit: 0, message: lines.join("\n") };
}
