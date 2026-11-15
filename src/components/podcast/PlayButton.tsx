"use client";
import { usePlayer, type Track } from "./PlayerProvider";

/** Loads an episode into the sticky player. Renders nothing playable when the episode has no audio yet. */
export function PlayButton({ track, label = "Play", size = "md" }: { track: Track | null; label?: string; size?: "md" | "lg" }) {
  const { track: current, play } = usePlayer();
  if (!track) return <span className="font-mono text-xs text-ink-muted">Audio coming soon</span>;
  const playing = current?.src === track.src;
  return (
    <button
      type="button"
      onClick={() => play(track)}
      aria-label={`${playing ? "Playing" : label}: ${track.title}`}
      className={`inline-flex shrink-0 items-center gap-2 rounded-card bg-primary font-semibold text-surface hover:bg-primary/90 ${size === "lg" ? "min-h-12 px-5 text-base" : "min-h-11 px-4 text-sm"}`}
    >
      <span aria-hidden="true">{playing ? "♪" : "▶"}</span>
      {playing ? "Playing" : label}
    </button>
  );
}
