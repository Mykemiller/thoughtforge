// Real-name audit over a generated episode script (TF-DEC-61, TH-37). Reuses the cast audit's extractor and lexicon
// (scripts/lib/audit-core.ts), so "a real person" means the same thing here as in `npm run audit:cast`.
//
// Hard failures (the script is regenerated, then marked failed):
//   - a speaker who is not on the episode's cast, or an off-mic persona;
//   - a name that is in the people spine but outside the speaker's own network, or an archetype reference (TF-DEC-13);
//   - any name that is not a cast member, allowed phrase or the speaker's own network VOICE, placed in a
//     friend / mentor / colleague / endorser sentence (a public figure may appear only as the subject of a Signal).
// Review items (listed, not failing): a person-shaped name that is neither a cast name, an org, an allowed phrase nor
//   present in the selected signals' own text.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { properNouns, classify, archetypeHits, plain, type Lexicon } from "./audit-core.ts";
import type { EpisodeScript } from "../../src/lib/podcast/script-schema.ts";
import { OFF_MIC } from "../../src/lib/podcast/select-cast.ts";

export interface AuditContext {
  lexicon: Lexicon;
  archetypeExceptions: string[];
  /** slug -> that panelist's VOICE names (cast/<slug>/persona.json network). */
  networks: Record<string, string[]>;
  /** Everything the three selected signals say, as the only licence to name a public figure. */
  signalText: string;
  castSlugs: string[];
}
export interface PodcastAudit {
  ok: boolean;
  failures: string[];
  review: string[];
}

const RELATIONAL = /\b(?:friends?|mentors?|mentored|colleagues?|old boss|protég[ée]s?|endors(?:e|es|ed|ement)|vouch(?:es|ed)? for|taught me|trained me|my (?:former|old) \w+|longtime|roommate|godfather)\b/i;
const ORGISH = /\b(?:Inc|LLC|Corp|Corporation|Company|Group|Partners|Authority|Commission|Council|Department|University|Institute|Association|Bank|Energy|Power|Data|Technologies|Technology|Systems|Capital|Holdings|Foundation|Board|Ministry|County|Parliament|Congress|Senate|Court)\b/;

export function buildLexicon(root: string): { lexicon: Lexicon; archetypeExceptions: string[]; networks: Record<string, string[]>; castSlugs: string[] } {
  const CAST = join(root, "cast");
  const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
  const slugs = readdirSync(CAST, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(CAST, d.name, "persona.json")))
    .map((d) => d.name).sort();
  const personas = slugs.map((s) => readJson(`cast/${s}/persona.json`));
  const associates: { name: string }[] = readJson("cast/_shared/associates.json");
  const sheet = readJson("cast/_shared/cast-sheet-v1.snapshot.json");
  const snapshot = readJson("cast/_fixtures/people-snapshot.json");
  const spineScan = existsSync(join(CAST, "_fixtures/spine-scan.json")) ? readJson("cast/_fixtures/spine-scan.json") : null;
  const realOrgs: string[] = (parse(readFileSync(join(CAST, "_shared/real-orgs.yaml"), "utf8")) as { orgs?: string[] }).orgs ?? [];
  const allowDoc = parse(readFileSync(join(CAST, "_shared/audit-allow.yaml"), "utf8")) as Record<string, string[]>;
  const allow = Object.entries(allowDoc).filter(([k]) => !k.startsWith("_")).flatMap(([, v]) => v ?? []);

  const fictionalNames: string[] = [];
  for (const p of personas) {
    fictionalNames.push(p.display_name.replace(/^Dr\.\s+/, "").replace(/\s+\(.*\)$/, ""), p.short_name);
    for (const f of p.family) fictionalNames.push(f.name);
  }
  for (const a of associates) fictionalNames.push(a.name.replace(/^Dr\.\s+/, ""));
  const fictionalTokens = new Set(fictionalNames.flatMap((n) => n.split(/\s+/)).filter((t) => /^[A-Z]/.test(t)));
  const orgs = new Set(realOrgs);
  for (const p of personas) {
    for (const c of p.career) orgs.add(c.employer);
    for (const e of p.education) orgs.add(e.institution);
    for (const o of p.organizations) orgs.add(typeof o === "string" ? o : o.name);
    orgs.add(p.role);
    for (const d of p.idf_domains) orgs.add(d.name);
  }
  const spineNames = [
    ...snapshot.people.map((x: { canonical_name: string }) => x.canonical_name),
    ...((spineScan?.matches ?? []) as { canonical_name: string }[]).map((m) => m.canonical_name),
  ];
  const lexicon: Lexicon = { fictionalNames: [...new Set(fictionalNames)], fictionalTokens, orgs: [...orgs], events: [], allow, archetypes: sheet.archetypes, spineNames: [...new Set(spineNames)] };
  const networks = Object.fromEntries(slugs.map((s, i) => [s, (personas[i].network as { name: string }[]).map((n) => n.name)]));
  return { lexicon, archetypeExceptions: sheet.archetype_exceptions ?? [], networks, castSlugs: slugs };
}

export function auditScript(script: EpisodeScript, ctx: AuditContext, onMic: string[]): PodcastAudit {
  const failures: string[] = [];
  const review = new Set<string>();
  const signalLc = plain(ctx.signalText).toLowerCase();
  // Licensed when the whole phrase, or every one of its words, appears in the signal text ("OpenAI Stargate" for "OpenAI's Stargate").
  const inSignals = (phrase: string) =>
    signalLc.includes(phrase.toLowerCase()) || phrase.split(/\s+/).every((t) => signalLc.includes(t.toLowerCase().replace(/['’]s$/, "")));
  const offMic = OFF_MIC as readonly string[];

  script.segments.forEach((seg, si) => {
    seg.turns.forEach((turn, ti) => {
      const where = `segment ${si + 1} (${seg.kind}) turn ${ti + 1}, ${turn.speaker}`;
      if (!onMic.includes(turn.speaker)) failures.push(`${where}: speaker is not on this episode's cast`);
      if (offMic.includes(turn.speaker)) failures.push(`${where}: ${turn.speaker} is never on-mic in v1`);
      for (const hit of archetypeHits(plain(turn.text), ctx.lexicon.archetypes, ctx.archetypeExceptions)) failures.push(`${where}: archetype reference "${hit}" (TF-DEC-13)`);
      const network = ctx.networks[turn.speaker] ?? [];
      const sentences = turn.text.split(/(?<=[.!?])\s+/);
      for (const phrase of properNouns(turn.text)) {
        const cls = classify(phrase, ctx.lexicon, network);
        if (cls === "SPINE-OUTSIDE-NETWORK") { failures.push(`${where}: "${phrase}" is a real person outside ${turn.speaker}'s network`); continue; }
        if (cls === "FIC" || cls === "REAL-ORG" || cls === "REAL-EVENT" || cls === "ALLOW") continue;
        const relational = sentences.some((s) => s.includes(phrase) && RELATIONAL.test(s));
        if (relational) { failures.push(`${where}: "${phrase}" appears in a friend/mentor/endorser sentence`); continue; }
        if (cls === "VOICE" || inSignals(phrase)) continue;
        const toks = phrase.split(/\s+/);
        if (toks.length >= 2 && toks.length <= 3 && !ORGISH.test(phrase)) review.add(`${phrase} (${where})`);
      }
    });
  });
  return { ok: failures.length === 0, failures, review: [...review].sort() };
}
