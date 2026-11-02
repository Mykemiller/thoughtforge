// Cast QA gate audit (Linear TH-30). Runs checks 1 to 6 and writes docs/cast-audit-<YYYYMMDD>.md.
//
//   npm run audit:cast                 write the report, exit 1 on any FAIL
//   npm run audit:cast -- --stdout     print the report instead of writing it
//
// Offline and read-only: people data comes from cast/_fixtures/people-snapshot.json and
// cast/_fixtures/spine-scan.json, both taken through the Supabase connector. Myke's sign-off
// on the gate is separate and stays his (TH-30).

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import {
  properNouns, classify, archetypeHits, estimateTokens, yearSpan, within, section, plain,
  type Lexicon, type NameClass,
} from "./lib/audit-core.ts";
import { resolveDraft, snapshotSource, KINDS, type Draft } from "./lib/network-core.ts";

const ROOT = resolve(import.meta.dirname, "..");
const CAST = join(ROOT, "cast");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const json = (p: string) => JSON.parse(read(p));

type Status = "PASS" | "FAIL" | "WARN";
interface Result { id: number; name: string; status: Status; summary: string; exceptions: string[] }

const slugs = readdirSync(CAST, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(CAST, d.name, "persona.json")))
  .map((d) => d.name).sort();
const personas = new Map(slugs.map((s) => [s, json(`cast/${s}/persona.json`)]));
const associates: { id: string; name: string }[] = json("cast/_shared/associates.json");
const relationships: { id: string; participants: string[]; where: string; years: string }[] = json("cast/_shared/relationships.json");
const sheet = json("cast/_shared/cast-sheet-v1.snapshot.json");
const snapshot = json("cast/_fixtures/people-snapshot.json");
const spineScan = existsSync(join(CAST, "_fixtures/spine-scan.json")) ? json("cast/_fixtures/spine-scan.json") : null;
const realOrgs: string[] = (parse(read("cast/_shared/real-orgs.yaml")) as { orgs: string[] }).orgs ?? [];
const allowDoc = parse(read("cast/_shared/audit-allow.yaml")) as Record<string, string[]>;
const allow = Object.entries(allowDoc).filter(([k]) => !k.startsWith("_")).flatMap(([, v]) => v ?? []);
const waivers = existsSync(join(CAST, "_shared/network-waivers.yaml")) ? ((parse(read("cast/_shared/network-waivers.yaml")) as { waived?: string[] })?.waived ?? []) : [];

