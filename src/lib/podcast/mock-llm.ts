/**
 * TF_MOCK=1 model (TH-37): deterministic, offline, keyless. It builds each turn from the first sentence of the
 * signal in the prompt plus generic spoken filler, sized to the turn's word target, so the full pipeline (schema,
 * word band, audit, show notes, tf_episodes row) can be exercised and a fixture committed. It says nothing real:
 * the fixture it produces is an example of the SHAPE, never episode copy.
 */
import { countWords } from "./script-schema";
import type { Llm } from "./llm";

export const isMock = () => process.env.TF_MOCK === "1";

const FILLER = [
  "That is the number to hold onto, because everything downstream is arithmetic on it.",
  "I would not read too much into a single announcement until the filings back it up.",
  "The constraint here is rarely the headline figure and usually the schedule behind it.",
  "If the timeline slips by a quarter, the economics change more than most people expect.",
  "What matters for a site selector is whether the capacity can actually be energized on the date promised.",
  "We have seen this pattern before, and it tends to resolve slower than the first reports suggest.",
  "The risk is not that the demand disappears, it is that the supply chain cannot keep pace with it.",
  "Anyone planning around this should ask who carries the cost if the schedule moves.",
  "The part people skip is the interconnection and permitting sequence, which sets the real critical path.",
  "I would want to see the contract terms before treating this as settled.",
  "That reading is reasonable, but it leans on an assumption nobody has tested yet.",
  "The honest answer is that the data supports a narrower claim than the one being made.",
  "There is a version of this story that is good news and a version that is a warning, and the details decide which.",
  "A careful operator would plan for the slower case and treat the faster case as upside.",
  "The evidence is thinner than the confidence in the coverage, and that gap is worth naming.",
  "Capital is available, so the binding limit is power, land and people, in that order.",
  "None of this changes the direction of travel, only the pace and who benefits first.",
  "If I am wrong, it will be because a regulator or a utility moves faster than I have assumed.",
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function factSentence(system: string): string {
  const block = system.split("## Retrieved artifacts")[1] ?? "";
  const line = block.split("\n").find((l) => /^\s{3}\S/.test(l)) ?? "";
  const first = line.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return first.split(/\s+/).slice(0, 28).join(" ").replace(/[,;:]+$/, "");
}

const OPENERS: Record<string, string> = {
  cold_open: "Good morning, and welcome to the panel. Three stories this week, and as usual two of us will disagree.",
  ask: "Here is the first thing to know.",
  a1: "My read is simple, and I will commit to it.",
  b1: "I disagree with that on the timeline, and I will say why.",
  probe: "So let me pin it down.",
  a2: "I will hold my ground on the main point.",
  b2: "I will move a little, but not on the central claim.",
  rule: "Here is my ruling.",
  read1: "The Read. Across all three stories, the same pattern shows up.",
  read2: "My call for the week.",
  sign_off: "That is the panel for today. Thank you both, and we will be back tomorrow.",
};
const CLOSERS: Record<string, string> = {
  rule: "The disagreement is whether the stated timeline is credible or optimistic.",
  read2: "What would change my mind is a signed contract with a dated energization schedule.",
};

export const mockLlm: Llm = async (req) => {
  const tag = req.meta.tag;
  if (tag === "grade") {
    const ids = [...req.user.matchAll(/^- ([^\s:]+):/gm)].map((m) => m[1]);
    const grades = Object.fromEntries(ids.map((id) => [id, /\b(?:projected|forecast|expected to|estimate)/i.test(req.user.split(`- ${id}:`)[1]?.split("\n- ")[0] ?? "") ? "EST" : "SRC"]));
    return JSON.stringify({ grades });
  }
  const key = tag.includes(":") ? tag.split(":")[1] : tag;
  const target = req.meta.target;
  const closer = CLOSERS[key] ?? "";
  const parts: string[] = [OPENERS[key] ?? ""];
  if (/^(ask|a1|b1|a2)$/.test(key) || key === "cold_open") {
    const f = factSentence(req.system);
    if (f && key !== "cold_open") parts.push(f.endsWith(".") ? f : `${f}.`);
  }
  let i = hash(`${tag}|${req.meta.speaker}`) % FILLER.length;
  const budget = Math.min(target, 88) - (closer ? countWords(closer) : 0);
  while (countWords(parts.filter(Boolean).join(" ")) < budget - 12) {
    parts.push(FILLER[i % FILLER.length]);
    i += 7;
  }
  while (countWords(parts.filter(Boolean).join(" ")) > budget + 2 && parts.length > 2) parts.pop();
  if (closer) parts.push(closer);
  return parts.filter(Boolean).join(" ");
};
