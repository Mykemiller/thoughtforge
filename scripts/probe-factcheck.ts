/**
 * TH-45 Phase 1 probe: rebuilds the stage-2 Fact-Checker request exactly as
 * src/ask/orchestrate.ts does (factcheckRequest) from the mock-session fixture
 * and runs four variants, three runs each, against the real API:
 *   A  400 tokens, thinking between_tools   (the pre-TH-45 production setting)
 *   B 1500 tokens, thinking between_tools
 *   C 1500 tokens, thinking field omitted   (the TH-45 default, now production)
 *   D 1500 tokens, thinking disabled
 * Prints only shape metrics, never the key or the prompt.
 *
 *   npm run probe:factcheck     # needs ANTHROPIC_API_KEY (e.g. .env.local from `vercel env pull`)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { loadCastWithShared } from "../src/cast/loader.ts";
import { factcheckRequest, repliesBlock, toPromptArtifacts } from "../src/ask/orchestrate.ts";
import { parseFactcheck } from "../src/ask/factcheck.ts";
import { FACT_CHECKER, PANEL_ORDER } from "../src/ask/roster.ts";
import type { PanelSession } from "../src/ask/sse.ts";

// Load ANTHROPIC_API_KEY from .env.local without printing anything from it.
const envFile = join(process.cwd(), ".env.local");
if (!process.env.ANTHROPIC_API_KEY && existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^ANTHROPIC_API_KEY=(.*)$/.exec(line.trim());
    if (m) process.env.ANTHROPIC_API_KEY = m[1].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("probe:factcheck: ANTHROPIC_API_KEY is not set (run `vercel env pull .env.local`). Skipping.");
  process.exit(2);
}

const fixture = JSON.parse(readFileSync(join(process.cwd(), "src/cast/__fixtures__/mock-session.json"), "utf8")) as PanelSession;
const { members, shared } = loadCastWithShared();
const bySlug = new Map(members.map((m) => [m.slug, m]));
const panelists = PANEL_ORDER.map((s) => bySlug.get(s)!);
const base = factcheckRequest(bySlug.get(FACT_CHECKER)!, shared, toPromptArtifacts(fixture.artifacts), fixture.question, repliesBlock(panelists, fixture.replies));

const VARIANTS: Record<string, MessageCreateParamsNonStreaming> = {
  A: { ...base, max_tokens: 400, thinking: { type: "between_tools" } },
  B: { ...base, max_tokens: 1500, thinking: { type: "between_tools" } },
  C: { ...base, max_tokens: 1500 },
  D: { ...base, max_tokens: 1500, thinking: { type: "disabled" } },
};
const RUNS = 3;

const client = new Anthropic();
const rows: string[] = ["| variant | run | stop_reason | output_tokens | blocks | text_len | all_8_verdicts | items | degraded |", "|---|---|---|---|---|---|---|---|---|"];
for (const [name, req] of Object.entries(VARIANTS)) {
  for (let run = 1; run <= RUNS; run++) {
    try {
      const res = await client.messages.create(req);
      const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
      const fc = parseFactcheck(text, PANEL_ORDER);
      const all8 = PANEL_ORDER.every((s) => !/unavailable|No verdict/.test(fc.verdicts[s]));
      rows.push(`| ${name} | ${run} | ${res.stop_reason} | ${res.usage.output_tokens} | ${res.content.map((c) => c.type).join("+")} | ${text.length} | ${all8} | ${fc.items.length} | ${fc.degraded ? fc.reason : "no"} |`);
    } catch (err) {
      const status = (err as { status?: number }).status ?? "?";
      rows.push(`| ${name} | ${run} | error ${status} | - | - | - | false | 0 | api_error |`);
    }
  }
}
console.log(rows.join("\n"));
