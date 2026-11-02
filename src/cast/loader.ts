/**
 * Cast loader core (TH-27). Pure Node: reads cast/<slug>/* from disk, validates
 * each persona.json against cast/_schema/persona.schema.json with ajv, joins on
 * slug with the manifest in src/data/panel.ts, and fails loudly on any drift.
 *
 * Import this from tests and scripts. App code imports ./load, which adds the
 * "server-only" marker so the filesystem never reaches a client bundle.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import { PANEL } from "../data/panel";
import type { Cast, CastMember, Network, Persona, SharedSkills, Skill } from "./types";

/**
 * Every filesystem call below spells its path as join(process.cwd(), "cast", ...)
 * so the bundler's file tracer scopes the server bundle to cast/ instead of the
 * whole project (Turbopack warns on any dynamic root).
 */
export const CAST_ROOT = join(process.cwd(), "cast");
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
  const schema = JSON.parse(read(join(process.cwd(), "cast", "_schema", "persona.schema.json")));
  const ajv = new Ajv2020({ allErrors: true, strict: false, formats: { uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i } });
  validator = ajv.compile(schema);
  return validator;
}

export function loadSharedSkills(): SharedSkills {
  const all = SHARED_SKILL_NAMES.map((n) => parseSkillFile(join(process.cwd(), "cast", "_shared", "skills", n, "SKILL.md"), "shared"));
  const by = (n: string) => {
    const s = all.find((x) => x.name === n);
    if (!s) throw new Error(`cast loader: shared skill ${n} missing`);
    return s;
  };
  return { evidenceLadder: by("evidence-ladder"), faradayRetrieval: by("faraday-retrieval"), gdeltResearch: by("gdelt-research"), all };
}

function loadMember(slug: string, order: number): CastMember {
  for (const f of ["persona.json", "network.json", "dossier.md", "linkedin.md"]) {
    if (!existsSync(join(process.cwd(), "cast", slug, f))) throw new Error(`cast loader: cast/${slug}/${f} is missing`);
  }
  const persona = JSON.parse(read(join(process.cwd(), "cast", slug, "persona.json"))) as Persona;
  const validate = personaValidator();
  if (!validate(persona)) {
    throw new Error(`cast loader: cast/${slug}/persona.json fails the schema: ${JSON.stringify(validate.errors)}`);
  }
  if (persona.slug !== slug) throw new Error(`cast loader: cast/${slug}/persona.json has slug ${persona.slug}`);
  const network = JSON.parse(read(join(process.cwd(), "cast", slug, "network.json"))) as Network;
  const dossier = read(join(process.cwd(), "cast", slug, "dossier.md"));
  const linkedin = read(join(process.cwd(), "cast", slug, "linkedin.md"));
  const skills = persona.skills
    .filter((s) => s.kind === "persona")
    .map((s) => {
      // Skill paths are repo-relative and start with "cast/"; scope the read under CAST_ROOT so the bundler can trace it.
      if (!s.path.startsWith("cast/")) throw new Error(`cast loader: ${slug} skill ${s.name} path must start with cast/ (got ${s.path})`);
      const p = join(process.cwd(), "cast", s.path.slice("cast/".length));
      if (!existsSync(p)) throw new Error(`cast loader: ${slug} skill ${s.name} not found at ${s.path}`);
      return parseSkillFile(p, "persona", s.name); // manifest name (e.g. one-line-diagram), not the front-matter slug
    });
  return { slug, order, persona, network, dossier, linkedin, skills, voiceBrief: persona.voice_brief };
}

/** A slug in cast/ but not the manifest, or in the manifest but not cast/, fails with the slug named. */
export function checkSlugs(onDisk: string[], manifestSlugs: string[]): void {
  const manifest = new Set(manifestSlugs);
  for (const slug of onDisk) if (!manifest.has(slug)) throw new Error(`cast loader: cast/${slug} exists but is not in src/data/panel.ts`);
  for (const slug of manifestSlugs) if (!onDisk.includes(slug)) throw new Error(`cast loader: ${slug} is in src/data/panel.ts but cast/${slug} is missing`);
}

/** Load every panelist, ordered by the manifest's `order`, after checkSlugs. */
export function loadCastFrom(): Cast {
  const onDisk = readdirSync(join(process.cwd(), "cast")).filter(
    (d) => !d.startsWith("_") && statSync(join(process.cwd(), "cast", d)).isDirectory() && existsSync(join(process.cwd(), "cast", d, "persona.json")),
  );
  const manifest = [...PANEL].sort((a, b) => a.order - b.order);
  checkSlugs(onDisk, manifest.map((m) => m.slug));
  const members = manifest.map((m) => loadMember(m.slug, m.order));
  return { members, shared: loadSharedSkills() };
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
