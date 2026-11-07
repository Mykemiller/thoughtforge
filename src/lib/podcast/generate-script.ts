/**
 * Episode script generator (TH-37, PP-03).
 *
 * Podcast mode of the panel orchestration: the same cast loader and prompt composer as /api/ask (mode: "podcast"),
 * but each on-mic panelist speaks dialogue turns one at a time instead of replying in parallel and being ruled on.
 * Structure: cold open (chair) -> 3 signal segments (7 turns each) -> The Read (chair, two turns) -> sign-off.
 * Constance Wright never speaks; her grades go to show notes (see grade-signals.ts).
 *
 * Out-of-band scripts (total outside 1,600 to 2,300 words), schema failures and audit failures are regenerated
 * from scratch up to twice; after that the result is status "failed" and nothing is stored as scripted.
 */
import type { CastMember, SharedSkills } from "../../cast/types";
import { composeSystemPrompt, type RetrievedForPrompt } from "../../cast/prompt";
import { PODCAST_MODELS, type Llm, type LlmRequest } from "./llm";
import {
  countWords, estSeconds, inWordBand, pronunciationTerms, scriptSchema, scriptWordCount, TURN_WORD_MAX,
  SCRIPT_WORD_MIN, SCRIPT_WORD_MAX, type EpisodeScript, type ScriptSegment, type ScriptTurn,
} from "./script-schema";
import { DOMAIN_VOICES, type CastSlot } from "./select-cast";
import type { SelectedSignal } from "./select-signals";

export const MAX_REGENERATIONS = 2;

export type AuditResult = { ok: boolean; failures: string[] };
export interface GenerateInput {
  episode_id: string;
  show: string;
  title: string;
  digest_date: string;
  signals: SelectedSignal[];
  cast: CastSlot[];
  members: CastMember[];
  shared: SharedSkills;
  llm: Llm;
  audit?: (script: EpisodeScript) => AuditResult;
  maxRegenerations?: number;
  log?: (msg: string) => void;
}
export interface Attempt {
  n: number;
  word_count: number | null;
  outcome: "ok" | "out_of_band" | "schema" | "audit" | "error";
  detail: string;
}
export interface GenerateResult {
  status: "scripted" | "failed";
  script: EpisodeScript | null;
  attempts: Attempt[];
  reason: string | null;
  /** Last generated word count even on failure, for the failure row. */
  word_count: number | null;
}

interface Step {
  segment: number;
  kind: ScriptSegment["kind"];
  signal?: SelectedSignal;
  speaker: string;
  tag: string;
  target: number;
  chairSetPiece: boolean;
  instruction: string;
}

const first = (m: CastMember) => m.persona.short_name;

/** The voice whose mapped domain matches the signal speaks first; otherwise the seats rotate by signal number. */
export function leadVoice(signal: SelectedSignal, voices: string[], index: number): [string, string] {
  const mapped = signal.idf_domain_code ? DOMAIN_VOICES[signal.idf_domain_code] ?? [] : [];
  const lead = voices.find((v) => mapped.includes(v)) ?? voices[index % 2];
  return [lead, voices.find((v) => v !== lead) as string];
}

