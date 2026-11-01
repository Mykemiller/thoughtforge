// Pure helpers for the cast QA audit (Linear TH-30). No file or network I/O here.

export type NameClass = "FIC" | "REAL-ORG" | "REAL-EVENT" | "VOICE" | "ALLOW" | "SPINE-OUTSIDE-NETWORK" | "ARCHETYPE" | "UNCLASSIFIED";

const LEADING_STOP = new Set([
  "The", "A", "An", "In", "At", "On", "His", "Her", "Hers", "She", "He", "They", "Their", "When", "After", "Before", "From",
  "With", "For", "By", "Every", "Each", "This", "That", "Then", "Our", "My", "I", "If", "As", "And", "But", "Or", "Also",
  "Most", "Some", "Two", "Three", "One", "Four", "Five", "Once", "Still", "Only", "Now", "Over", "Since", "Until", "While",
  "Went", "Will", "Sat", "Took", "Ran", "Met", "Led", "Got", "Was", "Is", "Has", "Had", "Not", "No", "Any", "All", "Both",
  "Name", "Role", "Born", "Hobbies", "Sports", "Frailties", "Generosity", "Modesty", "Favorite", "What", "Who", "Why", "How",
]);
const JOINERS = new Set(["of", "de", "van", "von", "and", "&", "the", "for", "la", "du", "del", "di", "y"]);
const CODE = /^(?:R\d{1,2}|TH-\d+|D\d{1,2}(?:\.\d+)?|TF-(?:DEC|OPEN)-\d+)$/;
const ALLCAPS = /^[A-Z0-9][A-Z0-9&.\-]*[A-Z0-9]$/;
const CALENDAR = new Set(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Saturdays", "Sundays"]);
const CAP = /^(?:[A-Z][A-Za-z0-9'’.\-]*|[A-Z]\.(?:[A-Z]\.)*|\d+(?:st|nd|rd|th)?)$/;

/** Strip markdown noise so the extractor sees prose. */
export function plain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_#>|]/g, " ")
    .replace(/\[(?:FIC|REAL-ORG|REAL-EVENT|VOICE)[^\]]*\]/g, " ");
}

/**
 * Capitalized-run proper-noun extractor: runs of two or more capitalized tokens (joiners such as
 * "of" or "&" allowed inside), plus single capitalized tokens that do not start a sentence or line.
 */
export function properNouns(text: string): string[] {
  const out = new Set<string>();
  for (const rawLine0 of plain(text).split(/\n/)) {
    const rawLine = rawLine0.replace(/^\s*(?:[-+]|\d+[.)])\s+/, "");
    const sentences = rawLine.split(/(?<=[.!?:;])\s+|\s+[-–—]\s+|[()"“”,]/);
    for (const s of sentences) {
      const toks = s.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/^[^\w&]+|[^\w.'’&]+$/g, "").replace(/['’]s$/, "").replace(/\.$/, ""));
      let run: string[] = [];
      const flush = (startIdx: number) => {
        while (run.length && (CODE.test(run[0]))) { run.shift(); startIdx++; }
        while (run.length && JOINERS.has(run[run.length - 1])) run.pop();
        while (run.length && (LEADING_STOP.has(run[0]) || JOINERS.has(run[0]))) { run.shift(); startIdx++; }
        const caps = run.filter((t) => !JOINERS.has(t));
        if (caps.length >= 2) out.add(run.join(" "));
        else if (caps.length === 1 && startIdx > 0 && !/^\d/.test(caps[0]) && caps[0].length > 1 && !ALLCAPS.test(caps[0]) && !CALENDAR.has(caps[0])) out.add(caps[0]);
        run = [];
      };
      let start = 0;
      toks.forEach((t, i) => {
        if (!t) return;
        if (CAP.test(t) && !/^\d+$/.test(t)) {
          if (!run.length) start = i;
          run.push(t);
        } else if (run.length && JOINERS.has(t) && i + 1 < toks.length && CAP.test(toks[i + 1] ?? "")) {
          run.push(t);
        } else if (run.length) {
          flush(start);
        }
      });
      if (run.length) flush(start);
    }
  }
  return [...out];
}

export interface Lexicon {
  fictionalNames: string[];      // full names: panelists, family, associates
  fictionalTokens: Set<string>;  // first and last name tokens of the above
  orgs: string[];                // REAL-ORG strings
  events: string[];              // REAL-EVENT strings (moment events and venues)
  allow: string[];               // reviewed non-person phrases: places, teams, products, standards, terms
  archetypes: string[];          // register references that must never appear (TF-DEC-13)
  spineNames: string[];          // real people known to the people spine (snapshot + spine scan)
}

const lc = (s: string) => s.toLowerCase();
const tokensOf = (s: string) => s.split(/\s+/).filter((t) => !JOINERS.has(t));

export function archetypeHits(text: string, archetypes: string[], exceptions: string[] = []): string[] {
  let t = text;
  for (const e of exceptions) t = t.split(e).join(" ");
  return archetypes.filter((a) => new RegExp(`(^|[^A-Za-z])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`).test(t));
}

/** Classify one phrase for one panelist. `network` holds that panelist's VOICE names. */
export function classify(phrase: string, lex: Lexicon, network: string[]): NameClass {
  const p = lc(phrase);
  if (lex.archetypes.some((a) => p === lc(a) || tokensOf(phrase).some((t) => lc(t) === lc(a)))) return "ARCHETYPE";
  const toks = tokensOf(phrase);
  const last = (n: string) => lc(n.split(" ").slice(-1)[0]);
  const netHit = network.some((n) => p.includes(lc(n)) || (toks.length >= 2 && lc(n).includes(p)) || (toks.length === 1 && last(n) === p));
  if (netHit) return "VOICE";
  if (lex.spineNames.some((n) => p.includes(lc(n)))) return "SPINE-OUTSIDE-NETWORK";
  if (lex.fictionalNames.some((n) => p.includes(lc(n)) || lc(n).includes(p))) return "FIC";
  if (toks.length && toks.every((t) => lex.fictionalTokens.has(t))) return "FIC";
  if (lex.orgs.some((o) => lc(o).includes(p) || p.includes(lc(o)))) return "REAL-ORG";
  if (lex.allow.some((a) => p === lc(a) || p.includes(lc(a)) && a.includes(" "))) return "ALLOW";
  return "UNCLASSIFIED";
}

/** Rough token estimate for prompt budgeting: about 3.5 characters per token for English prose and markdown. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.5);

/** "1997-2001" or "2019" to [start, end]. */
export function yearSpan(s: string): [number, number] | null {
  const m = String(s).match(/(\d{4})(?:\s*[-–]\s*(\d{4}))?/);
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : null;
}

export const within = (inner: [number, number], start: number, end: number | null | undefined) =>
  inner[0] >= start && inner[1] <= (end ?? 9999);

/** Extract one markdown section by its "## " heading. */
export function section(md: string, heading: string): string {
  const re = new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m");
  return md.match(re)?.[1] ?? "";
}
