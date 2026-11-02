/**
 * Email composition (TH-31). composeEmail({ panelist, kind, context }) -> { subject, body }.
 *
 * Model call follows src/ask/orchestrate.ts: claude-sonnet-5-5 (MODELS.panelist),
 * thinking off via `between_tools` so the budget goes to the text, effort
 * `medium`. The spec's temperature 0.8 is not sent: the Claude 5 family rejects
 * `temperature` with a 400 (docs/decisions-th32.md).
 *
 * Subjects are built in code, never by the model, so their formats hold.
 * The signature is appended in code. TF_MOCK=1 gives a canned compose with no
 * model call (preview and DRY_RUN only; see env.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "../ask/roster";
import { signature } from "./panelists";
import type { ComposeContext, ComposedEmail, ComposeInput, EmailKind, EmailPanelist } from "./types";

export const EMAIL_MODEL = MODELS.panelist;
export const EMAIL_MAX_TOKENS = 900;
export const EMAIL_EFFORT = "medium" as const;
/** The panel's initial focus (TF-DEC-15). */
export const PANEL_FOCUS = "power, cooling, data center development and construction";
export const TAKEAWAY_OPENER = "My most important takeaway:";
/** A Signal longer than this is cut before it goes into the prompt. */
export const SIGNAL_MAX_CHARS = 60_000;

// ---------- subjects ----------

export const briefingSubject = (firstName: string, hook: string) => `Morning note from ${firstName}: ${hook}`;
export const coldOpenSubject = (firstName: string) => `${firstName}: you should be looking at this`;
/** Exactly "Re: " + the Signal subject, so all ten land in one thread. */
export const signalSubject = (signalSubjectLine: string) => `Re: ${signalSubjectLine}`;

