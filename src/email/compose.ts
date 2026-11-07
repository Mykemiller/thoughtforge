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
import type { DayThreadEntry, GameResult, SlotContext } from "./context/types";
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
/** TH-66 day slots. The hook is model-written and cleaned like the briefing's. */
export const asideSubject = (firstName: string, hook: string) => `${firstName}, quickly: ${hook}`;
export const newsTakeSubject = (firstName: string, hook: string) => `${firstName} on the news: ${hook}`;
export const weekendSubject = (firstName: string, hook: string) => `Weekend note from ${firstName}: ${hook}`;
/** Kinds whose model output starts with "Hook: ...". */
export const HOOK_KINDS: readonly EmailKind[] = ["briefing", "aside", "news-take", "weekend-note"];
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
- Never claim to have attended, read or spoken to anything that is not in the context you are given.
- Never write about input you do not have: no sentence saying a digest, the Signal, the news or anything else has not landed, is missing or is quiet. If one source is empty, use another; if all are, write from your own domains.
- Refer to projects by their plain title. Never write an issue number such as a team key followed by a number.
- Humor is welcome when it is yours; no mysticism, no fortune-telling, no talk of fate or energy.`;

/**
 * The opener rule (TH-47): the first one or two sentences say why the panelist is writing,
 * naming the trigger. Each kind names its own trigger; the model phrases it in the panelist's voice.
 */
export const OPENER_RULE = `## Opener
Your first one or two sentences say why you are writing today: name the trigger in your own words (the Signal edition and the one item you picked, a project that moved, a news item, a colleague's note you are answering, the reader's message, or something from your own week). Then get to the idea. No throat-clearing before the trigger.`;

export const LENGTH_RULES: Record<EmailKind, string> = {
  briefing: "120 to 220 words.",
  "cold-open": "120 to 220 words.",
  "signal-takeaway": "120 to 220 words.",
  "roundtable-opener": "At most 60 words, two short paragraphs at most.",
  reply: "80 to 200 words. Answer what was asked; do not restart the topic from the top.",
  "thread-reply": "80 to 160 words. One point: agree, push back, or add one fact.",
  aside: "50 to 120 words. Casual, one small thing, tied to work in one sentence.",
  "news-take": "120 to 220 words.",
  "weekend-note": "60 to 120 words. Personal register; work at most in passing.",
};

/** TH-66: the morning note is longer when it carries the day (180 to 300 words). */
export const DAY_LENGTH_OVERRIDE: Partial<Record<EmailKind, string>> = { briefing: "180 to 300 words." };

/** System prompt: the panelist's voice from the cast files, then the hard rules. */
export function emailSystemPrompt(p: EmailPanelist, kind: EmailKind = "briefing", dayMode = false): string {
  const voice = [`## Voice`, p.voiceBrief, p.sampleLine ? `Sample line: "${p.sampleLine}"` : null].filter(Boolean).join("\n");
  return [
    `# You are ${p.name}, ${p.role} on the ThoughtForge panel of Faraday Intelligence.`,
    `Your domains: ${p.domains}. The panel's current focus: ${PANEL_FOCUS}.`,
    voice,
    `## Backstory\n${p.backstory}`,
    `## Life outside work\n${p.lifeOutsideWork}`,
    `${HARD_RULES}\n- ${(dayMode && DAY_LENGTH_OVERRIDE[kind]) || LENGTH_RULES[kind]}`,
    ...(dayMode ? [REGISTER_RULE] : []),
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

/** TH-66: the colleague register for the panel day. */
export const REGISTER_RULE = `## Register for today
You are one of ten colleagues who email the reader through the day and read each other's notes. Pithy and specific: one idea per email, the kind of note a colleague sends between meetings. Sign-off is only your name and role, added for you. When you reply to a colleague, address them by first name and quote at most one phrase of theirs.`;

const gameLine = (g: GameResult) => `${g.team} ${g.result === "W" ? "beat" : g.result === "L" ? "lost to" : "tied"} ${g.opponent}, ${g.teamScore}-${g.opponentScore} (${g.league}, final)`;

/** The day's lanes as prompt text. Empty lanes are left out, never announced. */
export function renderLanes(day: SlotContext, opts: { personal?: boolean; projects?: boolean; signal?: boolean; news?: boolean } = {}): string {
  const want = { personal: true, projects: true, signal: true, news: true, ...opts };
  const out: string[] = [];
  if (want.projects && day.projects.length) {
    out.push(
      `## What the reader's team is working on (moved in the last day and a half; refer to them by title only)\n` +
        day.projects.map((x) => `- ${x.title} [${x.state}]${x.lastComment ? `: latest comment: "${x.lastComment}"` : ""}`).join("\n"),
    );
  }
  if (want.signal && day.signal) {
    out.push(`## Faraday Signal Digest, edition ${day.signal.editionDate} ("${day.signal.subject}"), top items\n${day.signal.items.map((x, i) => `${i + 1}. ${x}`).join("\n")}`);
  }
  if (want.news && day.news.length) {
    out.push(`## Current news, last 24 hours (headline and outlet only; you have not read the articles)\n${day.news.map((n) => `- "${n.title}" (${n.domain})`).join("\n")}`);
  }
  if (want.personal && day.personal) {
    const pl = day.personal;
    const lines = [
      pl.sports && `Teams you follow: ${pl.sports}`,
      pl.hobbies && `Hobbies: ${pl.hobbies}`,
      pl.laughs && `What makes you laugh: ${pl.laughs}`,
      pl.places && `Favorite places: ${pl.places}`,
      pl.family.length ? `Family: ${pl.family.join(" ")}` : "",
    ].filter(Boolean);
    const games = day.sports.length
      ? `Last night's finals for your teams (the only scores you know): ${day.sports.map(gameLine).join("; ")}.`
      : `You have no score from last night in front of you: do not state or imply any result; if a game comes up, you didn't catch the end.`;
    out.push(`## Your own life (from your file; your family and friends are yours, not public figures)\n${[...lines, games].join("\n")}`);
  }
  return out.join("\n\n");
}

/** Today's earlier emails, so later slots know the conversation. */
export function renderDayThread(thread: DayThreadEntry[]): string {
  return thread.map((t) => `${t.author} (${t.slot}) wrote, subject "${t.subject}":\n${t.body.slice(0, THREAD_MESSAGE_MAX_CHARS).trim()}`).join("\n\n---\n\n");
}

const dayThreadBlock = (day?: SlotContext) => (day?.thread.length ? [``, `## Earlier today from the panel (read; do not repeat it)`, renderDayThread(day.thread)] : []);
const lanesBlock = (day: SlotContext | undefined, opts?: Parameters<typeof renderLanes>[1]) => {
  const r = day ? renderLanes(day, opts) : "";
  return r ? [``, r] : [];
};
const hookLine = `Output format, exactly: first line "Hook: " followed by a 4 to 8 word hook for the subject line, then one blank line, then the email body.`;

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
            `Pick the one thing that matters most this morning for ${PANEL_FOCUS}, from your domains (${p.domains}): a project of the reader's that moved, a news item, or your own read of the week, whichever is strongest in what you are given. Your opener names it. Say what ${reader} should do or watch today.`,
          ];
      return [
        `Email type: morning note.`,
        `Today is ${context.date} (US Central). You chair today's panel and write the morning note to ${reader}. Colleagues will follow up on it through the day.`,
        ...trigger,
        `Output format, exactly: first line "Hook: " followed by a 5 to 8 word hook for the subject line, then one blank line, then the email body.`,
        ...(context.signal ? [``, signalBlock(context.signal)] : []),
        ...lanesBlock(context.day, { personal: false, signal: !context.signal }),
      ].join("\n");
    }
    case "cold-open":
      return [
        `Email type: cold open.`,
        `Today is ${context.date} (US Central). Nobody asked; you are writing to ${reader} unprompted, and your opener says so in your own way.`,
        `Write one provocation: the single thing in your domains (${p.domains}) you think ${reader} should worry about this week, why it is easy to miss, and what you would check first.`,
        `Output the email body only.`,
        ...lanesBlock(context.day, { personal: false }),
        ...dayThreadBlock(context.day),
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
    case "thread-reply": {
      const a = context.day?.answering;
      if (!a) throw new Error("compose: thread-reply needs context.day.answering");
      return [
        `Email type: thread reply.`,
        `Today is ${context.date} (US Central). ${a.firstName} sent the note below to ${reader} this morning and you are replying in that thread, to both of them.`,
        `Address ${a.firstName} by first name in your opener and quote at most one short phrase of theirs. Then make one point from your domains (${p.domains}): agree and sharpen it, push back with a reason, or add one fact from what you are given. Do not restate their note.`,
        `Output the email body only.`,
        ``,
        `## ${a.author}'s note (subject "${a.subject}")`,
        a.body.slice(0, THREAD_MESSAGE_MAX_CHARS).trim(),
        ...lanesBlock(context.day, { personal: false }),
      ].join("\n");
    }
    case "aside":
      return [
        `Email type: aside.`,
        `Today is ${context.date} (US Central). Midday. You are sending ${reader} a short, casual note: something from your own life this week (a kid, a game, a trip, something that made you laugh), tied to work in one sentence, ideally to something the panel or the reader's team has on today.`,
        `Only real scores you are given; otherwise no result at all. Family members are your own, from your file.`,
        hookLine,
        ...lanesBlock(context.day, { signal: false, news: false }),
        ...dayThreadBlock(context.day),
      ].join("\n");
    case "news-take": {
      return [
        `Email type: news take.`,
        `Today is ${context.date} (US Central). Late afternoon. Pick the one current item below that matters most for ${PANEL_FOCUS} from your domains (${p.domains}); your opener names it and the outlet. Say what it means for the reader's work and what you would watch next. You have seen the headline only; do not invent what the article says.`,
        `If there is no news item below, pick the strongest item from the Signal or the reader's projects instead, and name that.`,
        hookLine,
        ...lanesBlock(context.day, { personal: false }),
        ...dayThreadBlock(context.day),
      ].join("\n");
    }
    case "weekend-note":
      return [
        `Email type: weekend note.`,
        `Today is ${context.date} (US Central), Saturday. A short personal note to ${reader}: what your weekend looks like, a game, family, a place you are headed. Work at most in passing, one sentence.`,
        `Only real scores you are given; otherwise no result at all.`,
        hookLine,
        ...lanesBlock(context.day, { signal: false, news: false, projects: false }),
      ].join("\n");
  }
}

