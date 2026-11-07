// Interview face clips (Linear TH-51, wave 2). Pure helpers for the sync script and its tests.

export const CLIP_SEGMENTS = ["transition", "outro"] as const;
export type ClipSegment = (typeof CLIP_SEGMENTS)[number];
export type ClipLine = { status?: string; line?: string; video_id?: string };
export type ClipsFile = { panelists?: Record<string, Partial<Record<ClipSegment, ClipLine>>> };
export type RenderedClip = { slug: string; segment: ClipSegment; key: string; videoId: string; line: string };

/** Lines that are rendered and carry a HeyGen video id, in file order. */
export function renderedClips(file: ClipsFile): RenderedClip[] {
  const out: RenderedClip[] = [];
  for (const [slug, e] of Object.entries(file.panelists ?? {})) {
    for (const segment of CLIP_SEGMENTS) {
      const l = e?.[segment];
      if (l?.status === "rendered" && l.video_id && l.line) out.push({ slug, segment, key: `${slug}-${segment}`, videoId: l.video_id, line: l.line.trim() });
    }
  }
  return out;
}