const skillFiles = (slug: string) =>
  readdirSync(join(CAST, slug, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `cast/${slug}/skills/${d.name}/SKILL.md`);
const sharedSkillFiles = readdirSync(join(CAST, "_shared/skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `cast/_shared/skills/${d.name}/SKILL.md`);

// ---------- UI copy in scope (TH-32) ----------
const UI_COPY_ROOTS = ["app", "src/components", "src/cast/prompt.ts", "src/ask/orchestrate.ts", "src/ask/render.ts"];
function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(`${dir}/${d.name}`) : /\.(tsx?|ts)$/.test(d.name) && !d.name.endsWith(".test.ts") ? [`${dir}/${d.name}`] : []);
}
function uiCopyFiles(): string[] {
  return UI_COPY_ROOTS.flatMap((r) => (existsSync(join(ROOT, r)) && !/\.tsx?$/.test(r) ? walk(r) : existsSync(join(ROOT, r)) ? [r] : [])).sort();
}
/**
 * Pull the prose out of a TS/TSX file: string and template literals, plus JSX text nodes in .tsx.
 * Code stays out: identifiers, class names and all-caps labels (THE PANEL, TF_ACCESS_KEY) are not copy.
 */
function uiCopyText(src: string, isTsx: boolean): string {
  const out: string[] = [];
  const clean = (t: string) =>
    t.replace(/\\n/g, "\n").replace(/^\s*#+\s*/gm, "").replace(/\$\{[^}]*\}/g, " ").replace(/\b[A-Z][A-Z0-9_]+\b/g, " ");
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    const lit = m[1] ?? m[2] ?? m[3] ?? "";
    if (/\s/.test(lit.trim()) && !/^[a-z0-9\-:\/\[\]().%#@_,\s]+$/.test(lit) && !/^\.?\.?\//.test(lit)) out.push(clean(lit));
  }
  if (isTsx) for (const m of src.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) if (/\s/.test(m[1].trim()) && !/[;=()]/.test(m[1])) out.push(clean(m[1]));
  return out.join("\n");
}

// ---------- lexicon ----------
const fictionalNames: string[] = [];
for (const p of personas.values()) {
  fictionalNames.push(p.display_name.replace(/^Dr\.\s+/, "").replace(/\s+\(.*\)$/, ""), p.short_name);
  for (const f of p.family) fictionalNames.push(f.name);
  for (const pub of p.publications ?? []) fictionalNames.push(String(pub.title ?? "").replace(/[?"“”]/g, ""));
}
for (const a of associates) fictionalNames.push(a.name.replace(/^Dr\.\s+/, ""));
const fictionalTokens = new Set(fictionalNames.flatMap((n) => n.split(/\s+/)).filter((t) => /^[A-Z]/.test(t)));
const orgs = new Set(realOrgs);
const events: string[] = [];
for (const p of personas.values()) {
  for (const c of p.career) orgs.add(c.employer);
  for (const e of p.education) orgs.add(e.institution);
  for (const o of p.organizations) orgs.add(typeof o === "string" ? o : o.name);
  for (const m of p.moments) events.push(m.event, m.venue);
  // Titles, degrees and domain labels are vocabulary, not names.
  orgs.add(p.role); for (const d of p.idf_domains) orgs.add(d.name);
  if (p.domains_as_written) orgs.add(p.domains_as_written);
  for (const c of p.career) orgs.add(c.title);
  for (const e of p.education) orgs.add(`${e.degree} ${e.field ?? ""}`.trim());
}
const spineNames = [
  ...snapshot.people.map((x: { canonical_name: string }) => x.canonical_name),
  ...((spineScan?.matches ?? []) as { canonical_name: string }[]).map((m) => m.canonical_name),
];
const lex: Lexicon = {
  fictionalNames: [...new Set(fictionalNames)], fictionalTokens, orgs: [...orgs], events, allow,
  archetypes: sheet.archetypes, spineNames: [...new Set(spineNames)],
};
const networkNames = (slug: string) => (personas.get(slug).network as { name: string }[]).map((n) => n.name);

const results: Result[] = [];

// ---------- 1. Real-name audit ----------
{
  const exceptions: string[] = [];
  const review: string[] = [];
  const counts: Record<NameClass, number> = { FIC: 0, "REAL-ORG": 0, "REAL-EVENT": 0, VOICE: 0, ALLOW: 0, "SPINE-OUTSIDE-NETWORK": 0, ARCHETYPE: 0, UNCLASSIFIED: 0 };
  const allCandidates = new Set<string>();
  const scan = (file: string, text: string, network: string[], userFacingNoVoice: boolean) => {
    for (const hit of archetypeHits(plain(text), sheet.archetypes, sheet.archetype_exceptions)) exceptions.push(`${file}: archetype reference "${hit}" (TF-DEC-13)`);
    for (const phrase of properNouns(text)) {
      allCandidates.add(phrase);
      const c = classify(phrase, lex, network);
      counts[c]++;
      if (c === "ARCHETYPE") continue; // already reported above
      if (c === "SPINE-OUTSIDE-NETWORK") exceptions.push(`${file}: "${phrase}" is a real person in the people spine but not in this panelist's network`);
      else if (c === "VOICE" && userFacingNoVoice) exceptions.push(`${file}: real person "${phrase}" appears in voice or skill text (TF-DEC-13)`);
      else if (c === "UNCLASSIFIED") review.push(`${file}: ${phrase}`);
    }
  };
  for (const slug of slugs) {
    const net = networkNames(slug);
    scan(`cast/${slug}/dossier.md`, read(`cast/${slug}/dossier.md`), net, false);
    scan(`cast/${slug}/linkedin.md`, read(`cast/${slug}/linkedin.md`), net, false);
    scan(`cast/${slug}/persona.json voice_brief`, `${personas.get(slug).voice_brief}\n${personas.get(slug).sample_line ?? ""}`, [], true);
    for (const f of skillFiles(slug)) scan(f, read(f), [], true);
  }
  for (const f of sharedSkillFiles) scan(f, read(f), [], true);
  // TH-32: the app's own user-facing copy and prompt text are in scope too (string literals and
  // JSX text only; identifiers are code, not copy). No Voice is allowed there (TF-DEC-13).
  for (const f of uiCopyFiles()) scan(f, uiCopyText(read(f), f.endsWith(".tsx")), [], true);

  const candidates = [...allCandidates].sort();
  const sha = createHash("sha256").update(candidates.join("\n")).digest("hex");
  writeFileSync(join(CAST, "_fixtures/spine-candidates.txt"), candidates.join("\n") + "\n");
  let scanNote = "";
  if (!spineScan) scanNote = "No spine scan on file: run the spine scan through the Supabase connector (see docs/cast-audit-howto.md).";
  else if (spineScan.candidates_sha256 !== sha) scanNote = `Spine scan is stale (taken ${spineScan.taken_at} over a different candidate list); rerun it before sign-off.`;
  else scanNote = `Spine scan ${spineScan.taken_at} over this candidate list against all ${spineScan.people_total} people: ${spineScan.matches.length} full-name matches, each checked above against the panelist's network. ${spineScan.coverage_note ?? ""}`;

  const status: Status = exceptions.length ? "FAIL" : review.length || !spineScan || spineScan.candidates_sha256 !== sha ? "WARN" : "PASS";
  results.push({
    id: 1, name: "Real-name audit", status,
    summary: `${candidates.length} distinct proper nouns. Classified per file: FIC ${counts.FIC}, REAL-ORG ${counts["REAL-ORG"]}, REAL-EVENT ${counts["REAL-EVENT"]}, VOICE ${counts.VOICE}, reviewed non-person ${counts.ALLOW}, unclassified ${counts.UNCLASSIFIED}. ${scanNote}`,
    exceptions: [...exceptions, ...review.map((r) => `review: ${r}`)],
  });
}

// ---------- 2. Network provenance ----------
{
  const exceptions: string[] = [];
  let total = 0;
  for (const slug of slugs) {
    const p = personas.get(slug);
    const draft = parse(read(`cast/${slug}/network.draft.yaml`)) as Draft;
    const res = await resolveDraft(draft, snapshotSource(snapshot));
    for (const u of res.unresolved) if (!waivers.includes(`${slug}:${u.name}`)) exceptions.push(`${slug}: ${u.name} unresolved (${u.reason})`);
    const ids = new Map(res.resolved.map((r) => [r.person_id, r]));
    for (const n of p.network) {
      total++;
      if (!ids.has(n.person_id)) exceptions.push(`${slug}: ${n.name} in persona.json does not resolve to its person_id`);
      if (!(KINDS as readonly string[]).includes(n.relationship_kind)) exceptions.push(`${slug}: ${n.name} has relationship_kind ${n.relationship_kind}`);
      if (!n.venue) exceptions.push(`${slug}: ${n.name} has no venue`);
      if (!(n.since < 2025)) exceptions.push(`${slug}: ${n.name} since ${n.since} is not before 2025`);
    }
    if (existsSync(join(CAST, slug, "network.unresolved.yaml"))) exceptions.push(`${slug}: network.unresolved.yaml is present`);
  }
  results.push({
    id: 2, name: "Network provenance", status: exceptions.length ? "FAIL" : "PASS",
    summary: `${total} network entries across ${slugs.length} panelists resolved against ${snapshot.project_ref} (snapshot ${snapshot.taken_at}, Myke's ruling 2026-11-01). Waivers on file: ${waivers.length}.`,
    exceptions,
  });
}

// ---------- 3. Cross-dossier consistency ----------
{
  const exceptions: string[] = [];
  const base = (e: string) => e.replace(/\s*\(.*\)$/, "").replace(/,? (Inc\.|LLC|Co\.|AG|plc)$/, "").trim();
  for (const r of relationships) {
    const span = yearSpan(r.years);
    if (!span) { exceptions.push(`${r.id}: unreadable years "${r.years}"`); continue; }
    for (const slug of r.participants) {
      const p = personas.get(slug);
      if (!p) { exceptions.push(`${r.id}: unknown participant ${slug}`); continue; }
      if (!p.relationships.includes(r.id)) exceptions.push(`${r.id}: missing from ${slug} persona.json relationships`);
      const shared = section(read(`cast/${slug}/dossier.md`), "Shared history");
      const line = shared.split("\n").find((l) => l.startsWith(`- ${r.id},`));
      if (!line) exceptions.push(`${r.id}: missing from ${slug} dossier Shared history`);
      else if (!line.includes(r.years)) exceptions.push(`${r.id}: ${slug} dossier gives different years from relationships.json (${r.years})`);
      const atFirm = p.career.filter((c: { employer: string }) => r.where.includes(base(c.employer)) && base(c.employer).length > 2 && !/ThoughtForge/.test(c.employer));
      if (atFirm.length) {
        if (!atFirm.some((c: { start: number; end: number | null }) => within(span, c.start, c.end)))
          exceptions.push(`${r.id}: ${slug} was not at ${base(atFirm[0].employer)} in ${r.years} (career ${atFirm.map((c: { start: number; end: number | null }) => `${c.start}-${c.end ?? "now"}`).join(", ")})`);
      } else if (!p.career.some((c: { start: number; end: number | null }) => span[0] >= c.start && span[0] <= (c.end ?? 9999))) {
        exceptions.push(`${r.id}: ${slug} has no career entry covering ${r.years}`);
      }
    }
  }
  // Same firm, overlapping years, with no relationship that joins the two at that firm.
  const list = [...personas.values()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    for (const a of list[i].career) for (const b of list[j].career) {
      if (/ThoughtForge/.test(a.employer) || base(a.employer) !== base(b.employer)) continue;
      const overlap = a.start <= (b.end ?? 9999) && b.start <= (a.end ?? 9999);
      if (!overlap) continue;
      const joined = relationships.some((r) => r.participants.includes(list[i].slug) && r.participants.includes(list[j].slug) && r.where.includes(base(a.employer)));
      if (!joined) exceptions.push(`${list[i].slug} and ${list[j].slug} overlap at ${base(a.employer)} with no relationship joining them there`);
      else if (lcEq(a.title, b.title)) exceptions.push(`${list[i].slug} and ${list[j].slug} hold the same title at ${base(a.employer)} in overlapping years`);
    }
  }
  results.push({ id: 3, name: "Cross-dossier consistency", status: exceptions.length ? "FAIL" : "PASS", summary: `${relationships.length} relationships checked against both participants' dossiers, persona.json and career dates; employer overlaps checked across all pairs.`, exceptions });
}
function lcEq(a: string, b: string) { return a.trim().toLowerCase() === b.trim().toLowerCase(); }

// ---------- 4. Register check ----------
{
  const exceptions: string[] = [];
  const reg = sheet.register;
  const women: string[] = [];
  const he = /\b(he|him|his)\b/gi, she = /\b(she|her|hers)\b/gi;
  for (const slug of slugs) {
    const p = personas.get(slug);
    if (p.voice_brief !== sheet.voice_briefs[slug]) exceptions.push(`${slug}: voice_brief differs from the Cast Sheet v1 text`);
    const back = section(read(`cast/${slug}/dossier.md`), "Backstory");
    const nShe = back.match(she)?.length ?? 0, nHe = back.match(he)?.length ?? 0;
    if (nShe > nHe) {
      women.push(slug);
      const years = new Date().getFullYear() - Math.min(...p.career.map((c: { start: number }) => c.start));
      if (p.born_year > reg.senior_born_on_or_before) exceptions.push(`${slug}: born ${p.born_year}, after ${reg.senior_born_on_or_before}`);
      if (years < reg.senior_min_career_years) exceptions.push(`${slug}: ${years} years of career, under ${reg.senior_min_career_years}`);
    }
  }
  if (women.length < reg.women_minimum) exceptions.push(`${women.length} women on the panel, under ${reg.women_minimum}`);
  results.push({ id: 4, name: "Register check", status: exceptions.length ? "FAIL" : "PASS", summary: `${women.length} of ${slugs.length} panelists are women (${women.join(", ")}), each born ${reg.senior_born_on_or_before} or earlier with ${reg.senior_min_career_years}+ years of career. All ${slugs.length} voice briefs match Cast Sheet v1 word for word. Register is a heuristic; the read is Myke's.`, exceptions });
}

// ---------- 5. Prompt budget ----------
{
  const exceptions: string[] = [];
  const LIMIT = 6000;
  const rows: string[] = [];
  const shared = sharedSkillFiles.map(read).join("\n\n");
  for (const slug of slugs) {
    const p = personas.get(slug);
    const dossier = read(`cast/${slug}/dossier.md`);
    const composed = [
      `You are ${p.display_name}, ${p.role} on the ThoughtForge panel.`,
      `Domains: ${p.idf_domains.map((d: { code: string; name: string }) => `${d.code} ${d.name}`).join(", ")}`,
      `Voice: ${p.voice_brief}`, `Sample: ${p.sample_line ?? ""}`,
      section(dossier, "Backstory"), section(dossier, "Life outside work"),
      ...skillFiles(slug).map(read), shared,
    ].join("\n\n");
    const t = estimateTokens(composed);
    rows.push(`${slug} ${t}`);
    if (t > LIMIT) exceptions.push(`${slug}: about ${t} tokens, over ${LIMIT}`);
  }
  results.push({ id: 5, name: "Prompt budget", status: exceptions.length ? "FAIL" : "PASS", summary: `Provisional composition until the cast loader (TH-27) fixes it: role and domains, voice brief and sample, Backstory and Life outside work, the panelist's three skills and the three shared skills. Estimated at 3.5 characters per token. Per panelist: ${rows.join(", ")}. Limit ${LIMIT}.`, exceptions });
}

// ---------- 6. Evidence tags ----------
{
  const exceptions: string[] = [];
  const FACT_SECTIONS = ["Identity", "Life outside work", "Real-world moments", "Family", "Academics", "Career", "Licenses", "Associates", "Shared history", "Professional organizations", "Organizations", "Publications"];
  const TAG = /\[(FIC|REAL-ORG|REAL-EVENT|VOICE)[^\]]*\]/;
  let lines = 0, bioEntries = 0;
  for (const slug of slugs) {
    const p = personas.get(slug);
    const dossier = read(`cast/${slug}/dossier.md`);
    for (const h of FACT_SECTIONS) {
      for (const l of section(dossier, h).split("\n").filter((x) => /^- /.test(x))) {
        lines++;
        if (!TAG.test(l)) exceptions.push(`${slug} dossier ${h}: untagged line "${l.slice(0, 80)}"`);
      }
    }
    const back = section(dossier, "Backstory");
    if (back && !TAG.test(back)) exceptions.push(`${slug} dossier Backstory: no evidence tag`);
    // linkedin.md carries no tags by design (in-app copy); each entry must trace to a tagged persona.json fact.
    const bio = read(`cast/${slug}/linkedin.md`);
    for (const m of section(bio, "Experience").matchAll(/^- \*\*(.+?)\*\*, (.+?) · (\d{4})-(\d{4}|present)/gm)) {
      bioEntries++;
      const [, title, employer, start] = m;
      if (!p.career.some((c: { title: string; employer: string; start: number; evidence: string }) => c.employer === employer && c.start === Number(start) && c.title === title && c.evidence))
        exceptions.push(`${slug} linkedin Experience: "${title}, ${employer}, ${start}" has no matching tagged career entry`);
    }
    for (const m of section(bio, "Education").matchAll(/^- (.+), (\d{4})$/gm)) {
      bioEntries++;
      if (!p.education.some((e: { institution: string; year: number; evidence: string }) => m[1].startsWith(`${e.institution}, `) && e.year === Number(m[2]) && e.evidence))
        exceptions.push(`${slug} linkedin Education: "${m[1]}, ${m[2]}" has no matching tagged education entry`);
    }
  }
  results.push({ id: 6, name: "Evidence tags", status: exceptions.length ? "FAIL" : "PASS", summary: `${lines} dossier fact lines checked for FIC, REAL-ORG, REAL-EVENT or VOICE. ${bioEntries} bio Experience and Education entries traced to tagged persona.json facts (the in-app bio carries no inline tags).`, exceptions });
}

// ---------- report ----------
const now = new Date();
const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
const ct = now.toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });
const overall: Status = results.some((r) => r.status === "FAIL") ? "FAIL" : results.some((r) => r.status === "WARN") ? "WARN" : "PASS";
const md = [
  `# Cast audit ${now.toISOString().slice(0, 10)}`,
  "",
  `Generated ${ct} CT by \`npm run audit:cast\` (Linear TH-30). Overall: **${overall}**. This report is input to Myke's sign-off, which stays his; nothing from the cast reaches production, ElevenLabs or HeyGen until he signs.`,
  "",
  "| # | Check | Result |",
  "| --- | --- | --- |",
  ...results.map((r) => `| ${r.id} | ${r.name} | ${r.status} |`),
  "",
  ...results.flatMap((r) => [`## ${r.id}. ${r.name}: ${r.status}`, "", r.summary, "", ...(r.exceptions.length ? ["Exceptions:", "", ...r.exceptions.map((e) => `- ${e}`), ""] : ["No exceptions.", ""])]),
].join("\n");

if (process.argv.includes("--stdout")) console.log(md);
else {
  const out = `docs/cast-audit-${ymd}.md`;
  writeFileSync(join(ROOT, out), md);
  console.log(`wrote ${out}`);
}
for (const r of results) console.log(`${r.id}. ${r.name}: ${r.status} (${r.exceptions.length} exceptions)`);
console.log(`audit:cast ${overall}`);
process.exit(overall === "FAIL" ? 1 : 0);