// ---------- output handling ----------

const FORBIDDEN = [/\bas an ai\b/i, /\blanguage model\b/i, /\bfictional\b/i, /\bsystem prompt\b/i];

/**
 * TH-66: sentences about missing input. A lane that is empty is never announced
 * ("no Signal Digest has landed", "I have no fresh news item").
 */
export const MISSING_INPUT: readonly RegExp[] = [
  /\bno\s+(?:new\s+|fresh\s+)?(?:signal|digest)\b[^.!?\n]{0,40}\b(?:landed|arrived|came in|in front of me|today|this morning)/i,
  /\b(?:signal|digest)\b[^.!?\n]{0,30}\b(?:has(?:n't| not)|did(?:n't| not)|never)\s+(?:land|landed|arrive|arrived|come in|came in)/i,
  /\bnothing\s+(?:new\s+)?(?:has\s+)?landed\b/i,
  /\bno\s+(?:fresh\s+|new\s+)?news(?:\s+item)?s?\b[^.!?\n]{0,30}\b(?:today|in front of me|to (?:share|report)|landed)/i,
  /\bi\s+have\s+no\s+(?:fresh|new)\s+(?:news|item|signal)/i,
  /\bnothing\s+(?:new\s+)?in\s+front\s+of\s+me\b/i,
];
/** TH-66: projects by plain title, never by issue number. */
export const ISSUE_NUMBER = /\bTH-\d+\b/;

