/**
 * Transcript rendering (TH-49). Pure, client-safe: used by the export button
 * in the browser and by the saver on the server.
 */
import type { InterviewMessage } from "./sse";

export const INTERVIEWER = "Myke";

export function interviewArtifactTitle(displayName: string, startedAt: string): string {
  return `Interview: ${displayName}, ${startedAt.slice(0, 10)}`;
}

/** Markdown transcript: a heading, then one block per turn, speaker in bold. */
export function transcriptMarkdown(opts: { displayName: string; role: string; slug: string; sessionId: string; startedAt: string; transcript: InterviewMessage[] }): string {
  const head = [
    `# Interview: ${opts.displayName}, ${opts.role}`,
    ``,
    `Session ${opts.sessionId}, started ${opts.startedAt}. ThoughtForge 1:1 (TH-49). Panelist slug: ${opts.slug}.`,
    ``,
  ];
  const turns = opts.transcript.map((m) => `**${m.role === "user" ? INTERVIEWER : opts.displayName}:** ${m.content.trim()}`);
  return [...head, turns.join("\n\n"), ""].join("\n");
}

/** The first interviewer message, trimmed to 80 chars, used as tf_sessions.question. */
export function firstQuestion(transcript: InterviewMessage[]): string {
  const q = transcript.find((m) => m.role === "user")?.content.trim() ?? "";
  return q.slice(0, 80);
}

/** Count of assistant turns so far (the UI shows "turn n"). */
export function replyCount(transcript: InterviewMessage[]): number {
  return transcript.filter((m) => m.role === "assistant").length;
}