export function planSteps(input: Pick<GenerateInput, "show" | "digest_date" | "signals" | "cast" | "members">): Step[] {
  const name = (slug: string) => first(input.members.find((m) => m.slug === slug) as CastMember);
  const chair = input.cast.find((c) => c.role === "chair")!.slug;
  const voices = input.cast.filter((c) => c.role === "voice").map((c) => c.slug);
  const steps: Step[] = [];
  const push = (s: Omit<Step, "segment">, segment: number) => steps.push({ ...s, segment });

  push({
    kind: "cold_open", speaker: chair, tag: "cold_open", target: 80, chairSetPiece: true,
    instruction: `Open this episode of ${input.show} for ${input.digest_date}. Welcome the listener, name the three stories ahead in one short line each (use only the signals above), and introduce ${name(voices[0])} and ${name(voices[1])} by first name with what each brings. Dry, unhurried, no hype.`,
  }, 0);
  input.signals.forEach((sig, i) => {
    const [a, b] = leadVoice(sig, voices, i);
    const seg = i + 1;
    const tag = (n: string) => `signal${seg}:${n}`;
    const mk = (n: string, speaker: string, target: number, instruction: string) =>
      push({ kind: "signal", signal: sig, speaker, tag: tag(n), target, chairSetPiece: false, instruction }, seg);
    mk("ask", chair, 55, `Introduce signal ${seg} of 3 in plain words: what happened and why a data-center decision-maker would care. Then ask ${name(a)} for a first read.`);
    mk("a1", a, 85, `Answer the chair from your domain. Take a clear position on one specific point: a number, a timeline, a mechanism or a risk.`);
    mk("b1", b, 85, `Respond to ${name(a)}. You must disagree with ${name(a)} on one specific point, and say exactly what that point is.`);
    mk("probe", chair, 50, `Pin the disagreement down with one pointed follow-up question to both of them.`);
    mk("a2", a, 85, `Answer the chair. Defend or concede in part, using the strongest fact the signal gives you.`);
    mk("b2", b, 85, `Answer the chair. Hold or move your position on the point you disagreed about, with your best fact.`);
    mk("rule", chair, 80, `Arbitrate: say who has the stronger case on this signal and why. End with exactly one sentence that restates the disagreement between ${name(a)} and ${name(b)}.`);
  });
  const rs = input.signals.length + 1;
  push({ kind: "the_read", speaker: chair, tag: "read1", target: 75, chairSetPiece: true, instruction: `The Read, part one: pull the three disagreements together and say what they have in common.` }, rs);
  push({ kind: "the_read", speaker: chair, tag: "read2", target: 75, chairSetPiece: true, instruction: `The Read, part two: make your call. Which signal matters most this week for someone siting or powering a data center, and what would change your mind?` }, rs);
  push({ kind: "sign_off", speaker: chair, tag: "sign_off", target: 30, chairSetPiece: false, instruction: `Sign off in about thirty words: thank ${name(voices[0])} and ${name(voices[1])}, say the next episode comes tomorrow.` }, rs + 1);
  return steps;
}

const asArtifacts = (sigs: SelectedSignal[]): RetrievedForPrompt[] =>
  sigs.map((s) => ({ title: s.title, publisher: s.publisher, published_at: null, excerpt: s.summary ?? s.title, source: "secondary" as const }));

