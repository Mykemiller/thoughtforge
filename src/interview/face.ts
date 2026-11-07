/**
 * Interview face clips, server side (Linear TH-51, wave 2).
 *
 * Behind TF_INTERVIEW_FACE=1. Off (the default) means the room is exactly the
 * TH-50 voice room: no clip lookup, no video element.
 *
 * The intro reuses the TH-4 intro video (src/cast/intro.ts). Transition and
 * outro come from cast/_shared/interview-clips.yaml and are copied into
 * public/panel/interview/ by `npm run interview:clips`. A clip is offered only
 * when its line is `rendered` AND its MP4 is in the repo, so the room never
 * points at a missing file or a HeyGen URL (those are signed and expire).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { getIntro } from "../cast/intro";
import type { FaceClip, FaceClips } from "./face-cues";

export const FACE_FLAG = "TF_INTERVIEW_FACE";
export const CLIP_DIR = join("public", "panel", "interview");

export function faceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[FACE_FLAG] === "1";
}

export type ClipLine = { status?: string; line?: string; video_id?: string };
export type ClipsYaml = { panelists?: Record<string, { transition?: ClipLine; outro?: ClipLine }> };

export function readClipsYaml(root: string = process.cwd()): ClipsYaml {
  const p = join(root, "cast", "_shared", "interview-clips.yaml");
  if (!existsSync(p)) return {};
  return (parse(readFileSync(p, "utf8")) as ClipsYaml) ?? {};
}

function fixedClip(root: string, slug: string, segment: "transition" | "outro", entry: ClipLine | undefined): FaceClip | undefined {
  if (entry?.status !== "rendered" || !entry.video_id || !entry.line) return undefined;
  const base = `${slug}-${segment}`;
  const dir = join(root, CLIP_DIR);
  if (!existsSync(join(dir, `${base}.mp4`))) return undefined;
  return {
    segment,
    src: `/panel/interview/${base}.mp4`,
    captions: existsSync(join(dir, `${base}.vtt`)) ? `/panel/interview/${base}.vtt` : null,
    transcript: entry.line.trim(),
  };
}

/** The face clips for one panelist, or null when the flag is off or the slug is odd. */
export function faceClipsFor(slug: string, opts: { root?: string; env?: Record<string, string | undefined>; yaml?: ClipsYaml } = {}): FaceClips | null {
  if (!faceEnabled(opts.env)) return null;
  if (!/^[a-z]+(-[a-z]+)*$/.test(slug)) return null;
  const root = opts.root ?? process.cwd();
  const entry = (opts.yaml ?? readClipsYaml(root)).panelists?.[slug];
  const clips: FaceClips = {};
  const intro = getIntro(slug, root);
  if (intro) clips.intro = { segment: "intro", ...intro };
  const t = fixedClip(root, slug, "transition", entry?.transition);
  if (t) clips.transition = t;
  const o = fixedClip(root, slug, "outro", entry?.outro);
  if (o) clips.outro = o;
  return clips;
}
