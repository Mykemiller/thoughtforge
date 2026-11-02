// Resolve a panelist's real-Voice network against the Supabase people spine (Linear TH-15).
//
//   npm run resolve:network -- --slug albert-thorne          live, anon key from .env.local
//   npm run resolve:network -- --all                          every panelist
//   npm run resolve:network -- --slug albert-thorne --snapshot cast/_fixtures/people-snapshot.json
//   npm run resolve:network:dry                               3-name fixture, prints only
//
// Reads  cast/<slug>/network.draft.yaml
// Writes cast/<slug>/network.json and, when anything fails to resolve, cast/<slug>/network.unresolved.yaml.
// Read-only against the project of record. Never writes to Supabase and never uses the service role key.

import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { createClient } from "@supabase/supabase-js";
import {
  PROJECT_REF, DECOY_REF, resolveDraft, snapshotSource, projectRefFromUrl, isAnonKey,
  type Draft, type PeopleSource, type Resolution,
} from "./lib/network-core.ts";

const ROOT = resolve(import.meta.dirname, "..");
const CAST = join(ROOT, "cast");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function die(msg: string): never {
  console.error(`resolve:network ABORT: ${msg}`);
  process.exit(1);
}

function loadEnvLocal() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const EXPECTED: Record<string, string[]> = {
  people: ["person_id", "canonical_name", "aliases", "primary_domain_code"],
  person_affiliations: ["person_id", "employer_name", "role_title", "is_current", "valid_from"],
  person_domain_tags: ["person_id", "subdomain_code", "is_primary"],
  office_occupancies: ["person_id", "office_id", "role_title", "valid_from", "valid_to"],
};

async function liveSource(): Promise<PeopleSource> {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) die("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local");

  // Guard assertion: the project of record and nothing else.
  const ref = projectRefFromUrl(url);
  if (ref === DECOY_REF) die(`refusing the decoy project ${DECOY_REF}`);
  if (ref !== PROJECT_REF) die(`project ref is ${ref ?? "unreadable"}, expected ${PROJECT_REF}`);
  if (!isAnonKey(key)) die("NEXT_PUBLIC_SUPABASE_ANON_KEY is not an anon or publishable key; the service role key is never used here");
  console.error(`guard ok: project ${ref}, anon key`);

  const db = createClient(url, key, { auth: { persistSession: false } });

  // Schema probe: one row from each table before any real query, so a renamed column fails loudly.
  for (const [table, cols] of Object.entries(EXPECTED)) {
    const { data, error } = await db.from(table).select("*").limit(1);
    if (error) die(`schema probe on ${table} failed: ${error.message}`);
    if (!data || data.length === 0) {
      die(`${table} returned no rows to the anon key. Row level security is on with no anon read policy, ` +
        "so every name would come back unresolved. See docs/network-rules.md, Schema notes. " +
        "Use --snapshot until a read path for the anon key exists.");
    }
    const missing = cols.filter((c) => !(c in data[0]));
    if (missing.length) die(`${table} is missing expected columns: ${missing.join(", ")}`);
  }

  const esc = (s: string) => s.replace(/[\\%_*]/g, (c) => `\\${c}`);
  const today = new Date().toISOString().slice(0, 10);
  const must = <T>(r: { data: T[] | null; error: { message: string } | null }, what: string): T[] => {
    if (r.error) die(`${what}: ${r.error.message}`);
    return r.data ?? [];
  };
  return {
    async byCanonicalName(name) {
      return must(await db.from("people").select("person_id,canonical_name,aliases,primary_domain_code").ilike("canonical_name", esc(name)), "people by name");
    },
    async byAlias(name) {
      return must(await db.from("people").select("person_id,canonical_name,aliases,primary_domain_code").contains("aliases", [name]), "people by alias");
    },
    async currentAffiliations(ids) {
      return must(await db.from("person_affiliations").select("person_id,employer_name,role_title,is_current,valid_from").in("person_id", ids).eq("is_current", true), "person_affiliations");
    },
    async domainTags(ids) {
      return must(await db.from("person_domain_tags").select("person_id,subdomain_code,is_primary").in("person_id", ids), "person_domain_tags");
    },
    async currentOffices(ids) {
      const rows = must(
        await db.from("office_occupancies").select("person_id,role_title,valid_from,valid_to,offices(office_name)").in("person_id", ids).or(`valid_to.is.null,valid_to.gte.${today}`),
        "office_occupancies",
      ) as unknown as { person_id: string; role_title: string | null; valid_from: string | null; valid_to: string | null; offices: { office_name: string } | null }[];
      return rows.map((r) => ({ person_id: r.person_id, office_name: r.offices?.office_name ?? "", role_title: r.role_title, valid_from: r.valid_from, valid_to: r.valid_to }));
    },
  };
}

