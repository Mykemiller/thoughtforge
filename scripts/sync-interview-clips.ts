/**
 * sync-interview-clips — copy rendered interview face clips into the repo (Linear TH-51, wave 2).
 *
 *   npm run interview:clips
 *
 * Reads cast/_shared/interview-clips.yaml. For every transition/outro line with
 * status `rendered` and a video_id, it asks HeyGen for the video's current URL,
 * downloads the MP4 to public/panel/interview/<slug>-<segment>.mp4 and writes a
 * one-cue WebVTT caption file next to it. It renders nothing and spends no
 * credits. The intro clip is the TH-4 intro (`npm run panel:intros`).
 *
 * Secrets: HEYGEN_API_KEY from process.env only, never logged or written.
 *
 * Offline mode: --urls urls.json, where urls.json is
 *   { "<slug>-<segment>": { "url": "https://... or file://...", "duration": 4.3 } }
 * Flags: --urls <file>  --only <slug[,slug]>  --out <dir>  --dry-run
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { introVtt, parseVideoStatus } from "./lib/intro-core.ts";
import { renderedClips, type ClipsFile } from "./lib/interview-clips-core.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const HEYGEN_BASE = "https://api.heygen.com";
const OUT_DIR = "public/panel/interview";
const MAX_BYTES = 25 * 1024 * 1024;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function die(msg: string): never {
  console.error(`interview:clips FAIL: ${msg}`);
  process.exit(1);
}

type Source = { url: string; duration: number | null };

async function fromHeyGen(videoId: string, apiKey: string): Promise<Source> {
  const res = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HeyGen answered HTTP ${res.status} for video ${videoId}`);
  const st = parseVideoStatus(await res.json());
  if (st.status !== "completed" || !st.url) throw new Error(`video ${videoId} is ${st.status}${st.error ? ` (${st.error})` : ""}, no URL to copy`);
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
  const file = parse(await readFile(path.join(ROOT, "cast/_shared/interview-clips.yaml"), "utf8")) as ClipsFile;
  const outDir = path.resolve(ROOT, arg("out") ?? OUT_DIR);
  const only = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
  if (only) for (const s of only) if (!file.panelists?.[s]) die(`--only names unknown slug "${s}"`);
  const urlsFile = arg("urls");
  const dry = flag("dry-run");

  const clips = renderedClips(file).filter((c) => !only || only.includes(c.slug));
  if (!clips.length) {
    console.log("interview:clips: no rendered clips to copy.");
    return;
  }

  let offline: Record<string, Source> | null = null;
  let apiKey = "";
  if (urlsFile) offline = JSON.parse(await readFile(path.resolve(urlsFile), "utf8"));
  else {
    apiKey = process.env.HEYGEN_API_KEY ?? "";
    if (!apiKey && !dry) die("HEYGEN_API_KEY is not set (or pass --urls for offline mode)");
  }

  if (!dry) await mkdir(outDir, { recursive: true });
  let done = 0;
  for (const c of clips) {
    if (dry && !offline) {
      console.log(`- ${c.key}: would copy HeyGen video ${c.videoId} to ${path.relative(ROOT, outDir)}/${c.key}.mp4`);
      continue;
    }
    const src = offline ? offline[c.key] : await fromHeyGen(c.videoId, apiKey);
    if (!src?.url) die(`no URL for ${c.key}`);
    const vtt = introVtt(c.line, src.duration ?? NaN);
    if (dry) {
      console.log(`- ${c.key}: ${src.url.startsWith("file://") ? "file" : "https"} source, ${src.duration ?? "?"} s`);
      continue;
    }
    const mp4 = await download(src.url);
    await writeFile(path.join(outDir, `${c.key}.mp4`), mp4);
    await writeFile(path.join(outDir, `${c.key}.vtt`), vtt);
    console.log(`- ${c.key}: ${(mp4.length / 1024).toFixed(0)} KB, ${src.duration ?? "?"} s`);
    done++;
  }
  console.log(dry ? "Dry run: nothing written." : `interview:clips PASS: ${done} clip(s) written to ${path.relative(ROOT, outDir)}`);
}

main().catch((err) => die((err as Error).message));
