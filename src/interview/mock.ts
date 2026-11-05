/**
 * TF_MOCK=1 path for /api/interview (TH-49): a canned reply built from the
 * panelist's own voice brief and sample line, streamed in word chunks so the
 * room is demonstrable without a key. No model call, no Supabase write.
 */
import { chunkText } from "../ask/sse";
import type { CastMember } from "../cast/types";
import type { InterviewEvent } from "./sse";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mockReply(member: CastMember, latest: string): string {
  const p = member.persona;
  const sample = p.sample_line ? ` ${p.sample_line}` : "";
  return `[Demo mode: no model is running.] You asked: "${latest.slice(0, 120)}". If I were answering for real I would answer as ${p.display_name}, ${p.role}, in this register: ${p.voice_brief}${sample}`;
}

export async function runMockTurn(member: CastMember, latest: string, emit: (ev: InterviewEvent) => void, delayMs = 12): Promise<string> {
  const text = mockReply(member, latest);
  emit({ type: "retrieval", artifacts: [] });
  for (const c of chunkText(text)) {
    emit({ type: "reply_delta", text: c });
    await sleep(delayMs);
  }
  emit({ type: "reply_end" });
  return text;
}