/** Strip what a model adds around a spoken turn: speaker label, markdown, bracket tags, stage directions. */
export function cleanTurn(raw: string, displayName: string): string {
  let t = raw.trim();
  t = t.replace(new RegExp(`^\\*{0,2}${displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\*{0,2}\\s*[:\\-—]\\s*`, "i"), "");
  t = t.replace(/\[(?:VRF|SRC|EST|INF)[^\]]*\]/gi, "").replace(/\([^)]*\b(?:laughs|pauses|beat|sighs)\b[^)]*\)/gi, "");
  t = t.replace(/[*_#`>]+/g, "").replace(/^["“]|["”]$/g, "").replace(/\s+/g, " ").trim();
  return t;
}

/** Trim to at most `max` words, at a sentence end when one exists in the last third, else hard at the word limit. */
export function trimToWords(text: string, max = TURN_WORD_MAX): string {
  const words = text.split(/\s+/);
  if (words.length <= max) return text;
  const cut = words.slice(0, max).join(" ");
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (end > cut.length * 0.6) return cut.slice(0, end + 1);
  return cut.replace(/[,;:\s]+$/, "") + ".";
}

async function runTurn(input: GenerateInput, step: Step, transcript: string): Promise<string> {
  const member = input.members.find((m) => m.slug === step.speaker) as CastMember;
  const display = member.persona.display_name;
  const sigs = step.signal ? [step.signal] : input.signals;
  const system = composeSystemPrompt(member, input.shared, {
    mode: "podcast",
    artifacts: asArtifacts(sigs),
    turnInstructions: `## This turn\nYou are ${display} on the ${input.show} podcast, recorded ${input.digest_date}. Speak only your own next turn. Each turn is under ${TURN_WORD_MAX} words so the audio breathes.`,
  });
  const ask = (extra: string) =>
    `${transcript ? `## Episode so far\n${transcript}\n\n` : ""}## Your turn\n${step.instruction}\nWrite only the words ${display} says, about ${step.target} words and never more than ${TURN_WORD_MAX}. No speaker label, no bracket tags, no stage directions.${extra}`;
  const req = (user: string): LlmRequest => ({
    model: step.chairSetPiece ? PODCAST_MODELS.chairSetPiece : PODCAST_MODELS.turn,
    effort: step.chairSetPiece ? "low" : "medium",
    maxTokens: step.chairSetPiece ? 1200 : 400,
    system,
    user,
    meta: { tag: step.tag, speaker: step.speaker, target: step.target },
  });
  let text = cleanTurn(await input.llm(req(ask(""))), display);
  if (countWords(text) > TURN_WORD_MAX) {
    const retry = cleanTurn(await input.llm(req(ask(`\nYour last attempt ran ${countWords(text)} words. Cut it to about ${Math.max(20, step.target - 10)} words.`))), display);
    if (retry && countWords(retry) < countWords(text)) text = retry;
  }
  if (!text) throw new Error(`empty turn at ${step.tag}`);
  return trimToWords(text);
}

async function generateOnce(input: GenerateInput): Promise<EpisodeScript> {
  const steps = planSteps(input);
  const lines: string[] = [];
  const segments: ScriptSegment[] = [];
  for (const step of steps) {
    const member = input.members.find((m) => m.slug === step.speaker) as CastMember;
    const text = await runTurn(input, step, lines.join("\n"));
    lines.push(`${member.persona.display_name}: ${text}`);
    const last = segments[segments.length - 1];
    const turn: ScriptTurn = { speaker: step.speaker, text, est_seconds: estSeconds(text) };
    const sameSegment = last && last.kind === step.kind && (step.kind !== "signal" || last.signal_id === step.signal?.signal_id);
    if (sameSegment) last.turns.push(turn);
    else segments.push({ kind: step.kind, ...(step.signal ? { signal_id: step.signal.signal_id } : {}), turns: [turn] });
  }
  const draft = { segments };
  const all = segments.flatMap((s) => s.turns.map((t) => t.text)).join(" ");
  return scriptSchema.parse({
    episode_id: input.episode_id,
    show: input.show,
    title: input.title,
    segments,
    pronunciation_terms: pronunciationTerms(all),
    word_count: scriptWordCount(draft),
  });
}

export async function generateScript(input: GenerateInput): Promise<GenerateResult> {
  const max = input.maxRegenerations ?? MAX_REGENERATIONS;
  const log = input.log ?? (() => {});
  const attempts: Attempt[] = [];
  let lastWords: number | null = null;
  for (let n = 1; n <= max + 1; n++) {
    try {
      const script = await generateOnce(input);
      lastWords = script.word_count;
      if (!inWordBand(script.word_count)) {
        attempts.push({ n, word_count: script.word_count, outcome: "out_of_band", detail: `${script.word_count} words, band is ${SCRIPT_WORD_MIN} to ${SCRIPT_WORD_MAX}` });
        log(`attempt ${n}: ${script.word_count} words, outside the band`);
        continue;
      }
      const audit = input.audit?.(script) ?? { ok: true, failures: [] };
      if (!audit.ok) {
        attempts.push({ n, word_count: script.word_count, outcome: "audit", detail: audit.failures.join(" | ") });
        log(`attempt ${n}: real-name audit failed (${audit.failures.length})`);
        continue;
      }
      attempts.push({ n, word_count: script.word_count, outcome: "ok", detail: "" });
      return { status: "scripted", script, attempts, reason: null, word_count: script.word_count };
    } catch (err) {
      const isSchema = err instanceof Error && err.name === "ZodError";
      const detail = err instanceof Error ? err.message.slice(0, 400) : String(err);
      attempts.push({ n, word_count: null, outcome: isSchema ? "schema" : "error", detail });
      log(`attempt ${n}: ${isSchema ? "schema" : "error"}: ${detail.slice(0, 120)}`);
    }
  }
  const lastAttempt = attempts[attempts.length - 1];
  return {
    status: "failed", script: null, attempts, word_count: lastWords,
    reason: `no valid script after ${attempts.length} attempts; last: ${lastAttempt.outcome}${lastAttempt.detail ? ` (${lastAttempt.detail.slice(0, 160)})` : ""}`,
  };
}