function loadDraft(slug: string): Draft {
  const p = join(CAST, slug, "network.draft.yaml");
  if (!existsSync(p)) die(`no draft at cast/${slug}/network.draft.yaml`);
  const d = parse(readFileSync(p, "utf8")) as Draft;
  if (!d || d.slug !== slug || !Array.isArray(d.entries)) die(`cast/${slug}/network.draft.yaml must have slug: ${slug} and an entries list`);
  return d;
}

function write(res: Resolution, sourceLabel: string) {
  const dir = join(CAST, res.slug);
  const out = {
    slug: res.slug,
    rule: "TF-OPEN-08 (2026-11-01): real people only, public settings before 2025; follows, cites or shared_room with a named venue",
    resolved_against: `${PROJECT_REF} people`,
    source: sourceLabel,
    resolved_on: new Date().toISOString().slice(0, 10),
    entries: res.resolved,
  };
  writeFileSync(join(dir, "network.json"), JSON.stringify(out, null, 2) + "\n");
  const un = join(dir, "network.unresolved.yaml");
  if (res.unresolved.length) {
    writeFileSync(un, "# For Myke's review. Never promoted to people; fix the draft or the spine, then rerun.\n" + stringify({ slug: res.slug, unresolved: res.unresolved }));
  } else if (existsSync(un)) {
    rmSync(un);
  }
}

async function main() {
  const snapshot = arg("snapshot");
  const dry = flag("dry-run");
  const all = flag("all");
  const one = arg("slug");
  if (!all && !one) die("pass --slug <slug> or --all");

  const slugs = all
    ? readdirSync(CAST, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(CAST, d.name, "network.draft.yaml"))).map((d) => d.name).sort()
    : [one!];

  let src: PeopleSource;
  let label: string;
  if (snapshot) {
    const snap = JSON.parse(readFileSync(resolve(ROOT, snapshot), "utf8"));
    if (snap.project_ref !== PROJECT_REF) die(`snapshot project_ref is ${snap.project_ref}, expected ${PROJECT_REF}`);
    src = snapshotSource(snap);
    label = `snapshot ${snapshot} (taken ${snap.taken_at})`;
  } else {
    src = await liveSource();
    label = "live (anon key)";
  }

  let anyUnresolved = false;
  for (const slug of slugs) {
    const res = await resolveDraft(loadDraft(slug), src);
    const counts = { exact: 0, alias: 0 };
    for (const r of res.resolved) counts[r.resolution]++;
    console.log(`${slug}: ${res.resolved.length} resolved (exact ${counts.exact}, alias ${counts.alias}), ${res.unresolved.length} unresolved`);
    for (const u of res.unresolved) console.log(`  unresolved: ${u.name} (${u.reason})`);
    if (res.unresolved.length) anyUnresolved = true;
    if (dry) console.log(JSON.stringify(res, null, 2));
    else write(res, label);
  }
  if (dry) console.log("dry run: nothing written");
  process.exit(anyUnresolved ? 2 : 0);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
