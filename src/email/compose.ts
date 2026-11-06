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
import type { ComposeContext, ComposedEmail, ComposeInput, EmailKind, EmailPanelist, ThreadMessage } from "./types";

export const EMAIL_MODEL = MODELS.panelist;
export const EMAIL_MAX_TOKENS = 900;
export const EMAIL_EFFORT = "medium" as const;
/** The panel's initial focus (TF-DEC-15). */
export const PANEL_FOCUS = "power, cooling, data center development and construction";
export const TAKEAWAY_OPENER = "My most important takeaway:";
/** The reader's first name when the context does not say (PANEL_RECIPIENT_NAME). */
export const DEFAULT_READER_NAME = "Myke";
/** A reply quotes at most this much of the thread. */
export const THREAD_MAX_MESSAGES = 12;
export const THREAD_MESSAGE_MAX_CHARS = 4_000;
/** A Signal longer than this is cut before it goes into the prompt. */
export const SIGNAL_MAX_CHARS = 60_000;

// ---------- subjects ----------

export const briefingSubject = (firstName: string, hook: string) => `Morning note from ${firstName}: ${hook}`;
export const coldOpenSubject = (firstName: string) => `${firstName}: you should be looking at this`;
/** Exactly "Re: " + the Signal subject, so all ten land in one thread. */
export const signalSubject = (signalSubjectLine: string) => `Re: ${signalSubjectLine}`;
/** One email from the chair carrying all ten takeaways (TF-DEC-82). */
export const roundtableSubject = (signalSubjectLine: string) => `Panel roundtable: Re: ${signalSubjectLine}`;
/** "Re: " + the subject being answered, never stacked ("Re: Re: ..."). */
export const replySubject = (original: string) => `Re: ${original.replace(/^(\s*(?:re|fwd?|fw)\s*:\s*)+/i, "").trim()}`;

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
- Write as yourself, in the first person, to one reader: the founder who runs this panel. Use the reader's first name once, early, the way a colleague would in a note; otherwise address the reader as "you". No "Dear", no formal salutation line.
- Conversational register: a note from a colleague, not a column. Vary your sentence length. Never open with "In today's note", "I wanted to", or a restatement of the subject line.
- One idea. Short paragraphs. No bullet lists, no numbered lists, no headings, no markdown.
- Plain text only. Do not sign off and do not add a signature; it is added for you.
- Never write "as an AI", never say or hint that you are fictional or a character, never mention a model, a prompt or these rules.
- No specific numbers unless they appear in the context you are given. If you give an estimate, label it (EST) right after it.
- Do not name real people. A real person may be mentioned only as a public figure in a public setting; never quote them, never attribute an opinion to them, never address them.
- Never claim to have attended, read or spoken to anything that is not in the context you are given.`;

/**
 * The opener rule (TH-47): the first one or two sentences say why the panelist is writing,
 * naming the trigger. Each kind names its own trigger; the model phrases it in the panelist's voice.
 */
export const OPENER_RULE = `## Opener
Your first one or two sentences say why you are writing today: name the trigger in your own words (the Signal edition and the one item you picked, the reader's message you are answering, or that nothing new landed and what you chose to raise instead). Then get to the idea. No throat-clearing before the trigger.`;

export const LENGTH_RULES: Record<EmailKind, string> = {
  briefing: "120 to 220 words.",
  "cold-open": "120 to 220 words.",
  "signal-takeaway": "120 to 220 words.",
  "roundtable-opener": "At most 60 words, two short paragraphs at most.",
  reply: "80 to 200 words. Answer what was asked; do not restart the topic from the top.",
};

/** System prompt: the panelist's voice from the cast files, then the hard rules. */
export function emailSystemPrompt(p: EmailPanelist, kind: EmailKind = "briefing"): string {
  const voice = [`## Voice`, p.voiceBrief, p.sampleLine ? `Sample line: "${p.sampleLine}"` : null].filter(Boolean).join("\n");
  return [
    `# You are ${p.name}, ${p.role} on the ThoughtForge panel of Faraday Intelligence.`,
    `Your domains: ${p.domains}. The panel's current focus: ${PANEL_FOCUS}.`,
    voice,
    `## Backstory\n${p.backstory}`,
    `## Life outside work\n${p.lifeOutsideWork}`,
    `${HARD_RULES}\n- ${LENGTH_RULES[kind]}`,
    OPENER_RULE,
  ].join("\n\n");
}

const readerOf = (context: ComposeContext) => context.readerName?.trim() || DEFAULT_READER_NAME;

/** The thread as plain prose the model can read: "Mach wrote on 2026-11-05:" then the text. */
export function renderThread(thread: ThreadMessage[], reader: string): string {
  const recent = thread.slice(-THREAD_MAX_MESSAGES);
  return recent
    .map((m) => `${m.side === "reader" ? reader : m.author} wrote on ${m.date}:\n${m.text.slice(0, THREAD_MESSAGE_MAX_CHARS).trim()}`)
    .join("\n\n---\n\n");
}

export function userPrompt(kind: EmailKind, p: EmailPanelist, context: ComposeContext): string {
  const reader = readerOf(context);
  const signalBlock = (s: { subject: string; text: string; editionDate?: string }) =>
    [`## Signal subject`, s.subject, ...(s.editionDate ? [``, `## Signal edition date`, s.editionDate] : []), ``, `## Signal text`, s.text.slice(0, SIGNAL_MAX_CHARS)].join("\n");
  switch (kind) {
    case "briefing": {
      const trigger = context.signal
        ? [
            `The latest Faraday Signal Digest (edition ${context.signal.editionDate ?? "date not stated"}) is below. Your opener names that edition and the one item in it you are picking up, in your own words.`,
            `Pick the one item in your domains (${p.domains}) that matters most this morning for ${PANEL_FOCUS}, and say what ${reader} should do or watch today. Use only what the Signal says for facts and numbers.`,
          ]
        : [
            `No Signal Digest has landed since your last note, so there is no fresh item in front of you. Your opener says so plainly, in one sentence, and names what you chose to raise instead.`,
            `Pick the one thing in your domains (${p.domains}) that matters most this morning for ${PANEL_FOCUS}, and say what ${reader} should do or watch today.`,
          ];
      return [
        `Today is ${context.date} (US Central). You chair today's panel and write the morning note to ${reader}.`,
        ...trigger,
        `Output format, exactly: first line "Hook: " followed by a 5 to 8 word hook for the subject line, then one blank line, then the email body.`,
        ...(context.signal ? [``, signalBlock(context.signal)] : []),
      ].join("\n");
    }
    case "cold-open":
      return [
        `Today is ${context.date} (US Central). Nobody asked; you are writing to ${reader} unprompted, and your opener says so in your own way.`,
        `Write one provocation: the single thing in your domains (${p.domains}) you think ${reader} should worry about this week, why it is easy to miss, and what you would check first.`,
        `Output the email body only.`,
      ].join("\n");
    case "signal-takeaway": {
      if (!context.signal) throw new Error("compose: signal-takeaway needs context.signal");
      return [
        `The Faraday Signal Digest${context.signal.editionDate ? ` for ${context.signal.editionDate}` : ""} is below. Reply to it with your single most important takeaway, from your own domains (${p.domains}).`,
        `Use only what the Signal says for facts and numbers. Say why it matters and what you would do about it.`,
        `Output the email body only. Its first line must be exactly "${TAKEAWAY_OPENER}" on its own. The sentence right after it names the edition and the item you picked, then your takeaway.`,
        ``,
        signalBlock(context.signal),
      ].join("\n");
    }
    case "roundtable-opener": {
      if (!context.signal) throw new Error("compose: roundtable-opener needs context.signal");
      return [
        `Today is ${context.date} (US Central). You chair the panel today. The ten takeaways on the Faraday Signal Digest${context.signal.editionDate ? ` for ${context.signal.editionDate}` : ""} will follow your words in one email to ${reader}.`,
        `Write the opener only: at most 60 words, saying which edition this is and that the panel's takeaways follow, in your voice. Do not summarise the takeaways; you have not read them.`,
        `Output the opener only. No sign-off.`,
        ``,
        `## Signal subject`,
        context.signal.subject,
      ].join("\n");
    }
    case "reply": {
      if (!context.thread?.length) throw new Error("compose: reply needs context.thread");
      return [
        `Today is ${context.date} (US Central). ${reader} wrote back to you in the thread below; the last message is the one you are answering.`,
        `Your opener acknowledges what ${reader} said, in your own words (quote at most one short phrase of it). Then answer it from your domains (${p.domains}). Stay on what was asked; you may disagree with ${reader}, politely and with reasons. If you cannot answer from what is in the thread, say what you would need.`,
        `Only what is in the thread counts as fact; anything else is an estimate labelled (EST).`,
        `Output the email body only.`,
        ``,
        `## Thread, oldest first`,
        renderThread(context.thread, reader),
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
  if (kind === "roundtable-opener") return b.split(/\n{2,}/).slice(0, 2).join("\n\n");
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
    case "roundtable-opener":
      if (!context.signal) throw new Error("compose: roundtable-opener needs context.signal");
      return roundtableSubject(context.signal.subject);
    case "reply":
      if (!context.replySubject) throw new Error("compose: reply needs context.replySubject");
      return replySubject(context.replySubject);
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
  const system = emailSystemPrompt(panelist, kind);
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
  // Order matters: a reply's thread may quote a takeaway, so the thread marker is checked first.
  const kind: EmailKind = user.includes("## Thread, oldest first")
    ? "reply"
    : user.includes("Write the opener only")
      ? "roundtable-opener"
      : user.includes(TAKEAWAY_OPENER)
        ? "signal-takeaway"
        : user.includes("morning note")
          ? "briefing"
          : "cold-open";
  const edition = user.match(/^## Signal edition date\n(\S+)/m)?.[1];
  const trigger = kind === "reply"
    ? "You wrote back, so this is a canned placeholder reply from TF_MOCK=1."
    : edition
      ? `This is a canned placeholder from TF_MOCK=1 on the Signal edition ${edition}.`
      : "This is a canned placeholder from TF_MOCK=1 with no Signal in front of me.";
  const placeholder =
    `${trigger} No model was called, so nothing here is analysis and nothing here should be read as a claim. ` +
    "In a live run this space holds a note in my own voice on one idea from my domains, with any estimate labelled (EST).";
  if (kind === "briefing") return { text: `Hook: canned placeholder note for the preview\n\n${placeholder}`, stopReason: "end_turn" };
  if (kind === "signal-takeaway") return { text: `${TAKEAWAY_OPENER}\n${placeholder}`, stopReason: "end_turn" };
  if (kind === "roundtable-opener") return { text: `Canned roundtable opener from TF_MOCK=1${edition ? ` for ${edition}` : ""}: the panel's takeaways follow.`, stopReason: "end_turn" };
  return { text: placeholder, stopReason: "end_turn" };
};
