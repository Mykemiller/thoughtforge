#!/usr/bin/env node
// Validates every cast/<slug>/persona.json against the cast standard (docs/cast-standard.md).
// No external dependencies; Node 20+. Exit 1 on any failure.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CAST = join(ROOT, "cast");
const errors = [];
const fail = (slug, msg) => errors.push(`${slug}: ${msg}`);

const associates = JSON.parse(readFileSync(join(CAST, "_shared/associates.json"), "utf8"));
const relationships = JSON.parse(readFileSync(join(CAST, "_shared/relationships.json"), "utf8"));
const assocById = new Map(associates.map((a) => [a.id, a]));
const relById = new Map(relationships.map((r) => [r.id, r]));

const slugs = readdirSync(CAST).filter((d) => !d.startsWith("_") && statSync(join(CAST, d)).isDirectory());
const personas = new Map();
for (const slug of slugs) {
  const p = join(CAST, slug, "persona.json");
  if (!existsSync(p)) { fail(slug, "missing persona.json"); continue; }
  personas.set(slug, JSON.parse(readFileSync(p, "utf8")));
}

const REQUIRED = ["personal", "moments", "slug", "display_name", "short_name", "role", "idf_domains", "born_year", "hometown", "family", "education", "career", "associates", "relationships", "network_status", "network", "organizations", "skills", "gdelt_lens", "voice_brief", "evidence_tags"];
const MIN = { family: 3, education: 2, career: 5, associates: 4, relationships: 3, organizations: 3 };
const FORBIDDEN_TITLE = /\b(chief executive|ceo|(?<!(assistant|deputy|associate) )general counsel|chief technology|cto|(?<!vice )president|commissioner)\b/i;

const fictionalNames = new Set(associates.map((a) => a.name.toLowerCase()));
for (const [, p] of personas) {
  fictionalNames.add(p.display_name.toLowerCase());
  for (const f of p.family || []) fictionalNames.add(f.name.toLowerCase());
}

for (const [slug, p] of personas) {
  for (const k of REQUIRED) if (!(k in p)) fail(slug, `missing field ${k}`);
  if (p.slug !== slug) fail(slug, `slug field ${p.slug} does not match folder`);
  for (const [k, n] of Object.entries(MIN)) if ((p[k] || []).length < n) fail(slug, `${k} has ${(p[k] || []).length}, needs ${n}`);
  if (p.born_year < 1962 || p.born_year > 1985) fail(slug, `born_year ${p.born_year} outside 1962-1985`);
  for (const f of p.family || []) if (f.evidence !== "FIC") fail(slug, `family ${f.name} not tagged FIC`);
  for (const e of p.education || []) if (e.evidence !== "REAL-ORG") fail(slug, `education ${e.institution} not tagged REAL-ORG`);
  for (const c of p.career || []) {
    if (!["FIC", "REAL-ORG"].includes(c.evidence)) fail(slug, `career ${c.employer} has bad evidence tag`);
    if (c.employer !== "ThoughtForge Panel" && FORBIDDEN_TITLE.test(c.title)) fail(slug, `singular officer title at a real firm: ${c.title} (${c.employer})`);
  }
  for (const id of p.associates || []) {
    const a = assocById.get(id);
    if (!a) fail(slug, `unknown associate ${id}`);
    else if (!a.knows.includes(slug)) fail(slug, `associate ${id} does not list ${slug} in knows[]`);
  }
  for (const id of p.relationships || []) {
    const r = relById.get(id);
    if (!r) fail(slug, `unknown relationship ${id}`);
    else if (!r.participants.includes(slug)) fail(slug, `relationship ${id} does not list ${slug}`);
  }
  const persona_skills = (p.skills || []).filter((s) => s.kind === "persona");
  const shared = new Set((p.skills || []).filter((s) => s.kind === "shared").map((s) => s.name));
  if (persona_skills.length < 3) fail(slug, `needs 2 persona skills plus gdelt-lens, has ${persona_skills.length}`);
  if (!persona_skills.some((s) => s.name === "gdelt-lens")) fail(slug, "missing gdelt-lens skill");
  for (const n of ["gdelt-research", "evidence-ladder", "faraday-retrieval"]) if (!shared.has(n)) fail(slug, `missing shared skill ${n}`);
  for (const s of p.skills || []) if (!existsSync(join(ROOT, s.path))) fail(slug, `skill path not found: ${s.path}`);
  if (p.network_status === "pending_tf_open_08" && p.network.length) fail(slug, "network must be empty while TF-OPEN-08 is pending");
  if (p.network_status === "resolved" && (p.network.length < 6 || p.network.length > 15)) fail(slug, "resolved network needs 6 to 15 entries");
  for (const n of p.network || []) if (!(n.since < 2025)) fail(slug, `network entry ${n.name} must date from before 2025 (TF-OPEN-08 ruling)`);
  for (const m of p.moments || []) if (!(m.date < "2025-01-01")) fail(slug, `moment ${m.event} must be before 2025`);
  for (const k of ["hobbies", "sports", "laughs", "smiles", "regrets", "vacations", "frailties", "generosity", "modesty"]) if (!p.personal || !p.personal[k]) fail(slug, `personal.${k} missing`);
  for (const m of p.moments || []) for (const s of m.shared_with || []) {
    const other = personas.get(s);
    if (!other) fail(slug, `moment shared with unknown panelist ${s}`);
    else if (!(other.moments || []).some((x) => x.date === m.date)) fail(slug, `moment ${m.date} shared with ${s} is missing from ${s}'s moments`);
  }
  for (const n of p.network || []) {
    if (!["follows", "cites", "shared_room"].includes(n.relationship_kind)) fail(slug, `bad relationship_kind for ${n.name}`);
    if (!n.person_id || !n.venue) fail(slug, `network entry ${n.name} needs person_id and venue`);
    if (fictionalNames.has(String(n.name).toLowerCase())) fail(slug, `fictional name in network: ${n.name}`);
  }
  for (const f of ["dossier.md", "linkedin.md"]) if (!existsSync(join(CAST, slug, f))) fail(slug, `missing ${f}`);
}

// relationships: each participant lists it; each panelist in >= 3
for (const r of relationships) {
  for (const s of r.participants) {
    const p = personas.get(s);
    if (!p) fail("_shared", `${r.id} names unknown panelist ${s}`);
    else if (!p.relationships.includes(r.id)) fail(s, `does not list relationship ${r.id}`);
  }
  for (const a of r.associates) if (!assocById.has(a)) fail("_shared", `${r.id} names unknown associate ${a}`);
}

// overlapping employers must be explained by a relationship
const list = [...personas.values()];
for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
  const a = list[i], b = list[j];
  const joined = relationships.some((r) => r.participants.includes(a.slug) && r.participants.includes(b.slug));
  for (const ca of a.career) for (const cb of b.career) {
    if (ca.employer !== cb.employer || ca.employer === "ThoughtForge Panel") continue;
    const ea = ca.end ?? 9999, eb = cb.end ?? 9999;
    if (ca.start < eb && cb.start < ea && !joined) fail("_shared", `${a.slug} and ${b.slug} overlap at ${ca.employer} with no relationship`);
  }
}

// no fictional associate name equals a panelist name
for (const a of associates) for (const [, p] of personas) if (a.name === p.display_name) fail("_shared", `associate ${a.id} collides with panelist`);

if (errors.length) {
  console.error(`validate:cast FAILED (${errors.length})`);
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}
console.log(`validate:cast PASS: ${personas.size} panelists, ${associates.length} associates, ${relationships.length} relationships`);
