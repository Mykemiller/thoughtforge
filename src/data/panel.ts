/**
 * ThoughtForge panel manifest (TH, P-TH-8).
 *
 * Single source of truth for the ten panelists shown on `/` and `/panel`.
 * The cast is fixed at ten (TF-DEC-31): do not add, remove, or rename members.
 * All personas are original (TF-DEC-13); no real person is named anywhere.
 *
 * `heygenGroupId` is the HeyGen avatar-group (identity) id the headshot is
 * pulled from. `chosenLookId` is written back by `npm run panel:sync` so the
 * look choice is reproducible; set `preferredLookId` to override the default
 * selection rule (prefer a look named "v2", else the newest look).
 *
 * Keep each member on ONE line: the sync script writes `chosenLookId` back by
 * locating the line that carries `heygenGroupId: "<id>"`.
 */
export type PanelMember = {
  slug: string;
  name: string;
  role: string;
  specialty: string;
  bio: string; // 2–3 sentences, boardroom-interview register
  order: number; // 1–10, display order
  heygenGroupId: string;
  preferredLookId?: string; // optional override; sync fills chosenLookId
  chosenLookId?: string;
  image: string; // "/panel/<slug>.webp"
  thumb: string; // "/panel/<slug>-thumb.webp"
};

// prettier-ignore
export const PANEL: PanelMember[] = [
  { order: 1,  slug: "gilbert-faraday",   name: "Gilbert Faraday",      role: "Chief of Staff",     specialty: "Rulings, synthesis, final call",                                   heygenGroupId: "aadfa9fef6faa4547f531565fe79cec6", image: "/panel/gilbert-faraday.webp",   thumb: "/panel/gilbert-faraday-thumb.webp",   bio: "Chairs the panel. Asks one question, lets the panel argue, then rules, and always states what evidence would change his mind. Speaks last." },
  { order: 2,  slug: "margo-brandt",      name: "Margo Brandt",         role: "First Officer",      specialty: "Construction, development, execution sequencing",                 heygenGroupId: "bf3127845753467f8a6b8a68d450176c", image: "/panel/margo-brandt.webp",      thumb: "/panel/margo-brandt-thumb.webp",      bio: "Deputy Chief of Staff. Turns every ruling into a sequence with owners and dates, and checks lead times before anyone falls in love with a design." },
  // Group id in the task brief (a44d6c946693518f3c1a54f154cd66db) returns 404 in HeyGen; this is the only Eigen group in the account. Confirm before design lock.
  { order: 3,  slug: "mach-eigen",        name: "Mach Eigen",           role: "Chief Engineer",     specialty: "Power architecture: 800 VDC, BESS, SMR, construction engineering", heygenGroupId: "b62c9bacbb686ca245ae54f45c3297b0", image: "/panel/mach-eigen.webp",        thumb: "/panel/mach-eigen-thumb.webp",        bio: "Works from first principles. Numbers before adjectives. If a design is physically wrong, he says so, to anyone, including the vendor." },
  { order: 4,  slug: "delia-marchetti",   name: "Delia Marchetti",      role: "Press Lead",         specialty: "Markets, media, public framing",                                   heygenGroupId: "30b40d70f6277d73d7dcdbb239abf8a1", image: "/panel/delia-marchetti.webp",   thumb: "/panel/delia-marchetti-thumb.webp",   bio: "Translates the engineering answer into two sentences a county commissioner understands, and flags the line that ends up on page one before it does." },
  { order: 5,  slug: "albert-thorne",     name: "Albert Thorne",        role: "Policy",             specialty: "Grid policy, interconnection, FERC, ISOs, PUCs",                   heygenGroupId: "286965e14cca575302d4329251c4add9", image: "/panel/albert-thorne.webp",     thumb: "/panel/albert-thorne-thumb.webp",     bio: "Distinguishes what the rule says from how the system actually behaves. Plans for the real timeline, cites the docket and the tariff section, and is rarely surprised." },
  { order: 6,  slug: "hartford-caldwell", name: "Hartford Caldwell",    role: "Counsel",            specialty: "Permitting, tax, incentives, legal exposure",                      heygenGroupId: "5b692f61059c3908ba5b09ad8664b7d9", image: "/panel/hartford-caldwell.webp", thumb: "/panel/hartford-caldwell-thumb.webp", bio: "Opens with the exposure and closes with the mitigation. One of two panelists who can stop a recommendation, used only for harm that is hard to undo." },
  { order: 7,  slug: "rosalind-ferraro",  name: "Rosalind Ferraro",     role: "Political Director", specialty: "Community, opposition, local politics of every site",             heygenGroupId: "1c0e74252525959f5bb07e9cc1fae18f", image: "/panel/rosalind-ferraro.webp",  thumb: "/panel/rosalind-ferraro-thumb.webp",  bio: "Knows who is in the room at the zoning hearing and why. Names the community cost before anyone else does, so the panel gets ahead of it." },
  { order: 8,  slug: "victoria-stroud",   name: "Victoria Stroud",      role: "Economic Advisor",   specialty: "Capital markets, deal structure, cost of capital",                 heygenGroupId: "02ca05b2722ce9e52dfda7a38469d42e", image: "/panel/victoria-stroud.webp",   thumb: "/panel/victoria-stroud-thumb.webp",   bio: "Translates every technical choice into basis points and exit value. Not moved by narrative; moved by what clears a credit committee." },
  { order: 9,  slug: "ingrid-halverson",  name: "Dr. Ingrid Halverson", role: "Science Advisor",    specialty: "Thermal management, cooling, heat flux, chip density",             heygenGroupId: "61620f8465927c9b9608460439a65f4f", image: "/panel/ingrid-halverson.webp",  thumb: "/panel/ingrid-halverson-thumb.webp",  bio: "Starts from the heat and works outward. Liquid-to-chip is solved; the facility loop at that delta-T is where projects quietly fail. Units matter." },
  { order: 10, slug: "constance-wright",  name: "Constance Wright",     role: "Fact-Checker",       specialty: "Evidence grading, source verification",                            heygenGroupId: "502b732db4a7f1f7eafca2f7d1ac6efe", image: "/panel/constance-wright.webp",  thumb: "/panel/constance-wright-thumb.webp",  bio: "Grades every claim on a four-tier ladder: verified, sourced, estimated, inferred. Says 'unsourced' out loud. Cite it or strike it." },
];

/** Members sorted by display order. */
export const PANEL_SORTED: PanelMember[] = [...PANEL].sort((a, b) => a.order - b.order);

/** Alt text rule (TF-DEC-13 / Step 5): "<Name>, <Role>". */
export function panelAlt(m: PanelMember): string {
  return `${m.name}, ${m.role}`;
}
