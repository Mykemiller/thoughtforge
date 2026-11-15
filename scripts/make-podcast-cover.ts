// Podcast cover art (Linear TH-39, PP-05): public/podcast/cover-3000.png (Apple/Spotify minimum 1400, max 3000) and
// cover-600.png (site thumbnails, RSS <image>).
//
//   npm run podcast:cover
//
// There is no monogram SVG in the repo yet: the approved Primary Monogram PNG (TH-10, TF-DEC-34) has not landed and
// src/components/Monogram.tsx is a CSS placeholder ("TF" in an accent-ringed circle). This script draws that same
// monogram as SVG, adds the lightning-bolt slash TF-DEC-34 describes, and uses the ThoughtForge tokens from
// app/globals.css (TF-DEC-33, placeholders until sampled from the master logo). No panelist likeness (decided).
// Re-run after the approved monogram or final hexes land; the outputs are committed.
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
const token = (name: string) => {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`app/globals.css has no --color-${name}`);
  return m[1];
};
const C = { primary: token("primary"), accent: token("accent"), surface: token("surface"), muted: token("muted") };

export function coverSvg(): string {
  const S = 3000;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="${C.primary}" stop-opacity="1"/>
      <stop offset="1" stop-color="#0f2125" stop-opacity="1"/>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  <circle cx="1500" cy="1250" r="760" fill="${C.primary}" stroke="${C.accent}" stroke-width="64"/>
  <text x="1500" y="1250" dy="0.35em" text-anchor="middle" font-family="Inter, DejaVu Sans, sans-serif" font-weight="700" font-size="720" letter-spacing="-20" fill="${C.surface}">TF</text>
  <polygon points="1720,620 1420,1300 1580,1300 1300,1880 1760,1140 1590,1140 1840,620" fill="${C.accent}" opacity="0.92"/>
  <text x="1500" y="2370" text-anchor="middle" font-family="Inter, DejaVu Sans, sans-serif" font-weight="700" font-size="250" letter-spacing="-4" fill="${C.surface}">ThoughtForge</text>
  <text x="1500" y="2620" text-anchor="middle" font-family="IBM Plex Mono, DejaVu Sans Mono, monospace" font-weight="500" font-size="120" letter-spacing="24" fill="${C.accent}">PANEL PODCAST</text>
</svg>`;
}

async function main() {
  const out = join(ROOT, "public", "podcast");
  mkdirSync(out, { recursive: true });
  const png = sharp(Buffer.from(coverSvg())).png({ compressionLevel: 9 });
  await png.clone().resize(3000, 3000).toFile(join(out, "cover-3000.png"));
  await png.clone().resize(600, 600).toFile(join(out, "cover-600.png"));
  for (const f of ["cover-3000.png", "cover-600.png"]) {
    const m = await sharp(join(out, f)).metadata();
    console.log(`${f}: ${m.width}x${m.height} ${m.format}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main().catch((e) => { console.error(e); process.exit(1); });
