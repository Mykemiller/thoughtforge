/**
 * Model access for the podcast generator (TH-37). The generator takes an `Llm` function so tests and TF_MOCK=1
 * never touch the network. Models and levers follow src/ask/roster.ts: Claude 5 rejects `temperature` (TF-DEC-57),
 * so none is sent; panelist turns leave `thinking` unset (off), the chair's two set pieces run on Opus at effort low.
 */
import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "../../ask/roster";

export type Effort = "low" | "medium" | "high";
export const PODCAST_MODELS = { turn: MODELS.panelist, chairSetPiece: MODELS.ruling, factcheck: MODELS.factcheck } as const;

export interface LlmRequest {
  model: string;
  effort: Effort;
  maxTokens: number;
  system: string;
  user: string;
  /** Hints for the mock and for logs. The real client ignores them. */
  meta: { tag: string; speaker: string; target: number };
}
export type Llm = (req: LlmRequest) => Promise<string>;

export const hasAnthropicKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** The key is read by the SDK from process.env and is never logged. */
export function anthropicLlm(): Llm {
  const client = new Anthropic();
  return async (req) => {
    const res = await client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      output_config: { effort: req.effort },
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    });
    if (res.stop_reason === "refusal") throw new Error(`model declined (${req.meta.tag})`);
    return res.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim();
  };
}
