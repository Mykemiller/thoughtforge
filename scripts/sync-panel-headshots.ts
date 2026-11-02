/**
 * sync-panel-headshots — pull the ten panel headshots from HeyGen ONCE,
 * normalize them, and commit them as static assets under public/panel/.
 *
 *   npm run panel:sync
 *
 * Why static: HeyGen image URLs are signed and expire, and the landing page
 * must never depend on a third-party API at request time (Decision §1).
 * Re-run this script when a look changes, then commit the new WebP pairs.
 *
 * Secrets: HEYGEN_API_KEY is read from process.env ONLY. It is never logged,
 * never written to disk, never committed. If it is absent the script exits
 * with a clear message and a non-zero code; the build does not depend on it
 * (assets are already committed after the first run).
 *
 * Look selection (Decision §4), per member:
 *   1. manifest.preferredLookId, if set and present in the group
 *   2. else the look whose name contains "v2" (case-insensitive)
 *   3. else the most recently created look
 * The chosen look id is written back to src/data/panel.ts as `chosenLookId`
 * so the choice is reproducible.
 *
 * Image spec (Decision §5, amended TH-33): crop the original to the largest
 * square, horizontally centred and vertically centred on the member's
 * `cropFocusY` (0..1 of the original height, default 0.5 = plain centre
 * crop), then encode 800×800 WebP q82 as public/panel/<slug>.webp and
 * 320×320 as public/panel/<slug>-thumb.webp. Originals are never written to
 * the repo. Geometry lives in scripts/lib/headshot-crop.ts.
 *
 * Manifest write-back: `src/data/panel.ts` keeps one member per line. For
 * each member we find the line containing `heygenGroupId: "<id>"` and either
 * replace an existing `chosenLookId: "..."` on that line or insert
 * `chosenLookId: "<id>", ` right after the group id. This is a plain string
 * edit (no AST), so keep the one-member-per-line layout.
 *
 * Offline / fixture mode:
 *   npm run panel:sync -- --looks path/to/looks.json
 * Skips the HeyGen API and reads a JSON dump of looks instead, shaped as
 * { "<groupId>": [ { id, name, created_at, image_url|preview_image_url } ] }.
 * Used when the API is unreachable from the build host but the look listing
 * (and its signed image URLs) is available another way. Selection, image
 * processing, and manifest write-back are identical in both modes. In this
 * mode an image_url may also be a file:// URL (used by the tests).
 *
 * Single member (TH-33):
 *   npm run panel:sync -- --only <slug>
 * Re-syncs only the listed slug(s) (comma-separated). The manifest must still
 * carry exactly ten members; the other members' assets are not touched.
 *
 * Flags: --looks <file>  --manifest <file>  --out <dir>  --only <slug[,slug]>  --dry-run
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { squareCropBox } from "./lib/headshot-crop.ts";

type Look = {
  id: string;
  name: string;
  created_at?: number | string | null;
  image_url?: string | null;
  preview_image_url?: string | null;
  group_id?: string | null;
  avatar_group_id?: string | null;
};

type ManifestMember = {
  slug: string;
  name: string;
  role: string;
  heygenGroupId: string;
  preferredLookId?: string;
  cropFocusY?: number; // 0..1, default 0.5 (centre); see src/data/panel.ts
};

const HEYGEN_BASE = "https://api.heygen.com";
const FULL = 800;
const THUMB = 320;
const QUALITY = 82;

// ---------------------------------------------------------------- args

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const ROOT = process.cwd();
const MANIFEST_PATH = path.resolve(ROOT, arg("manifest") ?? "src/data/panel.ts");
const OUT_DIR = path.resolve(ROOT, arg("out") ?? "public/panel");
const LOOKS_FIXTURE = arg("looks");
const ONLY = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const DRY_RUN = flag("dry-run");

// ---------------------------------------------------------------- manifest

/**
 * Parse the manifest without importing it (so the script has no dependency
 * on the TS/Next toolchain). Each member is one line; we pull the fields we
 * need with targeted regexes.
 */
/** A member row is an object literal line: `{ order: 1, slug: ... }`. Comments and prose never start with `{`. */
function isMemberLine(line: string): boolean {
  return line.trimStart().startsWith("{");
}

