/**
 * Live panel orchestration (TH-32 §4.1, TF-DEC-08 turn order).
 *
 *  1. Eight domain panelists reply in parallel (claude-sonnet-5-5, 600 tokens).
 *  2. Constance Wright grades all eight (claude-sonnet-5-5, 400 tokens) and
 *     returns downgrades plus a one-line verdict per panelist.
 *  3. Gilbert Faraday rules last (claude-opus-5-5, 1,000 tokens) with all
 *     nine outputs in context.
 * Sampling levers are in ./roster (LIMITS); `temperature` is not accepted by these models.
 *
 * Deltas from the eight concurrent streams are multiplexed onto one emit().
 * Secrets are read by the SDK from process.env and are never logged.
 */
import Anthropic from "@anthropic-ai/sdk";
import { loadCastWithShared } from "../cast/loader";
import { composeSystemPrompt, type RetrievedForPrompt } from "../cast/prompt";
import type { CastMember } from "../cast/types";
import type { Artifact } from "../retrieval";
import { parseFactcheck } from "./factcheck";
import { CHIEF_OF_STAFF, FACT_CHECKER, LIMITS, MODELS, PANEL_ORDER } from "./roster";
import type { AskEvent, Factcheck, PanelSession } from "./sse";

export const hasAnthropicKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

const PANELIST_TURN = `## This turn
Answer the user's question below as yourself, in 120 to 220 words, first person. Lead with your domain's answer, state disagreement with the likely view of another panelist if you have one, and tag every factual claim. Do not address the user as a group and do not summarize the other panelists.`;

const FACTCHECK_TURN = (slugs: readonly string[]) => `## This turn
You are grading the eight replies below before the Chief of Staff rules. For every claim whose tag you downgrade, record it. A projection tagged [SRC] is always downgraded to [EST]. A [SRC: title] whose title is not in the Retrieved artifacts block is downgraded to [INF]. A [VRF] on anything but a primary retrieved artifact is downgraded to [SRC] or lower.
Return ONLY compact JSON, no prose, in this exact shape:
{"verdicts":{${slugs.map((s) => `"${s}":"<one line>"`).join(",")}},"items":[{"panelist":"<slug>","claim":"<short quote>","tag_given":"SRC","tag_should_be":"EST","note":"<why>"}]}
Keep each verdict under 25 words and each item under 40 words. Use the slugs exactly as given.`;

const RULING_TURN = `## This turn
You have the question, the eight replies and the Fact-Checker's grades. Rule in 150 to 300 words, first person, measured and dry. Prefer higher-tier claims; never rest the ruling on a claim the Fact-Checker downgraded to INF without saying so. Then write exactly these two closing lines, each on its own line:
Dissent on the record: <name any panelist you overrule and on what, or "none">.
What would change my mind: <one or two concrete pieces of evidence>.
Never name a real person.`;

function toPromptArtifacts(artifacts: Artifact[]): RetrievedForPrompt[] {
  return artifacts.map((a) => ({ title: a.title, publisher: a.publisher, published_at: a.published_at, excerpt: a.excerpt, source: a.source }));
}

function repliesBlock(members: CastMember[], replies: Record<string, string>): string {
  return members
    .filter((m) => m.slug in replies)
    .map((m) => `### ${m.persona.display_name} (${m.slug}), ${m.persona.role}\n${replies[m.slug]}`)
    .join("\n\n");
}

export interface RunOptions {
  question: string;
  artifacts: Artifact[];
  sessionId: string;
  emit: (ev: AskEvent) => void;
  signal?: AbortSignal;
}

