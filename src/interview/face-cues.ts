/**
 * Interview face cues (Linear TH-51, wave 2). Client-safe: no fs, no env.
 *
 * Myke's 2026-11-07 decision: pre-rendered HeyGen clips for the fixed segments
 * only. Live replies stay voice-only. This module decides WHICH fixed clip the
 * room should play next, given how far the interview has got.
 */
export type FaceSegment = "intro" | "transition" | "outro";

export type FaceClip = { segment: FaceSegment; src: string; captions: string | null; transcript: string };

/** The clips one panelist has in the repo. Missing segments are simply absent. */
export type FaceClips = Partial<Record<FaceSegment, FaceClip>>;

export type CueState = {
  /** Assistant replies so far. */
  turns: number;
  /** Questions in the fixed arc. */
  arcLength: number;
  /** Segments already played (or skipped) this session; each plays at most once. */
  played: ReadonlySet<FaceSegment>;
  /** True while a reply is streaming or its audio is still speaking. */
  busy: boolean;
  /** The guest asked to wrap up. */
  wrapUp?: boolean;
};

/** Reply count at which the transition plays: half-way through the arc, never before the first reply. */
export function transitionTurn(arcLength: number): number {
  return Math.max(1, Math.ceil(arcLength / 2));
}

/**
 * The next fixed segment to play, or null. Never interrupts a live reply.
 * - intro: before the first question.
 * - transition: once, after the reply at the arc midpoint (if the arc is long enough to have a middle).
 * - outro: once, when the arc is finished or the guest wraps up.
 */
export function nextSegment(clips: FaceClips, s: CueState): FaceSegment | null {
  if (s.busy) return null;
  const ready = (seg: FaceSegment) => Boolean(clips[seg]) && !s.played.has(seg);
  if (s.turns === 0 && !s.wrapUp) return ready("intro") ? "intro" : null;
  const finished = s.wrapUp || (s.arcLength > 0 && s.turns >= s.arcLength);
  if (finished) return ready("outro") ? "outro" : null;
  if (s.arcLength >= 3 && s.turns >= transitionTurn(s.arcLength) && ready("transition")) return "transition";
  return null;
}
