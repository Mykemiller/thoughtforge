// Offline tests for Walt-TF (Linear TH-38, PP-04). Run: npm test
// A fake ElevenLabs server on 127.0.0.1 returns short MP3s made with ffmpeg; the store and the episode repo are in memory.
// Tests that need ffmpeg skip with a message when it is not on PATH (CI installs it).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PANEL } from "../../src/data/panel.ts";
import type { EpisodeScript } from "../../src/lib/podcast/script-schema.ts";
import {
  DURATION_MAX_S, DURATION_MIN_S, ElevenLabs, GAP_SEGMENT_MS, GAP_TURN_MS, REQUIRED_ENV, TTS_MODEL, dryRunPlan, durationProblem, ensureDictionary,
  hasFfmpeg, missingEnv, mixdown, mixdownArgs, planTurns, probe, produce, pruneTurnCaches, publicUrl, r2Key, resolveSpeakerVoices, speakerWithoutVoice,
  statusGate, validateRules, type DictionaryRule, type EpisodeRepo, type EpisodeRow, type ObjectStore, type ProduceDeps,
} from "../lib/walt-tf-core.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const PILOT = JSON.parse(readFileSync(join(ROOT, "fixtures/podcast/PP-20261107-01/episode-row.json"), "utf8"));
const FFMPEG = await hasFfmpeg();
const needsFfmpeg = FFMPEG ? {} : { skip: "ffmpeg/ffprobe not on PATH" };
const noSleep = async () => {};

// A tiny but schema-valid script: 6 segments, 8 turns, 3 speakers.
function tinyScript(): EpisodeScript {
  const t = (speaker: string, text: string) => ({ speaker, text, est_seconds: 1 });
  const segments: EpisodeScript["segments"] = [
    { kind: "cold_open", turns: [t("gilbert-faraday", "Welcome to the panel.")] },
    { kind: "signal", signal_id: "s1", turns: [t("gilbert-faraday", "First signal."), t("mach-eigen", "Numbers first.")] },
    { kind: "signal", signal_id: "s2", turns: [t("albert-thorne", "FERC again.")] },
    { kind: "signal", signal_id: "s3", turns: [t("mach-eigen", "Eight hundred volts.")] },
    { kind: "the_read", turns: [t("albert-thorne", "My read."), t("gilbert-faraday", "Ruling.")] },
    { kind: "sign_off", turns: [t("gilbert-faraday", "That is the panel.")] },
  ];
  const word_count = segments.reduce((n, s) => n + s.turns.reduce((m, x) => m + x.text.split(/\s+/).length, 0), 0);
  return { episode_id: "PP-20261114-01", show: "The ThoughtForge Panel", title: "Test", segments, pronunciation_terms: ["FERC"], word_count };
}

// ------------------------------------------------------------------------------------------------ fake ElevenLabs

let server: Server;
let base = "";
let toneMp3: Buffer = Buffer.alloc(0);
const calls: { method: string; path: string; body: string }[] = [];
let fail429Once = new Set<string>(); // voice ids that get one 429 first
const VOICES = [
  { voice_id: "v-gil", name: "Gil Faraday" },
  { voice_id: "v-mach", name: "Mach Eigen - Articulate Engineering Professor" },
  { voice_id: "v-albert", name: "Brian - Deep, Resonant and Comforting" },
  { voice_id: "v-dup1", name: "Sarah - Mature, Reassuring, Confident" },
  { voice_id: "v-dup2", name: "Sarah - Mature, Reassuring, Confident" },
];
let dictionaries: { id: string; name: string; latest_version_id: string }[] = [];