/** Runs the full three-stage panel. Resolves with the session; emits events as it goes. */
export async function runPanel(opts: RunOptions): Promise<PanelSession> {
  const { question, artifacts, emit, signal } = opts;
  const client = new Anthropic();
  const { members, shared } = loadCastWithShared();
  const bySlug = new Map(members.map((m) => [m.slug, m]));
  const need = (slug: string) => {
    const m = bySlug.get(slug);
    if (!m) throw new Error(`panel: ${slug} missing from the cast`);
    return m;
  };
  const panelists = PANEL_ORDER.map(need);
  const constance = need(FACT_CHECKER);
  const gilbert = need(CHIEF_OF_STAFF);
  const promptArtifacts = toPromptArtifacts(artifacts);
  const replies: Record<string, string> = {};

  // Stage 1: eight panelists concurrently, deltas multiplexed.
  await Promise.all(
    panelists.map(async (m) => {
      emit({ type: "panelist_start", slug: m.slug });
      replies[m.slug] = "";
      try {
        const stream = client.messages.stream(
          {
            model: MODELS.panelist,
            max_tokens: LIMITS.panelistMaxTokens,
            thinking: { type: "between_tools" },
            output_config: { effort: LIMITS.panelistEffort },
            system: composeSystemPrompt(m, shared, { artifacts: promptArtifacts, turnInstructions: PANELIST_TURN }),
            messages: [{ role: "user", content: question }],
          },
          { signal },
        );
        stream.on("text", (text) => {
          replies[m.slug] += text;
          emit({ type: "panelist_delta", slug: m.slug, text });
        });
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          const note = `[${m.persona.short_name} declined to answer this one.] [INF]`;
          replies[m.slug] += (replies[m.slug] ? "\n" : "") + note;
          emit({ type: "panelist_delta", slug: m.slug, text: note });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const note = `[${m.persona.short_name} could not reply: ${message}] [INF]`;
        replies[m.slug] += (replies[m.slug] ? "\n" : "") + note;
        emit({ type: "panelist_delta", slug: m.slug, text: note });
      } finally {
        emit({ type: "panelist_end", slug: m.slug });
      }
    }),
  );

  // Stage 2: Fact-Checker over all eight.
  let factcheck: Factcheck;
  try {
    const res = await client.messages.create(
      {
        model: MODELS.factcheck,
        max_tokens: LIMITS.factcheckMaxTokens,
        thinking: { type: "between_tools" },
        output_config: { effort: LIMITS.factcheckEffort },
        system: composeSystemPrompt(constance, shared, { artifacts: promptArtifacts, turnInstructions: FACTCHECK_TURN(PANEL_ORDER) }),
        messages: [{ role: "user", content: `## Question\n${question}\n\n## Replies\n${repliesBlock(panelists, replies)}` }],
      },
      { signal },
    );
    const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    factcheck = parseFactcheck(text, PANEL_ORDER);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    factcheck = { items: [], verdicts: Object.fromEntries(PANEL_ORDER.map((s) => [s, `Fact-check unavailable: ${message}`])) };
  }
  emit({ type: "factcheck", items: factcheck.items, verdicts: factcheck.verdicts });

  // Stage 3: the ruling, streamed.
  let ruling = "";
  try {
    const stream = client.messages.stream(
      {
        model: MODELS.ruling,
        max_tokens: LIMITS.rulingMaxTokens,
        output_config: { effort: LIMITS.rulingEffort },
        system: composeSystemPrompt(gilbert, shared, { artifacts: promptArtifacts, turnInstructions: RULING_TURN }),
        messages: [
          {
            role: "user",
            content: `## Question\n${question}\n\n## Replies\n${repliesBlock(panelists, replies)}\n\n## Fact-Checker (Constance Wright)\n${JSON.stringify(factcheck)}`,
          },
        ],
      },
      { signal },
    );
    stream.on("text", (text) => {
      ruling += text;
      emit({ type: "ruling_delta", text });
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") emit({ type: "error", message: "The Chief of Staff declined to rule on this question." });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message: `The ruling could not be completed: ${message}` });
  }
  emit({ type: "ruling_end" });

  return { session_id: opts.sessionId, question, artifacts, replies, factcheck, ruling, error: null };
}

export const modelVersions = () => ({ ...MODELS, sdk: "@anthropic-ai/sdk" });
