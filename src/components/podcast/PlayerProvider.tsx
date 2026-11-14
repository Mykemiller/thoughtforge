"use client";
/**
 * Sticky bottom podcast player (TH-39). One native <audio> for the whole site, so the home card, the library and an
 * episode page all feed the same player and only one episode ever plays. Speed: 1x / 1.25x / 1.5x.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export interface Track { episodeId: string; title: string; src: string }
interface PlayerApi { track: Track | null; play: (t: Track) => void }

const PlayerContext = createContext<PlayerApi>({ track: null, play: () => {} });
export const usePlayer = () => useContext(PlayerContext);

export const SPEEDS = [1, 1.25, 1.5] as const;

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [track, setTrack] = useState<Track | null>(null);
  const play = useCallback((t: Track) => setTrack(t), []);
  return (
    <PlayerContext.Provider value={{ track, play }}>
      {children}
      {track ? (
        <>
          <div aria-hidden="true" className="h-28 sm:h-24" />
          <StickyPlayer track={track} onClose={() => setTrack(null)} />
        </>
      ) : null}
    </PlayerContext.Provider>
  );
}

function StickyPlayer({ track, onClose }: { track: Track; onClose: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState<number>(1);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.playbackRate = speed;
  }, [speed, track.src]);
  useEffect(() => {
    ref.current?.play().catch(() => {});
  }, [track.src]);
  return (
    <section
      aria-label="Podcast player"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 shadow-[0_-4px_16px_rgba(20,32,43,0.08)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          <span className="mr-2 font-mono text-xs font-normal tracking-[0.08em] text-ink-muted">NOW PLAYING</span>
          {track.title}
        </p>
        <div className="flex items-center gap-3">
          <audio ref={ref} src={track.src} controls preload="metadata" className="h-10 w-full min-w-0 sm:w-80">
            <a href={track.src}>Download the episode</a>
          </audio>
          <div role="group" aria-label="Playback speed" className="flex shrink-0 overflow-hidden rounded-card border border-line">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
                className={`min-h-10 px-2 font-mono text-xs ${speed === s ? "bg-primary text-surface" : "text-ink-muted hover:bg-muted"}`}
              >
                {s}x
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close player" className="min-h-10 shrink-0 rounded-card px-2 text-ink-muted hover:bg-muted">
            ✕
          </button>
        </div>
      </div>
    </section>
  );
}
