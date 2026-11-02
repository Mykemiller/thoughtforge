/**
 * Cast loader core (TH-27). Pure Node: reads cast/<slug>/* from disk, validates
 * each persona.json against cast/_schema/persona.schema.json with ajv, joins on
 * slug with the manifest in src/data/panel.ts, and fails loudly on any drift.
 *
 * Import this from tests and scripts. App code imports ./load, which adds the
 * "server-only" marker so the filesystem never reaches a client bundle.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import { PANEL } from "../data/panel";
import type { Cast, CastMember, Network, Persona, SharedSkills, Skill } from "./types";

export const CAST_ROOT = resolve(process.cwd(), "cast");
const SHARED_SKILL_NAMES = ["evidence-ladder", "faraday-retrieval", "gdelt-research"] as const;

const read = (p: string) => readFileSync(p, "utf8");

/** Minimal front-matter split for SKILL.md: `---\nname: x\ndescription: y\n---\nbody`. */
export function parseSkillFile(path: string, kind: Skill["kind"], name?: string): Skill {
  const raw = read(path);
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`cast loader: ${path} has no front matter`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta.name) throw new Error(`cast loader: ${path} front matter has no name`);
  return { name: name ?? meta.name, description: meta.description ?? "", kind, path, body: m[2].trim() };
}

/** Extract one "## Heading" section from a dossier (heading matched by prefix). */
export function dossierSection(md: string, heading: string): string {
  const esc = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^## ${esc}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m");
  return (md.match(re)?.[1] ?? "").trim();
}

let validator: ValidateFunction | null = null;
function personaValidator(): ValidateFunction {
  if (validator) return validator;
  const schema = JSON.parse(read(join(CAST_ROOT, "_schema/persona.schema.json")));
  const ajv = new Ajv2020({ allErrors: true, strict: false, formats: { uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i } });
  validator = ajv.compile(schema);
  return validator;
}

export function loadSharedSkills(root = CAST_ROOT): SharedSkills {
  const all = SHARED_SKILL_NAMES.map((n) => parseSkillFile(join(root, "_shared/skills", n, "SKILL.md"), "shared"));
  const by = (n: string) => {
    const s = all.find((x) => x.name === n);
    if (!s) throw new Error(`cast loader: shared skill ${n} missing`);
    return s;
  };
  return { evidenceLadder: by("evidence-ladder"), faradayRetrieval: by("faraday-retrieval"), gdeltResearch: by("gdelt-research"), all };
}

function loadMember(slug: string, order: number, root: string): CastMember {
  const dir = join(root, slug);
  for (const f of ["persona.json", "network.json", "dossier.md", "linkedin.md"]) {
    if (!existsSync(join(dir, f))) throw new Error(`cast loader: cast/${slug}/${f} is missing`);
  }
  const persona = JSON.parse(read(join(dir, "persona.json"))) as Persona;
  const validate = personaValidator();
  if (!validate(persona)) {
    throw new Error(`cast loader: cast/${slug}/persona.json fails the schema: ${JSON.stringify(validate.errors)}`);
  }
  if (persona.slug !== slug) throw new Error(`cast loader: cast/${slug}/persona.json has slug ${persona.slug}`);
  const network = JSON.parse(read(join(dir, "network.json"))) as Network;
  const dossier = read(join(dir, "dossier.md"));
  const linkedin = read(join(dir, "linkedin.md"));
  const skills = persona.skills
    .filter((s) => s.kind === "persona")
    .map((s) => {
      const p = resolve(process.cwd(), s.path);
      if (!existsSync(p)) throw new Error(`cast loader: ${slug} skill ${s.name} not found at ${s.path}`);
      return parseSkillFile(p, "persona", s.name); // manifest name (e.g. one-line-diagram), not the front-matter slug
    });
  return { slug, order, persona, network, dossier, linkedin, skills, voiceBrief: persona.voice_brief };
}

/**
 * Load every panelist, ordered by the manifest's `order`. A slug present in the
 * manifest but absent from cast/, or present in cast/ but absent from the
 * manifest, fails the build with the slug named.
 */
export function loadCastFrom(root = CAST_ROOT): Cast {
  const onDisk = readdirSync(root).filter((d) => !d.startsWith("_") && statSync(join(root, d)).isDirectory() && existsSync(join(root, d, "persona.json")));
  const manifest = [...PANEL].sort((a, b) => a.order - b.order);
  const manifestSlugs = new Set(manifest.map((m) => m.slug));
  for (const slug of onDisk) if (!manifestSlugs.has(slug)) throw new Error(`cast loader: cast/${slug} exists but is not in src/data/panel.ts`);
  for (const m of manifest) if (!onDisk.includes(m.slug)) throw new Error(`cast loader: ${m.slug} is in src/data/panel.ts but cast/${m.slug} is missing`);
  const members = manifest.map((m) => loadMember(m.slug, m.order, root));
  return { members, shared: loadSharedSkills(root) };
}

let cache: Cast | null = null;
/** Memoized per process: the cast is static at build time. */
export function loadCast(): CastMember[] {
  if (!cache) cache = loadCastFrom();
  return cache.members;
}
export function loadCastWithShared(): Cast {
  if (!cache) cache = loadCastFrom();
  return cache;
}
export function getMember(slug: string): CastMember | undefined {
  return loadCast().find((m) => m.slug === slug);
}
