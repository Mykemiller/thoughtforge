// Offline tests for the headshot crop geometry and the single-member sync path (Linear TH-33).
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { squareCropBox } from "../lib/headshot-crop.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const run = promisify(execFile);

test("squareCropBox at 0.5 is the plain centre crop (pre-TH-33 behaviour)", () => {
  assert.deepEqual(squareCropBox(1024, 1536, 0.5), { left: 0, top: 256, size: 1024 });
  assert.deepEqual(squareCropBox(800, 800), { left: 0, top: 0, size: 800 });
});

test("squareCropBox moves the box up for a high focal point and clamps at the top edge", () => {
  assert.deepEqual(squareCropBox(1024, 1536, 0.33), { left: 0, top: 0, size: 1024 });
  assert.deepEqual(squareCropBox(1024, 1536, 0.4), { left: 0, top: 102, size: 1024 });
});

test("squareCropBox clamps landscape inputs horizontally and never exceeds the image", () => {
  assert.deepEqual(squareCropBox(1536, 1024, 0.9), { left: 256, top: 0, size: 1024 });
  assert.deepEqual(squareCropBox(1024, 1536, 1), { left: 0, top: 512, size: 1024 });
});

test("squareCropBox rejects bad inputs", () => {
  assert.throws(() => squareCropBox(1024, 1536, 1.2), /0\.\.1/);
  assert.throws(() => squareCropBox(1024, 1536, -0.1), /0\.\.1/);
  assert.throws(() => squareCropBox(0, 10), /positive integers/);
  assert.throws(() => squareCropBox(10.5, 10), /positive integers/);
});

test("sync --only regenerates one member from a file:// fixture with the focal crop applied", async () => {
  const dir = await mkdtemp(join(tmpdir(), "th33-"));
  const out = join(dir, "out");

  // Synthetic 1024x1536 portrait: light field, dark "head" disc centred at 20% of the height.
  const W = 1024, H = 1536, R = 150, CY = Math.round(0.2 * H);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#e8e8e8"/>
    <circle cx="${W / 2}" cy="${CY}" r="${R}" fill="#202020"/>
  </svg>`;
  const portrait = join(dir, "portrait.png");
  await sharp(Buffer.from(svg)).png().toFile(portrait);

  // Manifest copy with Margo at the focal point under test and the original value preserved for the others.
  const manifestSrc = await readFile(join(ROOT, "src/data/panel.ts"), "utf8");
  const manifest = join(dir, "panel.ts");
  await writeFile(manifest, manifestSrc.replace(/cropFocusY:\s*[0-9.]+,/, "cropFocusY: 0.2,"));
  const marker = "cropFocusY: 0.2,";
  assert.ok((await readFile(manifest, "utf8")).includes(marker), "fixture manifest carries the focal point");

  const looks = join(dir, "looks.json");
  await writeFile(
    looks,
    JSON.stringify({ bf3127845753467f8a6b8a68d450176c: [{ id: "fixture-look", name: "v2", image_url: pathToFileURL(portrait).href }] }),
  );

  const { stdout } = await run(
    "npx",
    ["tsx", "scripts/sync-panel-headshots.ts", "--looks", looks, "--manifest", manifest, "--out", out, "--only", "margo-brandt"],
    { cwd: ROOT, env: { ...process.env, HEYGEN_API_KEY: "" } },
  );
  assert.match(stdout, /Syncing 1 of 10 members/);

  const files = (await readdir(out)).sort();
  assert.deepEqual(files, ["margo-brandt-thumb.webp", "margo-brandt.webp"]);

  // The only manifest change is chosenLookId on Margo's line; nothing else moved.
  const after = await readFile(manifest, "utf8");
  assert.match(after, /slug: "margo-brandt".*chosenLookId: "fixture-look"/);
  assert.equal(after.split("\n").length, manifestSrc.split("\n").length);

  // Head centroid lands where the focal point says (0.2 of the original -> crop top is 0, so the
  // disc sits at 20% * 1536 / 1024 = 30% of the square), and the top row is still background.
  const full = sharp(join(out, "margo-brandt.webp"));
  const meta = await full.metadata();
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 800);
  const raw = await full.greyscale().raw().toBuffer();
  let sumY = 0, n = 0, topRowDark = 0;
  for (let y = 0; y < 800; y++) {
    for (let x = 0; x < 800; x++) {
      const v = raw[y * 800 + x];
      if (v < 100) {
        sumY += y; n++;
        if (y === 0) topRowDark++;
      }
    }
  }
  assert.ok(n > 0, "the head disc is present in the output");
  const centroid = sumY / n / 800;
  assert.ok(centroid > 0.26 && centroid < 0.34, `head centroid ${centroid.toFixed(3)} should sit near 0.30`);
  assert.equal(topRowDark, 0, "head is not clipped at the top edge");

  const thumbMeta = await sharp(join(out, "margo-brandt-thumb.webp")).metadata();
  assert.equal(thumbMeta.width, 320);

  // Sanity: with the default focal point the same original WOULD clip the head (why TH-33 exists).
  const centreBox = squareCropBox(W, H, 0.5);
  assert.ok(centreBox.top > CY - R, "centre crop starts below the top of the head disc");
});
