/**
 * On-mic roster (TH-37, PP-03; rule from TH-35). Three people: a chair and two domain voices.
 *
 *  - chair = gilbert-faraday, unless he is one of the domain voices, then margo-brandt;
 *  - voices are mapped from the selected signals' IDF domains (map below);
 *  - when a domain has several candidates, the one least recently on-mic wins (history = tf_episodes),
 *    never-on-mic first, then slug order, so the result is deterministic;
 *  - constance-wright and delia-marchetti are never on-mic in v1.
 *
 * The map names hartford-nakamura where the issue text says hartford-caldwell: TF-DEC-92 renamed the panelist
 * (cast/hartford-nakamura, src/ask/roster.ts). D10 and D14 are the chair's own domains and have no voice entry.
 */
export const OFF_MIC = ["constance-wright", "delia-marchetti"] as const;
export const DEFAULT_CHAIR = "gilbert-faraday";
export const FALLBACK_CHAIR = "margo-brandt";

export const DOMAIN_VOICES: Record<string, string[]> = {
  D1: ["ingrid-halverson"],
  D2: ["mach-eigen", "albert-thorne"],
  D3: ["mach-eigen", "albert-thorne"],
  D4: ["victoria-stroud"],
  D7: ["ingrid-halverson"],
  D13: ["hartford-nakamura", "rosalind-ferraro"],
  D18: ["hartford-nakamura", "rosalind-ferraro"],
  D19: ["hartford-nakamura"],
};
/** Fill order when the signals name fewer than two mappable voices; still ranked by least recent. */
export const FILL_POOL = ["mach-eigen", "albert-thorne", "ingrid-halverson", "hartford-nakamura", "rosalind-ferraro", "victoria-stroud"];

export interface CastSlot {
  slug: string;
  role: "chair" | "voice";
}
export interface EpisodeHistory {
  /** ISO date or timestamp of the episode (digest_date or created_at). */
  when: string;
  cast: { slug: string }[];
}
export interface CastSelection {
  cast: CastSlot[];
  rationale: string[];
}

export const chairFor = (voices: string[]): string => (voices.includes(DEFAULT_CHAIR) ? FALLBACK_CHAIR : DEFAULT_CHAIR);

/** slug to the latest `when` it was on-mic; absent = never. */
export function lastOnMic(history: EpisodeHistory[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of history) for (const c of e.cast) if (!m.has(c.slug) || e.when > (m.get(c.slug) as string)) m.set(c.slug, e.when);
  return m;
}

/** Least recently on-mic first; never-on-mic before any date; slug order breaks ties. */
function leastRecent(candidates: string[], last: Map<string, string>): string {
  return [...candidates].sort((a, b) => {
    const la = last.get(a) ?? "", lb = last.get(b) ?? "";
    if (la !== lb) return la < lb ? -1 : 1;
    return a < b ? -1 : 1;
  })[0];
}

export function selectCast(domainCodesInRankOrder: (string | null)[], history: EpisodeHistory[] = []): CastSelection {
  const last = lastOnMic(history);
  const voices: string[] = [];
  const rationale: string[] = [];
  const why = (slug: string) => (last.has(slug) ? `last on-mic ${last.get(slug)}` : "never on-mic");
  for (const code of domainCodesInRankOrder) {
    if (voices.length === 2) break;
    if (!code) continue;
    const cands = (DOMAIN_VOICES[code] ?? []).filter((s) => !voices.includes(s) && !(OFF_MIC as readonly string[]).includes(s));
    if (!cands.length) {
      rationale.push(`${code}: no on-mic voice mapped${DOMAIN_VOICES[code] ? " (candidates already seated)" : " (chair covers it or the persona is off-mic)"}`);
      continue;
    }
    const pick = leastRecent(cands, last);
    voices.push(pick);
    rationale.push(`${code} -> ${pick} (${cands.length > 1 ? `of ${cands.join(", ")}; least recent: ${why(pick)}` : "only candidate"})`);
  }
  while (voices.length < 2) {
    const pick = leastRecent(FILL_POOL.filter((s) => !voices.includes(s)), last);
    voices.push(pick);
    rationale.push(`fill -> ${pick} (signals named fewer than two mappable voices; least recent: ${why(pick)})`);
  }
  const chair = chairFor(voices);
  rationale.push(`chair = ${chair}${chair === FALLBACK_CHAIR ? " (gilbert-faraday is a domain voice)" : ""}`);
  return { cast: [{ slug: chair, role: "chair" }, ...voices.map((slug): CastSlot => ({ slug, role: "voice" }))], rationale };
}

/** --cast chair,voice,voice. Validates; never accepts off-mic personas, duplicates or the wrong count. */
export function parseCastOverride(arg: string, knownSlugs: string[]): CastSelection {
  const slugs = arg.split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length !== 3) throw new Error(`--cast needs exactly three slugs: chair,voice,voice (got ${slugs.length})`);
  if (new Set(slugs).size !== 3) throw new Error("--cast slugs must be distinct");
  for (const s of slugs) {
    if (!knownSlugs.includes(s)) throw new Error(`--cast: unknown cast slug "${s}"`);
    if ((OFF_MIC as readonly string[]).includes(s)) throw new Error(`--cast: ${s} is never on-mic in v1`);
  }
  const [chair, ...voices] = slugs;
  if (voices.includes(DEFAULT_CHAIR) && chair !== FALLBACK_CHAIR) throw new Error(`--cast: ${DEFAULT_CHAIR} is a voice, so ${FALLBACK_CHAIR} must chair`);
  return { cast: [{ slug: chair, role: "chair" }, ...voices.map((slug): CastSlot => ({ slug, role: "voice" }))], rationale: [`cast overridden by --cast ${slugs.join(",")}`] };
}
