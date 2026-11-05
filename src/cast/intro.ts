/**
 * Panel intro videos for the Meet the Panel pages (Linear TH-4).
 *
 * The videos are HeyGen renders copied into public/panel/intro/ by
 * `npm run panel:intros`. A page shows an intro only once its MP4 is in the
 * repo, so a bio page never points at a missing file or a HeyGen URL.
 * The transcript is the intro line from cast/_shared/voices.yaml.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export type Intro = { src: string; captions: string | null; transcript: string };

type VoicesYaml = { panelists?: Record<string, { intro?: string; video_id?: string }> };

let cache: VoicesYaml | null = null;
function voices(): VoicesYaml {
  if (!cache) cache = parse(readFileSync(join(process.cwd(), "cast", "_shared", "voices.yaml"), "utf8")) as VoicesYaml;
  return cache;
}

export function getIntro(slug: string, root: string = process.cwd()): Intro | null {
  if (!/^[a-z]+(-[a-z]+)*$/.test(slug)) return null;
  const entry = voices().panelists?.[slug];
  if (!entry?.intro || !entry.video_id) return null;
  const dir = join(root, "public", "panel", "intro");
  if (!existsSync(join(dir, `${slug}.mp4`))) return null;
  return {
    src: `/panel/intro/${slug}.mp4`,
    captions: existsSync(join(dir, `${slug}.vtt`)) ? `/panel/intro/${slug}.vtt` : null,
    transcript: entry.intro.trim(),
  };
}