before(async () => {
  if (FFMPEG) {
    const dir = mkdtempSync(join(tmpdir(), "walt-tf-tone-"));
    const p = join(dir, "tone.mp3");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100:duration=1", "-filter:a", "volume=0.2", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", p]);
    toneMp3 = readFileSync(p);
    rmSync(dir, { recursive: true, force: true });
  }
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = req.url ?? "";
      calls.push({ method: req.method ?? "", path, body });
      if (req.headers["xi-api-key"] !== "test-key") { res.writeHead(401).end(); return; }
      if (path === "/v1/voices") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ voices: VOICES })); return; }
      if (path.startsWith("/v1/pronunciation-dictionaries?")) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ pronunciation_dictionaries: dictionaries })); return; }
      if (path === "/v1/pronunciation-dictionaries/add-from-rules") {
        const id = `dict-${dictionaries.length + 1}`;
        dictionaries.push({ id, name: JSON.parse(body).name, latest_version_id: "ver-1" });
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id, version_id: "ver-1" }));
        return;
      }
      const setRules = path.match(/^\/v1\/pronunciation-dictionaries\/([^/]+)\/set-rules$/);
      if (setRules) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: setRules[1], version_id: "ver-2" })); return; }
      const tts = path.match(/^\/v1\/text-to-speech\/([^/?]+)\?output_format=mp3_44100_128$/);
      if (tts && req.method === "POST") {
        if (fail429Once.has(tts[1])) { fail429Once.delete(tts[1]); res.writeHead(429).end("slow down"); return; }
        if (tts[1] === "v-broken") { res.writeHead(400).end("bad voice"); return; }
        res.writeHead(200, { "content-type": "audio/mpeg" }).end(toneMp3);
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});

after(() => new Promise<void>((r) => server.close(() => r())));

// ------------------------------------------------------------------------------------------------ fakes

function memRepo(row: EpisodeRow | null, opts: { failUpdate?: boolean } = {}) {
  const state = { row, audioReady: null as null | { audio_url: string; duration_seconds: number }, failed: null as null | string };
  const repo: EpisodeRepo = {
    async get() { return state.row; },
    async markAudioReady(_id, v) { if (opts.failUpdate) throw new Error("column \"failure_reason\" does not exist"); state.audioReady = v; },
    async markFailed(_id, reason) { state.failed = reason; },
  };
  return { repo, state };
}

function memStore() {
  const objects = new Map<string, Buffer>();
  const log: string[] = [];
  let putFailures = 0;
  const store: ObjectStore & { failNextPut(n: number): void } = {
    async put(k, b) { log.push(`put ${k}`); if (putFailures > 0) { putFailures--; throw new Error("503"); } objects.set(k, b); },
    async delete(k) { log.push(`delete ${k}`); objects.delete(k); },
    failNextPut(n) { putFailures = n; },
  };
  return { store, objects, log };
}

const rules: DictionaryRule[] = [{ type: "alias", string_to_replace: "FERC", alias: "ferk" }];

function deps(over: Partial<ProduceDeps> & Pick<ProduceDeps, "repo" | "store">): ProduceDeps & { saved: { voices: unknown; dict: unknown } } {
  const saved = { voices: null as unknown, dict: null as unknown };
  return {
    el: new ElevenLabs("test-key", base, fetch, noSleep), publicBaseUrl: "https://episodes.example.test/", panel: PANEL, rules,
    voiceCache: { voices: {} }, dictionaryCache: null, saveVoiceCache: (c) => (saved.voices = c), saveDictionaryCache: (c) => (saved.dict = c),
    readFile: (p) => readFileSync(p), log: () => {}, sleep: noSleep, saved, ...over,
  };
}

const row = (o: Partial<EpisodeRow> = {}): EpisodeRow => ({
  episode_id: "PP-20261114-01", status: "scripted", title: "Test", word_count: null, audio_url: null, script: tinyScript(),
  cast: [{ slug: "gilbert-faraday", role: "chair" }, { slug: "mach-eigen", role: "voice" }, { slug: "albert-thorne", role: "voice" }], ...o,
});

const tmpOut = () => mkdtempSync(join(tmpdir(), "walt-tf-out-"));

// ------------------------------------------------------------------------------------------------ pure

test("planTurns numbers turns across the episode and puts 900 ms at segment boundaries, 350 ms inside", () => {
  const turns = planTurns(tinyScript());
  assert.equal(turns.length, 8);
  assert.deepEqual(turns.map((t) => t.file).slice(0, 3), ["001-gilbert-faraday.mp3", "002-gilbert-faraday.mp3", "003-mach-eigen.mp3"]);
  assert.deepEqual(turns.map((t) => t.gapBeforeMs), [0, GAP_SEGMENT_MS, GAP_TURN_MS, GAP_SEGMENT_MS, GAP_SEGMENT_MS, GAP_SEGMENT_MS, GAP_TURN_MS, GAP_SEGMENT_MS]);
});

