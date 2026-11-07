/**
 * team-photos: generate the eight Meet the Team boardroom group photos (TH-65).
 *
 *   npm run team:photos                 all eight shots
 *   npm run team:photos -- --only 04    one shot (merged into the existing manifest)
 *   npm run team:photos -- --dry-run    print the prompts, call nothing
 *   npm run team:photos -- --seed 7     pass a seed to the model
 *
 * Provider: Google Gemini image generation via @google/genai. All ten headshots in
 * public/panel/<slug>.webp go into EVERY request as labelled identity references, in
 * cast order. GEMINI_API_KEY is read from the environment ONLY (set by Myke with the
 * Vercel CLI, pulled with `vercel env pull .env.local`); it is never logged or written.
 * Shots showing the wrong head count are retried up to two more times, best kept.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { PANEL_SORTED } from "../src/data/panel.ts";
import { TEAM_SHOTS, buildPrompt, shotFiles, normalizeOnly, renderManifest, type ManifestEntry } from "./lib/team-shots.ts";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "public/team");
const MANIFEST = join(ROOT, "src/data/team-photos.ts");
const PREFERRED_MODEL = "gemini-2.5-flash-image";
const MAX_ATTEMPTS = 3; // per request: backoff on 429/5xx
const MAX_COUNT_RETRIES = 2; // extra regenerations for a wrong head count

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const val = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

let requests = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadExisting(): ManifestEntry[] {
  if (!existsSync(MANIFEST)) return [];
  const m = readFileSync(MANIFEST, "utf8").match(/teamPhotos: TeamPhoto\[\] = (\[[\s\S]*\]);/);
  return m ? (JSON.parse(m[1]) as ManifestEntry[]) : [];
}

async function main() {
  const only = normalizeOnly(val("--only"));
  const shots = TEAM_SHOTS.filter((s) => !only || s.id === only);
  const seedRaw = val("--seed");
  const seed = seedRaw === undefined ? undefined : Number(seedRaw);

  if (flag("--dry-run")) {
    for (const s of shots) console.log(`--- ${s.id} ${s.kind} "${s.title}" ---\n${buildPrompt(s)}\n`);
    console.log(`dry run: ${shots.length} prompts, 0 requests made`);
    return;
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("GEMINI_API_KEY not set; run `vercel env pull .env.local` from the linked checkout");
    process.exit(1);
  }

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: key });

  // Identity references, cast order, labelled with name and role.
  const refs: Array<Record<string, unknown>> = [];
  for (const m of PANEL_SORTED) {
    const data = readFileSync(join(ROOT, "public", m.image.replace(/^\//, ""))).toString("base64");
    refs.push({ text: `Reference ${m.order}: ${m.name}, ${m.role}.` });
    refs.push({ inlineData: { mimeType: "image/webp", data } });
  }

  async function pickModel(): Promise<string> {
    try {
      requests++;
      await ai.models.get({ model: PREFERRED_MODEL });
      return PREFERRED_MODEL;
    } catch {
      const names: string[] = [];
      for await (const m of await ai.models.list()) {
        const n = (m.name ?? "").replace(/^models\//, "");
        if (/gemini.*image/i.test(n)) names.push(n);
      }
      const newest = names.sort().reverse()[0];
      if (!newest) throw new Error("no image-capable Gemini model available to this key");
      console.log(`model ${PREFERRED_MODEL} not accepted; using ${newest}`);
      return newest;
    }
  }
  const model = await pickModel();

  async function generate(prompt: string): Promise<Buffer> {
    for (let attempt = 1; ; attempt++) {
      try {
        requests++;
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [...refs, { text: prompt }] }] as never,
          config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "16:9" }, ...(seed !== undefined ? { seed } : {}) } as never,
        });
        const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        if (!part?.inlineData?.data) throw Object.assign(new Error("no image in response"), { status: 502 });
        return Buffer.from(part.inlineData.data, "base64");
      } catch (e) {
        const status = Number((e as { status?: number }).status ?? 0);
        const retryable = status === 429 || status >= 500 || status === 0;
        if (!retryable || attempt >= MAX_ATTEMPTS) throw e;
        await sleep(2000 * 2 ** (attempt - 1));
      }
    }
  }

  /** Head count by asking the same model to count; null when it cannot say. */
  async function countPeople(img: Buffer): Promise<number | null> {
    try {
      requests++;
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: img.toString("base64") } }, { text: "How many distinct people are visible in this photo? Reply with a single integer only." }] }] as never,
      });
      const n = parseInt((res.text ?? "").trim(), 10);
      return Number.isFinite(n) ? n : null;
    } catch { return null; }
  }

  mkdirSync(OUT, { recursive: true });
  const byId = new Map(loadExisting().map((e) => [e.id, e]));
  const notes: string[] = [];

  for (const s of shots) {
    let best: Buffer | null = null;
    let bestOff = Infinity;
    for (let i = 0; i <= MAX_COUNT_RETRIES; i++) {
      const img = await generate(buildPrompt(s));
      const n = await countPeople(img);
      const off = n === null ? 0 : Math.abs(n - PANEL_SORTED.length);
      if (off < bestOff) { best = img; bestOff = off; }
      if (off === 0) break;
      console.log(`shot ${s.id}: counted ${n} people, regenerating (${i + 1}/${MAX_COUNT_RETRIES})`);
    }
    if (bestOff > 0) notes.push(`shot ${s.id} kept with head count off by ${bestOff} after retries`);
    const f = shotFiles(s.id);
    await sharp(best!).resize({ width: 1600 }).webp({ quality: 82 }).toFile(join(ROOT, "public", f.file));
    await sharp(best!).resize({ width: 800 }).webp({ quality: 82 }).toFile(join(ROOT, "public", f.fileSm));
    byId.set(s.id, { id: s.id, ...f, kind: s.kind, title: s.title, alt: s.alt, caption: s.caption, generatedAt: new Date().toISOString(), model });
    console.log(`shot ${s.id} written`);
  }

  const entries = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(MANIFEST, renderManifest(entries));
  console.log(`model: ${model}\nrequests made: ${requests}`);
  for (const n of notes) console.log(`NOTE: ${n}`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
