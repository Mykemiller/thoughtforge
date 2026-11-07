"use client";

/**
 * Interview face (Linear TH-51, wave 2): pre-rendered HeyGen clips for the fixed
 * segments of a 1:1 (intro, transition, outro). Live replies stay voice-only.
 *
 * Rendered only when the page passes clips, i.e. TF_INTERVIEW_FACE=1. Any video
 * error hides the player and leaves the TH-50 headshot room as it was.
 */
import { useEffect, useRef, useState } from "react";
import { nextSegment, type FaceClips, type FaceSegment } from "@/src/interview/face-cues";

export interface InterviewFaceProps {
  clips: FaceClips;
  name: string;
  poster: string;
  turns: number;
  arcLength: number;
  /** A reply is streaming or still being spoken. */
  busy: boolean;
  wrapUp: boolean;
  /** Called when a clip starts, so the room can silence the live voice. */
  onClipStart: () => void;
  /** Bump to stop the current clip (barge-in: the guest started a new question). */
  interrupt: number;
}

const LABEL: Record<FaceSegment, string> = { intro: "Introduction", transition: "Between questions", outro: "Closing" };

export function InterviewFace({ clips, name, poster, turns, arcLength, busy, wrapUp, onClipStart, interrupt }: InterviewFaceProps) {
  const [played, setPlayed] = useState<ReadonlySet<FaceSegment>>(new Set());
  const [blocked, setBlocked] = useState<FaceSegment | null>(null); // autoplay refused for this segment
  const [failed, setFailed] = useState(false);
  const [seenInterrupt, setSeenInterrupt] = useState(interrupt);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Which fixed segment is up, derived from how far the interview has got. Each plays at most once.
  const current = failed ? null : nextSegment(clips, { turns, arcLength, played, busy, wrapUp });

  // Barge-in: the guest started a new question, so whatever clip was up counts as played.
  if (interrupt !== seenInterrupt) {
    setSeenInterrupt(interrupt);
    if (current) setPlayed((p) => new Set(p).add(current));
  }

  // The intro waits for a tap (no gesture yet). Later clips autoplay, falling back to a tap if the browser refuses.
  useEffect(() => {
    const v = videoRef.current;
    if (!current || current === "intro" || !v) return;
    onClipStart();
    v.play().catch(() => setBlocked(current));
  }, [current, onClipStart]);

  if (!current) return null;
  const clip = clips[current];
  if (!clip) return null;
  const needsTap = current === "intro" || blocked === current;

  const finish = () => {
    setPlayed((p) => new Set(p).add(current));
    setBlocked(null);
  };

  return (
    <section aria-label={`${name}: ${LABEL[current]}`} className="overflow-hidden rounded-card border border-line bg-muted">
      <div className="relative">
        <video
          key={clip.src}
          ref={videoRef}
          src={clip.src}
          className="aspect-video w-full bg-black object-contain"
          poster={poster}
          playsInline
          preload="metadata"
          controls={!needsTap}
          onPlay={() => setBlocked((b) => (b === current ? null : b))}
          onEnded={finish}
          onError={() => setFailed(true)} // on the element (not a <source>) so a bad file reaches it: fall back to the headshot room
          aria-describedby="face-transcript"
        >
          {clip.captions ? <track kind="captions" src={clip.captions} srcLang="en" label="English" default /> : null}
        </video>
        {needsTap ? (
          <button
            type="button"
            onClick={() => {
              onClipStart();
              setBlocked(null);
              videoRef.current?.play().catch(() => setFailed(true));
            }}
            className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-semibold text-surface"
          >
            <span className="rounded-card bg-primary px-4 py-2">Play {LABEL[current].toLowerCase()}</span>
          </button>
        ) : null}
      </div>
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <p id="face-transcript" className="text-sm leading-relaxed text-ink-muted">
          &ldquo;{clip.transcript}&rdquo; <span className="text-xs">AI-generated video of a fictional panelist.</span>
        </p>
        <button type="button" onClick={finish} className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-primary hover:underline">
          Skip
        </button>
      </div>
    </section>
  );
}
