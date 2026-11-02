/**
 * Panelist system-prompt composition (TH-27, TH-32 §2).
 *
 * Fixed order: identity, voice brief and sample, Backstory and Life outside
 * work (from the dossier), the panelist's three skills, the three shared
 * skills, then the evidence-ladder contract. The retrieval block and turn
 * context come last so the contract never scrolls out of the fixed part.
 *
 * Budget: under 6,000 tokens at 3.5 chars/token for every panelist (asserted
 * by src/cast/prompt.test.ts; the TH-30 audit measured ~3.4–3.6k).
 */
import { dossierSection } from "./loader";
import type { CastMember, SharedSkills } from "./types";

export const PROMPT_TOKEN_LIMIT = 6000;
export const CHARS_PER_TOKEN = 3.5;
export const estimateTokens = (s: string) => Math.ceil(s.length / CHARS_PER_TOKEN);

/** Included verbatim in every panelist prompt (TH-32 §2). */
export const EVIDENCE_LADDER_CONTRACT = `## Evidence-ladder contract

Every factual claim ends with a tag [VRF], [SRC], [EST] or [INF]:
- [VRF] verified against a retrieved primary source.
- [SRC] sourced to a named document or publication.
- [EST] estimate from sourced inputs with the method stated.
- [INF] inference with no direct source.
A projection is never [SRC]. If you cite a retrieved artifact, write [SRC: <artifact title>] using the title exactly as it appears in the retrieved artifacts block below; [VRF] is reserved for a retrieved artifact marked primary. Never write [SRC: ...] for a title that is not in that block.
Replies are 120 to 220 words, first person, in your own register. Never name a real person except one listed in your own network file, and then only as someone you follow, cite, or shared a room with.`;

export interface RetrievedForPrompt {
  title: string;
  publisher: string | null;
  published_at: string | null;
  excerpt: string;
  source: "primary" | "secondary" | "panel";
}

export interface PromptContext {
  /** Retrieved artifacts, already capped at 8; empty array means none. */
  artifacts: RetrievedForPrompt[];
  /** Extra turn-specific text appended last (e.g. Fact-Checker or ruling instructions). */
  turnInstructions?: string;
}

export function retrievedBlock(artifacts: RetrievedForPrompt[]): string {
  if (!artifacts.length) return "## Retrieved artifacts\n\nNo artifacts were retrieved for this question; tag accordingly.";
  const lines = artifacts.map((a, i) => {
    const meta = [a.publisher, a.published_at, a.source === "primary" ? "primary" : a.source === "panel" ? "prior panel ruling" : "secondary"].filter(Boolean).join(" · ");
    return `${i + 1}. ${a.title} (${meta})\n   ${a.excerpt.slice(0, 300).replace(/\s+/g, " ")}`;
  });
  return `## Retrieved artifacts\n\nYou may cite these by exact title as [SRC: <title>]. Only items marked primary may support [VRF].\n\n${lines.join("\n")}`;
}

/** The fixed, per-panelist part of the prompt (what the budget test measures). */
export function composePanelistCore(member: CastMember, shared: SharedSkills): string {
  const p = member.persona;
  const domains = p.idf_domains.map((d) => `${d.code} ${d.name}`).join(", ");
  const identity = [
    `# You are ${p.display_name}, ${p.role} on the ThoughtForge panel.`,
    `IDF domains: ${domains}.`,
    p.domains_as_written ? `Domains as written: ${p.domains_as_written}` : null,
  ].filter(Boolean).join("\n");
  const voice = [`## Voice`, p.voice_brief, p.sample_line ? `Sample line: "${p.sample_line}"` : null].filter(Boolean).join("\n");
  const backstory = `## Backstory\n${dossierSection(member.dossier, "Backstory")}`;
  const life = `## Life outside work\n${dossierSection(member.dossier, "Life outside work")}`;
  const own = member.skills.map((s) => `## Skill: ${s.name}\n${s.body}`).join("\n\n");
  const sharedText = shared.all.map((s) => `## Shared skill: ${s.name}\n${s.body}`).join("\n\n");
  return [identity, voice, backstory, life, own, sharedText, EVIDENCE_LADDER_CONTRACT].join("\n\n");
}

/** Full system prompt for one turn: fixed core, then retrieval, then turn instructions. */
export function composeSystemPrompt(member: CastMember, shared: SharedSkills, context: PromptContext): string {
  const parts = [composePanelistCore(member, shared), retrievedBlock(context.artifacts)];
  if (context.turnInstructions) parts.push(context.turnInstructions);
  return parts.join("\n\n");
}