test("the PP-03 pilot fixture plans cleanly and every speaker has a voice name in the manifest", () => {
  const turns = planTurns(PILOT.script);
  assert.ok(turns.length > 20);
  assert.equal(speakerWithoutVoice(turns, PANEL), null);
});

test("missing env names exactly one variable, in order; HEYGEN_API_KEY is not required for audio", () => {
  const all = Object.fromEntries(REQUIRED_ENV.map((k) => [k, "x"]));
  assert.equal(missingEnv(all), null);
  assert.equal(missingEnv({ ...all, R2_BUCKET: "" }), "R2_BUCKET");
  assert.equal(missingEnv({ ...all, ELEVENLABS_API_KEY: undefined, R2_ACCOUNT_ID: undefined }), "ELEVENLABS_API_KEY");
  assert.ok(!(REQUIRED_ENV as readonly string[]).includes("HEYGEN_API_KEY"));
});

test("duration gate is 9:00 to 15:30", () => {
  assert.equal(DURATION_MIN_S, 540);
  assert.equal(DURATION_MAX_S, 930);
  assert.equal(durationProblem(600), null);
  assert.equal(durationProblem(931), "duration 15:31 is above 15:30");
  assert.equal(durationProblem(539), "duration 8:59 is below 9:00");
});

test("status gate: idempotent on audio_url, audio_ready needs --regen, published is refused", () => {
  assert.equal(statusGate(row(), null), null);
  assert.equal(statusGate(row({ status: "failed" }), null), null);
  const done = statusGate(row({ status: "audio_ready", audio_url: "https://x/a.mp3" }), null);
  assert.equal(done?.exit, 0);
  assert.match(done!.message, /already has audio: https:\/\/x\/a\.mp3/);
  assert.equal(statusGate(row({ status: "audio_ready", audio_url: "https://x/a.mp3" }), "audio"), null);
  assert.equal(statusGate(row({ status: "audio_ready" }), null)?.exit, 1);
  assert.match(statusGate(row({ status: "published" }), "all")!.message, /is published/);
});

