// Panel intro videos (Linear TH-4). Pure helpers shared by the sync script and its tests.

export const INTRO_DIR = "public/panel/intro";

/** WebVTT time, e.g. 7.4 -> "00:00:07.400". */
export function vttTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(r, 3)}`;
}

/** One-cue caption file for a short intro: the whole line, from 0 to the clip's end. */
export function introVtt(text: string, durationSeconds: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("intro text is empty");
  const end = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 10;
  return `WEBVTT\n\n00:00:00.000 --> ${vttTime(end)}\n${clean}\n`;
}

export type VideoStatus = { status: string; url: string | null; duration: number | null; error: string | null };

/** Read HeyGen's video status answer (v1 video_status.get), tolerating the v2 shape too. */
export function parseVideoStatus(body: unknown): VideoStatus {
  const root = (body ?? {}) as Record<string, unknown>;
  const d = ((root.data ?? root) ?? {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const str = (x: unknown) => (typeof x === "string" && x ? x : null);
  const err = d.error as Record<string, unknown> | string | null | undefined;
  return {
    status: str(d.status) ?? "unknown",
    url: str(d.video_url),
    duration: num(d.duration),
    error: typeof err === "string" ? err : str(err?.message) ?? str(d.failure_message),
  };
}
