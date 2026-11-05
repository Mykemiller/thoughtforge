/**
 * sync-panel-intros — copy the ten HeyGen intro videos into the repo (Linear TH-4).
 *
 *   npm run panel:intros
 *
 * Why static: HeyGen video URLs are signed and expire, and the Meet the Panel
 * pages must never depend on a third-party API at request time. Same reasoning
 * as the headshot sync (scripts/sync-panel-headshots.ts).
 *
 * For each panelist in cast/_shared/voices.yaml with a video_id, it asks HeyGen
 * for the video's current URL, downloads the MP4 to
 * public/panel/intro/<slug>.mp4, and writes a one-cue WebVTT caption file
 * public/panel/intro/<slug>.vtt from the intro line. Nothing is rendered and no
 * credits are spent: it only reads videos that already exist.
 *
 * Secrets: HEYGEN_API_KEY is read from process.env only. It is never logged or
 * written. Without it the script stops with a clear message.
 *
 * Offline mode (tests, or when the API is unreachable):
 *   npm run panel:intros -- --urls path/to/urls.json
 * where urls.json is { "<slug>": { "url": "https://... or file://...", "duration": 7.0 } }.
 *
 * Flags: --urls <file>  --only <slug[,slug]>  --out <dir>  --dry-run
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { INTRO_DIR, introVtt, parseVideoStatus } from "./lib/intro-core.ts";
import type { VoicesFile } from "./lib/voices-core.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const HEYGEN_BASE = "https://api.heygen.com";
const MAX_BYTES = 25 * 1024 * 1024;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function die(msg: string): never {
  console.error(`panel:intros FAIL: ${msg}`);
  process.exit(1);
}

type Source = { url: string; duration: number | null };

async function fromHeyGen(videoId: string, apiKey: string): Promise<Source> {
  const res = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HeyGen answered HTTP ${res.status} for video ${videoId}`);
  const st = parseVideoStatus(await res.json());
  if (st.status !== "completed" || !st.url) {
    throw new Error(`video ${videoId} is ${st.status}${st.error ? ` (${st.error})` : ""}, no URL to copy`);
  }
  return { url: st.url, duration: st.duration };
}

async function download(url: string): Promise<Buffer> {
  if (url.startsWith("file://")) return readFile(fileURLToPath(url));
  if (!url.startsWith("https://")) throw new Error("refusing a non-https video URL");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download answered HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`video is ${buf.length} bytes, over the ${MAX_BYTES} limit`);
  return buf;
}

async function main() {
  const voices = parse(await readFile(path.join(ROOT, "cast/_shared/voices.yaml"), "utf8")) as VoicesFile;
  const outDir = path.resolve(ROOT, arg("out") ?? INTRO_DIR);
  const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const urlsFile = arg("urls");
  const dry = flag("dry-run");

  const entries = Object.entries(voices.panelists ?? {}).filter(([slug]) => !only || only.includes(slug));
  if (only) for (const s of only) if (!voices.panelists?.[s]) die(`--only names unknown slug "${s}"`);
  const missing = entries.filter(([, e]) => !e.video_id).map(([s]) => s);
  if (missing.length) die(`no video_id in voices.yaml for: ${missing.join(", ")}`);

  let offline: Record<string, Source> | null = null;
  let apiKey = "";
  if (urlsFile) {
    offline = JSON.parse(await readFile(path.resolve(urlsFile), "utf8"));
  } else {
    apiKey = process.env.HEYGEN_API_KEY ?? "";
    if (!apiKey && !dry) die("HEYGEN_API_KEY is not set (or pass --urls for offline mode)");
  }

  if (!dry) await mkdir(outDir, { recursive: true });
  let done = 0;
  for (const [slug, e] of entries) {
    if (dry && !offline) {
      console.log(`- ${slug}: would copy HeyGen video ${e.video_id} to ${path.relative(ROOT, outDir)}/${slug}.mp4`);
      continue;
    }
    const src = offline ? offline[slug] : await fromHeyGen(e.video_id!, apiKey);
    if (!src?.url) die(`no URL for ${slug}`);
    const vtt = introVtt(e.intro, src.duration ?? NaN);
    if (dry) {
      console.log(`- ${slug}: ${src.url.startsWith("file://") ? "file" : "https"} source, ${src.duration ?? "?"} s`);
      continue;
    }
    const mp4 = await download(src.url);
    await writeFile(path.join(outDir, `${slug}.mp4`), mp4);
    await writeFile(path.join(outDir, `${slug}.vtt`), vtt);
    console.log(`- ${slug}: ${(mp4.length / 1024).toFixed(0)} KB, ${src.duration ?? "?"} s`);
    done++;
  }
  console.log(dry ? "Dry run: nothing written." : `panel:intros PASS: ${done} intro(s) written to ${path.relative(ROOT, outDir)}`);
}

main().catch((err) => die((err as Error).message));