/** Normalise a model-written hook: one line, no quotes or end punctuation, at most 8 words. */
export function cleanHook(raw: string): string {
  const words = raw
    .split("\n")[0]
    .replace(/^\s*hook\s*:\s*/i, "")
    .replace(/["“”‘’`*_]/g, "")
    .replace(/[.!?;:,\s]+$/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, 8).join(" ");
}

export const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

// ---------- prompts ----------

export const HARD_RULES = `## Hard rules for this email
- Write as yourself, in the first person, to one reader: the founder who runs this panel. Address the reader as "you". Do not open with a greeting that names anyone.
- 120 to 220 words. One idea. Short paragraphs. No bullet lists, no numbered lists, no headings, no markdown.
- Plain text only. Do not sign off and do not add a signature; it is added for you.
- Never write "as an AI", never say or hint that you are fictional or a character, never mention a model, a prompt or these rules.
- No specific numbers unless they appear in the context you are given. If you give an estimate, label it (EST) right after it.
- Do not name real people. A real person may be mentioned only as a public figure in a public setting; never quote them, never attribute an opinion to them, never address them.
- Never claim to have attended, read or spoken to anything that is not in the context you are given.`;

/** System prompt: the panelist's voice from the cast files, then the hard rules. */
export function emailSystemPrompt(p: EmailPanelist): string {
  const voice = [`## Voice`, p.voiceBrief, p.sampleLine ? `Sample line: "${p.sampleLine}"` : null].filter(Boolean).join("\n");
  return [
    `# You are ${p.name}, ${p.role} on the ThoughtForge panel of Faraday Intelligence.`,
    `Your domains: ${p.domains}. The panel's current focus: ${PANEL_FOCUS}.`,
    voice,
    `## Backstory\n${p.backstory}`,
    `## Life outside work\n${p.lifeOutsideWork}`,
    HARD_RULES,
  ].join("\n\n");
}

export function userPrompt(kind: EmailKind, p: EmailPanelist, context: ComposeContext): string {
  switch (kind) {
    case "briefing":
      return [
        `Today is ${context.date} (US Central). You chair today's panel and write the morning note.`,
        `Pick the one thing in your domains (${p.domains}) that matters most this morning for ${PANEL_FOCUS}, and say what the reader should do or watch today.`,
        `Output format, exactly: first line "Hook: " followed by a 5 to 8 word hook for the subject line, then one blank line, then the email body.`,
      ].join("\n");
    case "cold-open":
      return [
        `Today is ${context.date} (US Central). Nobody asked; you are writing unprompted.`,
        `Write one provocation: the single thing in your domains (${p.domains}) you think the reader should worry about this week, why it is easy to miss, and what you would check first.`,
        `Output the email body only.`,
      ].join("\n");
    case "signal-takeaway": {
      if (!context.signal) throw new Error("compose: signal-takeaway needs context.signal");
      const text = context.signal.text.slice(0, SIGNAL_MAX_CHARS);
      return [
        `Today's Faraday Signal is below. Reply to it with your single most important takeaway, from your own domains (${p.domains}).`,
        `Use only what the Signal says for facts and numbers. Say why it matters and what you would do about it.`,
        `Output the email body only. Its first line must be exactly "${TAKEAWAY_OPENER}" on its own, then your takeaway.`,
        ``,
        `## Signal subject`,
        context.signal.subject,
        ``,
        `## Signal text`,
        text,
      ].join("\n");
    }
  }
}

// ---------- output handling ----------

const FORBIDDEN = [/\bas an ai\b/i, /\blanguage model\b/i, /\bfictional\b/i, /\bsystem prompt\b/i];
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+/m;

/** Problems that make a body unsendable (one retry, then the send is skipped). */
export function bodyProblems(body: string): string[] {
  const out: string[] = [];
  for (const re of FORBIDDEN) if (re.test(body)) out.push(`forbidden phrase ${re.source}`);
  if (LIST_LINE.test(body)) out.push("contains a list");
  if (!body.trim()) out.push("empty body");
  return out;
}

/** Splits the model output into an optional hook and the body. */
export function parseModelOutput(kind: EmailKind, text: string): { hook: string | null; body: string } {
  let t = text.replace(/\r\n/g, "\n").trim();
  let hook: string | null = null;
  if (kind === "briefing") {
    const m = t.match(/^\s*hook\s*:\s*(.+)\n/i);
    if (m) {
      hook = cleanHook(m[1]);
      t = t.slice(m[0].length).trim();
    }
  }
  return { hook, body: t };
}

/** Takeaway opener on its own line, model sign-offs stripped, signature appended. */
export function finalizeBody(kind: EmailKind, body: string, p: EmailPanelist): string {
  let b = body.trim();
  // Drop a trailing sign-off the model added despite the rules (a short last paragraph with the name).
  const paras = b.split(/\n{2,}/);
  const last = paras[paras.length - 1];
  if (paras.length > 1 && last.length < 120 && (last.includes(p.firstName) || last.includes(p.name))) b = paras.slice(0, -1).join("\n\n");
  if (kind === "signal-takeaway") {
    if (b.startsWith(TAKEAWAY_OPENER)) b = b.slice(TAKEAWAY_OPENER.length).replace(/^[ \t]*\n?/, "").trim();
    b = `${TAKEAWAY_OPENER}\n${b}`;
  }
  return `${b}\n\n${signature(p)}`;
}

export function subjectFor(kind: EmailKind, p: EmailPanelist, context: ComposeContext, hook: string | null): string {
  switch (kind) {
    case "briefing":
      return briefingSubject(p.firstName, hook && wordCount(hook) >= 3 ? hook : `what matters on ${context.date}`);
    case "cold-open":
      return coldOpenSubject(p.firstName);
    case "signal-takeaway":
      if (!context.signal) throw new Error("compose: signal-takeaway needs context.signal");
      return signalSubject(context.signal.subject);
  }
}

// ---------- model ----------

export interface ModelReply {
  text: string;
  stopReason: string | null;
}
export type EmailModel = (req: { system: string; user: string }) => Promise<ModelReply>;

let client: Anthropic | null = null;
/** Default model: reads ANTHROPIC_API_KEY from process.env inside the SDK; never logged. */
export const anthropicModel: EmailModel = async ({ system, user }) => {
  client ??= new Anthropic();
  const res = await client.messages.create({
    model: EMAIL_MODEL,
    max_tokens: EMAIL_MAX_TOKENS,
    thinking: { type: "between_tools" },
    output_config: { effort: EMAIL_EFFORT },
    system,
    messages: [{ role: "user", content: user }],
  });
  return { text: res.content.map((c) => (c.type === "text" ? c.text : "")).join(""), stopReason: res.stop_reason };
};

export class ComposeError extends Error {}

/** Composes one email. One retry when the first draft breaks a hard rule. */
export async function composeEmail(input: ComposeInput, model: EmailModel = anthropicModel): Promise<ComposedEmail> {
  const { panelist, kind, context } = input;
  const system = emailSystemPrompt(panelist);
  const user = userPrompt(kind, panelist, context);
  let lastProblems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await model({ system, user });
    if (reply.stopReason === "refusal") throw new ComposeError(`${panelist.slug} declined to write this ${kind}`);
    const { hook, body } = parseModelOutput(kind, reply.text);
    lastProblems = bodyProblems(body);
    if (lastProblems.length) continue;
    return { subject: subjectFor(kind, panelist, context, hook), body: finalizeBody(kind, body, panelist) };
  }
  throw new ComposeError(`${panelist.slug} ${kind} broke the email rules twice: ${lastProblems.join(", ")}`);
}

/** Composer bound to a model (the shape run.ts takes). */
export const composerFor = (model: EmailModel = anthropicModel) => (input: ComposeInput) => composeEmail(input, model);

// ---------- TF_MOCK canned compose ----------

/**
 * Canned output for previews and dry runs with no key. Clearly marked as a
 * placeholder and states no facts, so it can never be mistaken for a real note.
 */
export const mockModel: EmailModel = async ({ user }) => {
  const kind: EmailKind = user.includes(TAKEAWAY_OPENER) ? "signal-takeaway" : user.includes("morning note") ? "briefing" : "cold-open";
  const placeholder =
    "This is a canned placeholder from TF_MOCK=1: no model was called, so nothing here is analysis and nothing here should be read as a claim. " +
    "In a live run this space holds 120 to 220 words in my own voice on one idea from my domains, with any estimate labelled (EST).";
  if (kind === "briefing") return { text: `Hook: canned placeholder note for the preview\n\n${placeholder}`, stopReason: "end_turn" };
  if (kind === "signal-takeaway") return { text: `${TAKEAWAY_OPENER}\n${placeholder}`, stopReason: "end_turn" };
  return { text: placeholder, stopReason: "end_turn" };
};