function parseManifest(src: string): ManifestMember[] {
  const members: ManifestMember[] = [];
  for (const line of src.split("\n")) {
    if (!isMemberLine(line)) continue;
    const group = /heygenGroupId:\s*"([^"]+)"/.exec(line);
    if (!group) continue;
    const pick = (key: string) => new RegExp(`\\b${key}:\\s*"([^"]*)"`).exec(line)?.[1];
    const slug = pick("slug");
    const name = pick("name");
    const role = pick("role");
    if (!slug || !name || !role) {
      throw new Error(`Manifest line carries heygenGroupId but is missing slug/name/role: ${line.trim()}`);
    }
    const focusRaw = /\bcropFocusY:\s*([0-9.]+)/.exec(line)?.[1];
    let cropFocusY: number | undefined;
    if (focusRaw !== undefined) {
      cropFocusY = Number.parseFloat(focusRaw);
      if (Number.isNaN(cropFocusY) || cropFocusY < 0 || cropFocusY > 1) {
        throw new Error(`Manifest member ${slug} has cropFocusY ${focusRaw}; it must be a number in 0..1`);
      }
    }
    members.push({ slug, name, role, heygenGroupId: group[1], preferredLookId: pick("preferredLookId"), cropFocusY });
  }
  return members;
}

function writeChosenLook(src: string, groupId: string, lookId: string): string {
  const lines = src.split("\n");
  const idx = lines.findIndex((l) => isMemberLine(l) && l.includes(`heygenGroupId: "${groupId}"`));
  if (idx < 0) throw new Error(`Could not find manifest line for group ${groupId}`);
  const line = lines[idx];
  if (line.includes(`chosenLookId: "${lookId}"`)) return src; // same look as last sync: nothing to write
  lines[idx] = /chosenLookId:\s*"[^"]*"/.test(line)
    ? line.replace(/chosenLookId:\s*"[^"]*"/, `chosenLookId: "${lookId}"`)
    : line.replace(`heygenGroupId: "${groupId}",`, `heygenGroupId: "${groupId}", chosenLookId: "${lookId}",`);
  if (lines[idx] === line) throw new Error(`Manifest write-back made no change for group ${groupId}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- HeyGen

async function heygenGet(pathname: string, apiKey: string): Promise<unknown> {
  const res = await fetch(`${HEYGEN_BASE}${pathname}`, {
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
  });
  if (!res.ok) {
    // Never echo headers or the key; status + path is enough to debug.
    throw new Error(`HeyGen ${pathname} → HTTP ${res.status}`);
  }
  return res.json();
}

function asLooks(payload: unknown): Look[] | null {
  const data = (payload as { data?: unknown })?.data as Record<string, unknown> | undefined;
  const list = (data?.avatar_list ?? data?.avatars ?? data?.looks) as unknown;
  return Array.isArray(list) ? (list as Look[]) : null;
}

async function fetchLooksLive(groupId: string, apiKey: string): Promise<Look[]> {
  // Primary: the group's own look list.
  try {
    const looks = asLooks(await heygenGet(`/v2/avatar_group/${groupId}/avatars`, apiKey));
    if (looks) return looks;
  } catch (e) {
    console.warn(`  group endpoint failed for ${groupId}: ${(e as Error).message}; trying /v2/avatars`);
  }
  // Fallback: the flat avatar list filtered by group id.
  const all = asLooks(await heygenGet(`/v2/avatars`, apiKey)) ?? [];
  return all.filter((l) => (l.group_id ?? l.avatar_group_id) === groupId);
}

async function loadLooksFixture(file: string): Promise<Record<string, Look[]>> {
  const raw = JSON.parse(await readFile(path.resolve(ROOT, file), "utf8")) as Record<string, Look[]>;
  if (!raw || typeof raw !== "object") throw new Error(`--looks ${file} is not an object keyed by group id`);
  return raw;
}

// ---------------------------------------------------------------- selection

function createdMs(l: Look): number {
  const v = l.created_at;
  if (v == null) return 0;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v; // seconds vs ms
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

export function chooseLook(looks: Look[], preferredLookId?: string): Look {
  if (looks.length === 0) throw new Error("no looks");
  if (preferredLookId) {
    const p = looks.find((l) => l.id === preferredLookId);
    if (p) return p;
    console.warn(`  preferredLookId ${preferredLookId} not in group; falling back to the default rule`);
  }
  const v2 = looks.filter((l) => /v2/i.test(l.name ?? ""));
  const pool = v2.length > 0 ? v2 : looks;
  return [...pool].sort((a, b) => createdMs(b) - createdMs(a))[0];
}

function imageUrl(l: Look): string {
  const u = l.image_url ?? l.preview_image_url;
  if (!u) throw new Error(`look ${l.id} has no image_url / preview_image_url`);
  return u;
}

// ---------------------------------------------------------------- images

async function download(url: string): Promise<Buffer> {
  if (url.startsWith("file://")) return readFile(fileURLToPath(url));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image download → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function squareWebp(input: Buffer, size: number, focusY = 0.5): Promise<Buffer> {
  // Apply EXIF orientation first so the measured dimensions match the pixels
  // we crop, then take the focal-point square and encode WebP at spec quality.
  const rotated = await sharp(input, { failOn: "error" }).rotate().toBuffer();
  const { width, height } = await sharp(rotated).metadata();
  if (!width || !height) throw new Error("could not read image dimensions");
  const box = squareCropBox(width, height, focusY);
  return sharp(rotated)
    .extract({ left: box.left, top: box.top, width: box.size, height: box.size })
    .resize(size, size)
    .webp({ quality: QUALITY })
    .toBuffer();
}

// ---------------------------------------------------------------- main

async function main() {
  const manifestSrc = await readFile(MANIFEST_PATH, "utf8");
  const members = parseManifest(manifestSrc);
  if (members.length !== 10) {
    throw new Error(`Expected exactly 10 panel members in the manifest (TF-DEC-31), found ${members.length}`);
  }
  let targets = members;
  if (ONLY && ONLY.length > 0) {
    const known = new Set(members.map((m) => m.slug));
    const unknown = ONLY.filter((s) => !known.has(s));
    if (unknown.length > 0) throw new Error(`--only names unknown slug(s): ${unknown.join(", ")}`);
    targets = members.filter((m) => ONLY.includes(m.slug));
  }
  console.log(`Syncing ${targets.length} of ${members.length} members${ONLY ? ` (--only ${ONLY.join(",")})` : ""}.`);

  let fixture: Record<string, Look[]> | null = null;
  let apiKey: string | undefined;
  if (LOOKS_FIXTURE) {
    fixture = await loadLooksFixture(LOOKS_FIXTURE);
    console.log(`Using look fixture ${LOOKS_FIXTURE} (HeyGen API not called).`);
  } else {
    apiKey = process.env.HEYGEN_API_KEY;
    if (!apiKey) {
      console.error(
        "HEYGEN_API_KEY is not set. Set it in your shell (never commit it) and re-run `npm run panel:sync`.\n" +
          "The build does not need it: committed assets in public/panel/ are used as-is.",
      );
      process.exit(2);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });

  type Row = { slug: string; lookId: string; lookName: string; full: string; thumb: string };
  const rows: Row[] = [];
  const failures: string[] = [];
  let updated = manifestSrc;

  for (const m of targets) {
    console.log(`→ ${m.slug}${m.cropFocusY !== undefined ? ` (cropFocusY ${m.cropFocusY})` : ""}`);
    try {
      const looks = fixture ? fixture[m.heygenGroupId] ?? [] : await fetchLooksLive(m.heygenGroupId, apiKey!);
      if (looks.length === 0) {
        throw new Error(`group ${m.heygenGroupId} returned zero looks`);
      }
      const look = chooseLook(looks, m.preferredLookId);
      const original = await download(imageUrl(look));
      const focusY = m.cropFocusY ?? 0.5;
      const [full, thumb] = await Promise.all([squareWebp(original, FULL, focusY), squareWebp(original, THUMB, focusY)]);
      const fullPath = path.join(OUT_DIR, `${m.slug}.webp`);
      const thumbPath = path.join(OUT_DIR, `${m.slug}-thumb.webp`);
      if (!DRY_RUN) {
        await writeFile(fullPath, full);
        await writeFile(thumbPath, thumb);
      }
      updated = writeChosenLook(updated, m.heygenGroupId, look.id);
      rows.push({
        slug: m.slug,
        lookId: look.id,
        lookName: look.name,
        full: `${FULL}×${FULL} ${(full.byteLength / 1024).toFixed(1)} KB`,
        thumb: `${THUMB}×${THUMB} ${(thumb.byteLength / 1024).toFixed(1)} KB`,
      });
    } catch (e) {
      failures.push(`${m.slug}: ${(e as Error).message}`);
    }
  }

  if (!DRY_RUN && rows.length > 0) await writeFile(MANIFEST_PATH, updated);

  console.log("");
  console.table(rows);
  if (failures.length > 0) {
    console.error(`\n${failures.length} member(s) FAILED:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`\nDone. ${rows.length} members synced → ${path.relative(ROOT, OUT_DIR)}/${DRY_RUN ? " (dry run, nothing written)" : ""}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