test("voice resolution: exact name, one line on zero or several matches, cache records resolved ids", () => {
  const r = resolveSpeakerVoices(["gilbert-faraday", "mach-eigen"], PANEL, VOICES, { voices: {} }, new Date("2026-11-14T20:00:00Z"));
  assert.equal(r.ids.get("mach-eigen"), "v-mach");
  assert.deepEqual(r.cache.voices["Gil Faraday"], { voice_id: "v-gil", resolved_at: "2026-11-14T20:00:00.000Z" });
  assert.throws(() => resolveSpeakerVoices(["margo-brandt"], PANEL, VOICES, { voices: {} }), /margo-brandt: 2 voices named "Sarah/);
  assert.throws(() => resolveSpeakerVoices(["ingrid-halverson"], PANEL, VOICES, { voices: {} }), /ingrid-halverson: no voice named "Matilda/);
  assert.throws(() => resolveSpeakerVoices(["delia-marchetti"], PANEL, VOICES, { voices: {} }), /no ElevenLabs voice for delia-marchetti/);
});

test("podcast/pronunciation.json is alias-only with unique terms", () => {
  const file = JSON.parse(readFileSync(join(ROOT, "podcast/pronunciation.json"), "utf8"));
  const r = validateRules(file.rules);
  assert.ok(r.length >= 10);
  assert.throws(() => validateRules([{ type: "phoneme", string_to_replace: "x", alias: "y" }]), /alias rules only/);
  assert.throws(() => validateRules([rules[0], rules[0]]), /appears twice/);
});

test("R2 key and public URL", () => {
  assert.equal(r2Key("PP-20261101-01"), "episodes/PP-20261101-01/audio.mp3");
  assert.equal(publicUrl("https://cdn.example/", "episodes/a/audio.mp3"), "https://cdn.example/episodes/a/audio.mp3");
});

test("mixdown args: 44.1 kHz mono, loudnorm -16 LUFS, mp3 128 kbps plus wav", () => {
  const a = mixdownArgs(["/t/1.mp3", "/t/2.mp3"], [0, 350], "/o/audio.wav", "/o/audio.mp3").join(" ");
  assert.match(a, /anullsrc=r=44100:cl=mono,atrim=duration=0\.350/);
  assert.match(a, /loudnorm=I=-16:TP=-1\.5:LRA=11/);
  assert.match(a, /-c:a libmp3lame -b:a 128k \/o\/audio\.mp3/);
  assert.match(a, /-c:a pcm_s16le \/o\/audio\.wav/);
  assert.equal((a.match(/-ar 44100/g) ?? []).length, 2);
});

test("old turn caches are pruned after 7 days, fresh ones kept", () => {
  const out = tmpOut();
  for (const ep of ["PP-20261101-01", "PP-20261113-01"]) mkdirSync(join(out, ep, "turns"), { recursive: true });
  const old = (Date.now() - 8 * 86_400_000) / 1000;
  utimesSync(join(out, "PP-20261101-01", "turns"), old, old);
  assert.deepEqual(pruneTurnCaches(out), ["PP-20261101-01"]);
  assert.ok(existsSync(join(out, "PP-20261113-01", "turns")));
  rmSync(out, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------------ CLI shape and dry run

test("--video is a stub that names PP-09", () => {
  let code = 0;
  let stderr = "";
  try { execFileSync("npx", ["tsx", "scripts/walt-tf.ts", "PP-20261107-01", "--video"], { cwd: ROOT, stdio: "pipe" }); } catch (e) {
    code = (e as { status: number }).status; stderr = String((e as { stderr: Buffer }).stderr);
  }
  assert.equal(code, 2);
  assert.equal(stderr.trim(), "video is PP-09");
});

test("dry run performs no network calls and prints the plan for the pilot fixture", () => {
  const before = calls.length;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("network used in dry run"); }) as typeof fetch;
  try {
    const r = dryRunPlan({ episodeId: "PP-20261107-01", outRoot: "/tmp/out" }, PILOT, PANEL, { voices: { "Gil Faraday": { voice_id: "v-gil", resolved_at: "x" } } }, "https://episodes.example.test");
    assert.equal(r.exit, 0);
    assert.match(r.message, /no network, no database, no ffmpeg/);
    assert.match(r.message, /gilbert-faraday\s+"Gil Faraday" \(cached id v-gil\)/);
    assert.match(r.message, new RegExp(TTS_MODEL));
    assert.match(r.message, /https:\/\/episodes\.example\.test\/episodes\/PP-20261107-01\/audio\.mp3/);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls.length, before);
});

test("CLI dry run on the committed fixture exits 0 with no env at all", () => {
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  const out = execFileSync("npx", ["tsx", "scripts/walt-tf.ts", "PP-20261107-01", "--dry-run"], { cwd: ROOT, env, stdio: "pipe" }).toString();
  assert.match(out, /walt-tf dry run/);
  assert.match(out, /fixtures\/podcast\/PP-20261107-01\/episode-row\.json/);
});

test("missing voice: a speaker with no voice name stops with one line naming the slug, before any network", async () => {
  const s = tinyScript();
  s.segments[2].turns[0].speaker = "delia-marchetti";
  const { repo, state } = memRepo(row({ script: s }));
  const { store } = memStore();
  const before = calls.length;
  const r = await produce({ episodeId: "PP-20261114-01", regen: null, regenTurn: null, outRoot: tmpOut() }, deps({ repo, store }));
  assert.equal(r.exit, 1);
  assert.equal(r.message, "no ElevenLabs voice for delia-marchetti in src/data/panel.ts");
  assert.equal(calls.length, before);
  assert.equal(state.failed, null);
});

test("idempotency: an episode with audio_url prints it and exits 0 without touching ElevenLabs or R2", async () => {
  const { repo } = memRepo(row({ status: "audio_ready", audio_url: "https://episodes.example.test/episodes/PP-20261114-01/audio.mp3" }));
  const { store, log } = memStore();
  const before = calls.length;
  const r = await produce({ episodeId: "PP-20261114-01", regen: null, regenTurn: null, outRoot: tmpOut() }, deps({ repo, store }));
  assert.equal(r.exit, 0);
  assert.match(r.message, /already has audio/);
  assert.equal(calls.length, before);
  assert.deepEqual(log, []);
});

test("missing row and bad script are clean one-line errors", async () => {
  const { store } = memStore();
  const r1 = await produce({ episodeId: "PP-20261114-01", regen: null, regenTurn: null, outRoot: tmpOut() }, deps({ repo: memRepo(null).repo, store }));
  assert.match(r1.message, /^no tf_episodes row PP-20261114-01/);
  const r2 = await produce({ episodeId: "PP-20261114-01", regen: null, regenTurn: null, outRoot: tmpOut() }, deps({ repo: memRepo(row({ script: { segments: [] } })).repo, store }));
  assert.match(r2.message, /does not match the PP-03 schema/);
});

// ------------------------------------------------------------------------------------------------ full pipeline (ffmpeg)

test("pronunciation dictionary is created once, reused from cache, and re-synced when the rules change", async () => {
  dictionaries = [];
  const el = new ElevenLabs("test-key", base, fetch, noSleep);
  const first = await ensureDictionary(el, rules, null, () => {});
  assert.equal(first.locator.pronunciation_dictionary_id, "dict-1");
  const before = calls.length;
  const again = await ensureDictionary(el, rules, first.cache, () => {});
  assert.deepEqual(again.locator, first.locator);
  assert.equal(calls.length, before, "cached dictionary makes no calls");
  const changed = await ensureDictionary(el, [...rules, { type: "alias", string_to_replace: "PJM", alias: "P J M" }], first.cache, () => {});
  assert.deepEqual(changed.locator, { pronunciation_dictionary_id: "dict-1", version_id: "ver-2" });
  assert.equal(dictionaries.length, 1, "never creates a second dictionary");
});

test("end to end: TTS per turn with the right voice, 429 retried, mixdown 44.1 kHz mono, R2 put, row audio_ready", needsFfmpeg, async () => {
  dictionaries = [];
  fail429Once = new Set(["v-mach"]);
  const out = tmpOut();
  const { repo, state } = memRepo(row());
  const { store, objects } = memStore();
  const d = deps({ repo, store });
  const ttsBefore = calls.filter((c) => c.path.startsWith("/v1/text-to-speech/")).length;
  const r = await produce({ episodeId: "PP-20261114-01", regen: null, regenTurn: null, outRoot: out, durationMin: 0, durationMax: 60 }, d);
  assert.equal(r.exit, 0, r.message);

  const tts = calls.filter((c) => c.path.startsWith("/v1/text-to-speech/")).slice(ttsBefore);
  assert.equal(tts.length, 9, "8 turns + one 429 retry");
  const bodies = tts.map((c) => JSON.parse(c.body));
  assert.ok(bodies.every((b) => b.model_id === "eleven_multilingual_v2" && b.voice_settings.stability === 0.5 && b.voice_settings.similarity_boost === 0.75 && b.voice_settings.style === 0.2));
  assert.ok(bodies.every((b) => b.pronunciation_dictionary_locators[0].pronunciation_dictionary_id === "dict-1"));
  const ferc = tts.find((c) => JSON.parse(c.body).text === "FERC again.");
  assert.match(ferc!.path, /\/v-albert\?/);

  assert.equal(readdirSync(join(out, "PP-20261114-01", "turns")).length, 8);
  const p = await probe(join(out, "PP-20261114-01", "audio.mp3"));
  assert.equal(p.sampleRate, 44100);
  assert.equal(p.channels, 1);
  const w = await probe(join(out, "PP-20261114-01", "audio.wav"));
  assert.equal(w.sampleRate, 44100);
  // 8 x 1.0 s of speech + 5 x 0.9 s + 2 x 0.35 s of gaps = 13.2 s (mp3 framing adds a little)
  assert.ok(Math.abs(w.seconds - 13.2) < 0.4, `wav is ${w.seconds}s`);

  assert.ok(objects.has("episodes/PP-20261114-01/audio.mp3"));
  assert.deepEqual(state.audioReady, { audio_url: "https://episodes.example.test/episodes/PP-20261114-01/audio.mp3", duration_seconds: Math.round(p.seconds) });
  assert.equal(r.report?.cast, "gilbert-faraday (chair), mach-eigen, albert-thorne");
  assert.match(r.message, /walt-tf report/);
  assert.deepEqual((d.saved.voices as { voices: Record<string, unknown> }).voices["Gil Faraday"] !== undefined, true);

  // a rerun with --regen-turn 3 re-voices only that turn and reuses the other seven
  const { repo: repo2 } = memRepo(row({ status: "audio_ready", audio_url: "https://episodes.example.test/x" }));
  const before = calls.filter((c) => c.path.startsWith("/v1/text-to-speech/")).length;
  const r2 = await produce({ episodeId: "PP-20261114-01", regen: null, regenTurn: 3, outRoot: out, durationMin: 0, durationMax: 60 }, deps({ repo: repo2, store, dictionaryCache: d.saved.dict as never }));
  assert.equal(r2.exit, 0, r2.message);
  assert.equal(calls.filter((c) => c.path.startsWith("/v1/text-to-speech/")).length - before, 1);
  assert.match(r2.report!.turns, /1 synthesized, 7 reused/);
  rmSync(out, { recursive: true, force: true });
});

test("ffmpeg concat on fixtures: gaps land where the plan says", needsFfmpeg, async () => {
  const out = tmpOut();
  const turnsDir = join(out, "turns");
  mkdirSync(turnsDir, { recursive: true });
  const s = tinyScript();
  s.segments = s.segments.map((seg) => ({ ...seg, turns: seg.turns.slice(0, 1) }));
  const turns = planTurns(s); // 6 turns, all at segment starts: 5 x 900 ms gaps
  for (const t of turns) writeFileSync(join(turnsDir, t.file), toneMp3);
  const { wav } = await mixdown(turns, turnsDir, out);
  const p = await probe(wav);
  assert.ok(Math.abs(p.seconds - (6 + 4.5)) < 0.3, `wav is ${p.seconds}s`);
  rmSync(out, { recursive: true, force: true });
});

test("duration outside the gate marks the episode failed with failure_reason and uploads nothing", needsFfmpeg, async () => {
  const out = tmpOut();
  const { repo, state } = memRepo(row());
  const { store, log } = memStore();
  const r = await produce({ episodeId: "PP-20261114-01", regen: null, regenTurn: null, outRoot: out }, deps({ repo, store }));
  assert.equal(r.exit, 1);
  assert.match(state.failed ?? "", /^duration 0:1\d is below 9:00$/);
  assert.deepEqual(log, []);
  rmSync(out, { recursive: true, force: true });
});

test("Supabase write failure removes the uploaded R2 object and exits non-zero", needsFfmpeg, async () => {
  const out = tmpOut();
  const { repo } = memRepo(row(), { failUpdate: true });
  const { store, objects, log } = memStore();
  store.failNextPut(1); // first put fails, the one retry succeeds
  const r = await produce({ episodeId: "PP-20261114-01", regen: null, regenTurn: null, outRoot: out, durationMin: 0, durationMax: 60 }, deps({ repo, store }));
  assert.equal(r.exit, 1);
  assert.match(r.message, /tf_episodes update failed .*R2 object episodes\/PP-20261114-01\/audio\.mp3 removed/);
  assert.deepEqual(log, ["put episodes/PP-20261114-01/audio.mp3", "put episodes/PP-20261114-01/audio.mp3", "delete episodes/PP-20261114-01/audio.mp3"]);
  assert.equal(objects.size, 0);
  rmSync(out, { recursive: true, force: true });
});

test("a TTS error after retries marks the episode failed with the reason", needsFfmpeg, async () => {
  const out = tmpOut();
  const { repo, state } = memRepo(row());
  const { store } = memStore();
  const voices = [...VOICES.filter((v) => v.voice_id !== "v-albert"), { voice_id: "v-broken", name: "Brian - Deep, Resonant and Comforting" }];
  const el = new ElevenLabs("test-key", base, fetch, noSleep);
  el.listVoices = async () => voices;
  const r = await produce({ episodeId: "PP-20261114-01", regen: null, regenTurn: null, outRoot: out, durationMin: 0, durationMax: 60 }, deps({ repo, store, el }));
  assert.equal(r.exit, 1);
  assert.match(state.failed ?? "", /^TTS: ElevenLabs POST \/v1\/text-to-speech\/v-broken failed \(400\): bad voice$/);
  rmSync(out, { recursive: true, force: true });
});
