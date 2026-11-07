/**
 * Episode script schema (TH-37, PP-03). The contract PP-04 (audio) reads from tf_episodes.script.
 * Dependency note: zod only; no I/O here.
 */
import { z } from "zod";

export const SCRIPT_WORD_MIN = 1600;
export const SCRIPT_WORD_MAX = 2300;
export const SCRIPT_WORD_TARGET = 1900;
export const TURN_WORD_MAX = 90;
/** 150 spoken words per minute; PP-04 replaces this with measured audio durations. */
export const WORDS_PER_SECOND = 2.5;

export const countWords = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
export const estSeconds = (text: string): number => Math.round((countWords(text) / WORDS_PER_SECOND) * 10) / 10;

export const SEGMENT_KINDS = ["cold_open", "signal", "the_read", "sign_off"] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

const BRACKET_TAG = /\[(?:VRF|SRC|EST|INF)[^\]]*\]/i;

export const turnSchema = z.object({
  speaker: z.string().regex(/^[a-z]+(?:-[a-z]+)+$/, "speaker must be a cast slug"),
  text: z.string().min(1).refine((t) => !BRACKET_TAG.test(t), "evidence tags never go in audio text").refine((t) => countWords(t) <= TURN_WORD_MAX, `a turn is at most ${TURN_WORD_MAX} words`),
  est_seconds: z.number().positive(),
});

export const segmentSchema = z
  .object({
    kind: z.enum(SEGMENT_KINDS),
    signal_id: z.string().min(1).optional(),
    turns: z.array(turnSchema).min(1),
  })
  .refine((s) => (s.kind === "signal") === Boolean(s.signal_id), "signal_id is required on signal segments and only there");

export const scriptSchema = z
  .object({
    episode_id: z.string().regex(/^PP-\d{8}-\d{2}$/),
    show: z.string().min(1),
    title: z.string().min(1),
    segments: z.array(segmentSchema).min(6),
    pronunciation_terms: z.array(z.string()),
    word_count: z.number().int().positive(),
  })
  .superRefine((s, ctx) => {
    const kinds = s.segments.map((x) => x.kind).join(",");
    if (kinds !== "cold_open,signal,signal,signal,the_read,sign_off") ctx.addIssue({ code: "custom", message: `segment order must be cold_open, 3 x signal, the_read, sign_off (got ${kinds})` });
    const total = scriptWordCount(s);
    if (total !== s.word_count) ctx.addIssue({ code: "custom", message: `word_count ${s.word_count} does not match the turns (${total})` });
  });

export type ScriptTurn = z.infer<typeof turnSchema>;
export type ScriptSegment = z.infer<typeof segmentSchema>;
export type EpisodeScript = z.infer<typeof scriptSchema>;

export function scriptWordCount(s: { segments: { turns: { text: string }[] }[] }): number {
  return s.segments.reduce((n, seg) => n + seg.turns.reduce((m, t) => m + countWords(t.text), 0), 0);
}

export const inWordBand = (n: number) => n >= SCRIPT_WORD_MIN && n <= SCRIPT_WORD_MAX;

/** Speakable acronyms and mixed-case terms the TTS may mangle; feeds the ElevenLabs pronunciation dictionary (PP-04). */
const PRONOUNCE_SKIP = new Set(["AI", "US", "USA", "UK", "EU", "CEO", "CFO", "TV", "OK", "II", "III", "IV"]);
export function pronunciationTerms(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b(?:[A-Z]{2,}[A-Za-z0-9]*|[A-Za-z]+[0-9]+[A-Za-z0-9]*|[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*|\d+[A-Za-z]+[A-Za-z0-9]*)\b/g)) {
    if (!PRONOUNCE_SKIP.has(m[0]) && !/^\d+(?:st|nd|rd|th)$/i.test(m[0])) out.add(m[0]);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}
