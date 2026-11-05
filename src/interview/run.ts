/**
 * 1:1 interview orchestration (TH-49, TF-DEC-84).
 *
 * One persona, no Fact-Checker pass, no ruling. Each call streams one reply to
 * the latest interviewer message with the whole transcript as prior turns.
 * Same model and levers as a panelist turn in src/ask/orchestrate.ts
 * (claude-sonnet-5-5, thinking off, effort medium), with a larger reply
 * budget because an interview answer is allowed to run longer than a
 * panel reply. Secrets are read by the SDK from process.env and never logged.
 */
import Anthropic from "@anthropic-ai/sdk";
import { loadCastWithShared } from "../cast/loader";
import { composeSystemPrompt, type RetrievedForPrompt } from "../cast/prompt";
import type { CastMember } from "../cast/types";
import type { Artifact } from "../retrieval";
import { LIMITS, MODELS } from "../ask/roster";
import { loadGuide } from "./guide";
import type { InterviewEvent, InterviewMessage } from "./sse";

export const INTERVIEW_LIMITS = {
  replyMaxTokens: 900,
  messageMaxChars: 1200,
  transcriptMaxTurns: 80,
} as const;

export const INTERVIEW_TURN = `## This turn
You are in a one-to-one interview with the founder of ThoughtForge. Nobody else from the panel is in the room. Answer the interviewer's latest message as yourself, in the first person, in 90 to 220 words, conversationally; this is a conversation, not a panel reply. Answer the question that was asked before you add anything. Draw on your own backstory and life outside work when they are relevant, and be specific rather than general. If the interviewer repeats back what they heard, say whether it is right. Tag every factual claim about the world on the evidence ladder; claims about your own life carry no tag. Never name a real person except one listed in your own network, and then only as someone you follow, cite, or shared a room with.`;

function toPromptArtifacts(artifacts: Artifact[]): RetrievedForPrompt[] {
  return artifacts.map((a) => ({ title: a.title, publisher: a.publisher, published_at: a.published_at, excerpt: a.excerpt, source: a.source }));
}

/** The interview system prompt: the panelist's fixed core, retrieval, then the guide and the turn rule. Exported for tests. */
export function composeInterviewPrompt(member: CastMember, artifacts: Artifact[]): string {
  const { shared } = loadCastWithShared();
  const guide = loadGuide();
  return composeSystemPrompt(member, shared, { artifacts: toPromptArtifacts(artifacts), turnInstructions: `${guide.forPanelist}\n\n${INTERVIEW_TURN}` });
}

export function validateTranscript(transcript: unknown): InterviewMessage[] {
  if (!Array.isArray(transcript) || !transcript.length) throw new Error("transcript must be a non-empty array of { role, content }");
  if (transcript.length > INTERVIEW_LIMITS.transcriptMaxTurns) throw new Error(`transcript is over ${INTERVIEW_LIMITS.transcriptMaxTurns} turns`);
  const out: InterviewMessage[] = transcript.map((m, i) => {
    const role = (m as InterviewMessage)?.role;
    const content = typeof (m as InterviewMessage)?.content === "string" ? (m as InterviewMessage).content.trim() : "";
    if (role !== "user" && role !== "assistant") throw new Error(`transcript[${i}].role must be user or assistant`);
    if (!content) throw new Error(`transcript[${i}].content is empty`);
    if (role === "user" && content.length > INTERVIEW_LIMITS.messageMaxChars) throw new Error(`transcript[${i}] is over ${INTERVIEW_LIMITS.messageMaxChars} characters`);
    return { role, content };
  });
  if (out[out.length - 1].role !== "user") throw new Error("the last transcript turn must be the interviewer's");
  for (let i = 1; i < out.length; i++) if (out[i].role === out[i - 1].role) throw new Error(`transcript turns must alternate (turn ${i})`);
  return out;
}

export interface TurnOptions {
  member: CastMember;
  transcript: InterviewMessage[]; // validated; last turn is the user's
  artifacts: Artifact[];
  emit: (ev: InterviewEvent) => void;
  signal?: AbortSignal;
}

/** Streams one reply. Resolves with the full reply text (a failure note is returned, never thrown). */
export async function runInterviewTurn(opts: TurnOptions): Promise<string> {
  const { member, transcript, artifacts, emit, signal } = opts;
  const client = new Anthropic();
  let reply = "";
  try {
    const stream = client.messages.stream(
      {
        model: MODELS.panelist,
        max_tokens: INTERVIEW_LIMITS.replyMaxTokens,
        thinking: { type: "between_tools" },
        output_config: { effort: LIMITS.panelistEffort },
        system: composeInterviewPrompt(member, artifacts),
        messages: transcript.map((m) => ({ role: m.role, content: m.content })),
      },
      { signal },
    );
    stream.on("text", (text) => {
      reply += text;
      emit({ type: "reply_delta", text });
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      const note = `[${member.persona.short_name} declined to answer that one.]`;
      reply += (reply ? "\n" : "") + note;
      emit({ type: "reply_delta", text: note });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const note = `[${member.persona.short_name} could not reply: ${message}]`;
    reply += (reply ? "\n" : "") + note;
    emit({ type: "reply_delta", text: note });
    emit({ type: "error", message: `The reply could not be completed: ${message}` });
  } finally {
    emit({ type: "reply_end" });
  }
  return reply;
}

export const interviewModelVersions = () => ({ interview: MODELS.panelist, sdk: "@anthropic-ai/sdk" });