/** The sentence-level guard on its own, for tests and the preview. */
export const mentionsMissingInput = (body: string) => MISSING_INPUT.some((re) => re.test(body));
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+/m;

/** Problems that make a body unsendable (one retry, then the send is skipped). */
export function bodyProblems(body: string): string[] {
  const out: string[] = [];
  for (const re of FORBIDDEN) if (re.test(body)) out.push(`forbidden phrase ${re.source}`);
  for (const re of MISSING_INPUT) if (re.test(body)) out.push("talks about missing input");
  if (ISSUE_NUMBER.test(body)) out.push("names an issue number");
  if (LIST_LINE.test(body)) out.push("contains a list");
  if (!body.trim()) out.push("empty body");
  return out;
}

/** Splits the model output into an optional hook and the body. */
export function parseModelOutput(kind: EmailKind, text: string): { hook: string | null; body: string } {
  let t = text.replace(/\r\n/g, "\n").trim();
  let hook: string | null = null;
  if (HOOK_KINDS.includes(kind)) {
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
    case "thread-reply": {
      const original = context.replySubject ?? context.day?.answering?.subject;
      if (!original) throw new Error("compose: thread-reply needs the subject it answers");
      return replySubject(original);
    }
    case "aside":
      return asideSubject(p.firstName, hook && wordCount(hook) >= 3 ? hook : "one thing from today");
    case "news-take":
      return newsTakeSubject(p.firstName, hook && wordCount(hook) >= 3 ? hook : `what moved on ${context.date}`);
    case "weekend-note":
      return weekendSubject(p.firstName, hook && wordCount(hook) >= 3 ? hook : "Saturday, briefly");
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
  const system = emailSystemPrompt(panelist, kind, Boolean(context.day));
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
  const typed = user.match(/^Email type: (thread reply|aside|news take|weekend note)\./m)?.[1];
  const dayKind: EmailKind | undefined = typed ? (typed.replace(" ", "-") as EmailKind) : undefined;
  const kind: EmailKind = dayKind ?? (user.includes("## Thread, oldest first")
    ? "reply"
    : user.includes("Write the opener only")
      ? "roundtable-opener"
      : user.includes(TAKEAWAY_OPENER)
        ? "signal-takeaway"
        : user.includes("morning note")
          ? "briefing"
          : "cold-open");
  const edition = user.match(/^## Signal edition date\n(\S+)/m)?.[1];
  const trigger = kind === "reply"
    ? "You wrote back, so this is a canned placeholder reply from TF_MOCK=1."
    : edition
      ? `This is a canned placeholder from TF_MOCK=1 on the Signal edition ${edition}.`
      : `This is a canned ${kind} placeholder from TF_MOCK=1.`;
  const placeholder =
    `${trigger} No model was called, so nothing here is analysis and nothing here should be read as a claim. ` +
    "In a live run this space holds a note in my own voice on one idea from my domains, with any estimate labelled (EST).";
  if (kind === "briefing") return { text: `Hook: canned placeholder note for the preview\n\n${placeholder}`, stopReason: "end_turn" };
  if (HOOK_KINDS.includes(kind)) return { text: `Hook: canned ${kind} for the preview\n\n${placeholder}`, stopReason: "end_turn" };
  if (kind === "signal-takeaway") return { text: `${TAKEAWAY_OPENER}\n${placeholder}`, stopReason: "end_turn" };
  if (kind === "roundtable-opener") return { text: `Canned roundtable opener from TF_MOCK=1${edition ? ` for ${edition}` : ""}: the panel's takeaways follow.`, stopReason: "end_turn" };
  return { text: placeholder, stopReason: "end_turn" };
};
