/**
 * Signal selector (TH-37, PP-03). Deterministic: the same digest rows always give the same three signals.
 *
 * Rank: confidence (CF5..CF0) desc, then membership in the panel's initial-focus domains, then recency, then
 * digest position, then id. Anything labelled or worded as a projection, forecast or estimate is held below SRC
 * (CF3) per IDF R5, so a projection can never outrank a sourced item.
 *
 * The PP-02 digest carries no per-signal confidence or published date (docs/podcast/digest-ingest.md), so:
 *  - an unlabelled signal with a source link is CF3 (sourced to a named publication), without a link CF1;
 *  - recency falls back to digest position (earlier in the email = earlier rank).
 * Both fallbacks are written into the rationale so the choice is visible in tf_episodes.signals.
 */
export interface DigestSignalRow {
  id: string;
  position: number | null;
  title: string;
  summary: string | null;
  source_url: string | null;
  publisher: string | null;
  published_at: string | null;
  idf_domain: string | null;
  idf_subdomain?: string | null;
  confidence: string | null;
  signal_type?: string | null;
}

export const FOCUS_DOMAINS = ["D2", "D3", "D7", "D10", "D14"] as const;
export const SELECT_COUNT = 3;
/** Evidence-ladder floor: CF3 = SRC. Below this is "not sourced". */
export const SRC_LEVEL = 3;

/** IDF domain names as the digest prints section headings (the idf_domains in each cast persona.json). */
export const DOMAIN_NAMES: Record<string, string> = {
  D1: "Chips & Density",
  D2: "Power Architecture",
  D3: "Grid & Regulatory",
  D4: "M&A & Capital Markets",
  D5: "Hyperscaler Activity",
  D7: "Cooling & Water Technology",
  D10: "Construction",
  D13: "Community Relations",
  D14: "Real Estate & Site Selection",
  D18: "Community Opposition & Regulatory Risk",
  D19: "Tax, Incentives & Fiscal Policy",
  D22: "Industry Media & Analyst Coverage",
};
const norm = (s: string) => s.toLowerCase().replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const NAME_TO_CODE = new Map(Object.entries(DOMAIN_NAMES).map(([c, n]) => [norm(n), c]));

/** "D2.3" or "D2" or a section heading to the domain code; null when the heading is not in the registry. */
export function domainCode(idfDomain: string | null | undefined): string | null {
  if (!idfDomain) return null;
  const code = idfDomain.trim().match(/^D(\d{1,2})(?:\.\d+)?\b/i);
  if (code) return `D${Number(code[1])}`;
  return NAME_TO_CODE.get(norm(idfDomain)) ?? null;
}

const LABELS: [RegExp, number][] = [
  [/^cf\s*([0-5])$/i, -1], // handled below: the digit is the level
  [/\b(?:vrf|verified|confirmed)\b/i, 5],
  [/\b(?:corroborated|high)\b/i, 4],
  [/\b(?:src|sourced|medium)\b/i, 3],
  [/\b(?:inf|inferred|low)\b/i, 2],
  [/\b(?:est|estimated|estimate)\b/i, 1],
  [/\b(?:unverified|unknown|rumou?r|none)\b/i, 0],
];
const PROJECTION = /\b(?:projections?|projected|forecasts?|forecasted|estimat(?:e|es|ed)|expected (?:to|in|by)|anticipated|predicted|is set to)\b/i;

export interface Graded {
  cf: number;
  basis: string;
  projection: boolean;
}

export function gradeSignal(s: DigestSignalRow): Graded {
  const label = (s.confidence ?? "").trim();
  let cf: number | null = null;
  let basis = "";
  if (label) {
    const m = label.match(/^cf\s*([0-5])$/i);
    if (m) cf = Number(m[1]);
    else for (const [re, level] of LABELS) if (level >= 0 && re.test(label)) { cf = level; break; }
    if (cf !== null) basis = `digest label "${label}"`;
  }
  if (cf === null) {
    cf = s.source_url ? 3 : 1;
    basis = s.source_url ? "digest carries no confidence label; sourced to a named publisher, so CF3" : "digest carries no confidence label and no source link, so CF1";
  }
  const text = `${s.confidence ?? ""} ${s.signal_type ?? ""} ${s.title} ${s.summary ?? ""}`;
  const projection = PROJECTION.test(text);
  if (projection && cf >= SRC_LEVEL) {
    cf = SRC_LEVEL - 1;
    basis += "; projection/forecast/estimate wording holds it below SRC (IDF R5), so CF2";
  }
  return { cf, basis, projection };
}

export interface SelectedSignal {
  rank: number;
  signal_id: string;
  position: number | null;
  title: string;
  summary: string | null;
  source_url: string | null;
  publisher: string | null;
  idf_domain: string | null;
  idf_domain_code: string | null;
  confidence_label: string | null;
  confidence: string; // "CF3"
  in_focus_domain: boolean;
  rationale: string;
}

export interface SelectionResult {
  selected: SelectedSignal[];
  considered: number;
  rule: string;
}

const RULE =
  "rank by confidence CF5..CF0 (projections held below SRC=CF3), then initial-focus domains {D2,D3,D7,D10,D14}, then recency (published_at, else digest position), then id";

export function selectSignals(rows: DigestSignalRow[], count = SELECT_COUNT): SelectionResult {
  const scored = rows.map((r) => {
    const g = gradeSignal(r);
    const code = domainCode(r.idf_domain);
    return { r, g, code, focus: code !== null && (FOCUS_DOMAINS as readonly string[]).includes(code) };
  });
  const when = (iso: string | null) => (iso ? Date.parse(iso) : NaN);
  scored.sort((a, b) => {
    if (b.g.cf !== a.g.cf) return b.g.cf - a.g.cf;
    if (a.focus !== b.focus) return a.focus ? -1 : 1;
    const ta = when(a.r.published_at), tb = when(b.r.published_at);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta;
    if (!Number.isNaN(ta) !== !Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1;
    const pa = a.r.position ?? Number.MAX_SAFE_INTEGER, pb = b.r.position ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0;
  });
  const selected = scored.slice(0, count).map((x, i): SelectedSignal => ({
    rank: i + 1,
    signal_id: x.r.id,
    position: x.r.position,
    title: x.r.title,
    summary: x.r.summary,
    source_url: x.r.source_url,
    publisher: x.r.publisher,
    idf_domain: x.r.idf_domain,
    idf_domain_code: x.code,
    confidence_label: x.r.confidence,
    confidence: `CF${x.g.cf}`,
    in_focus_domain: x.focus,
    rationale: `CF${x.g.cf}: ${x.g.basis}; ${x.focus ? "initial-focus domain" : x.code ? `domain ${x.code} is outside the initial focus set` : "domain not in the IDF registry"}.`,
  }));
  return { selected, considered: rows.length, rule: RULE };
}
