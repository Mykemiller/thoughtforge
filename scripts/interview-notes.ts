// Interview-to-dossier loop (Linear TH-52).
//
//   npm run interview:notes -- --slug <slug> --session <id> --dry-run
//       print the would-be interview-notes.md and the delta summary; writes nothing
//   npm run interview:notes -- --slug <slug> --session <id>
//       write cast/<slug>/interview-notes.md (byte-identical on a rerun)
//   npm run interview:notes -- --slug <slug> --session <id> --deltas
//       also write the proposed persona.json and dossier.md additions to the working tree
//   npm run interview:notes -- --slug <slug> --session <id> --pr
//       switch to branch th-52-notes-<slug>, write notes + deltas, commit, push that branch and
//       open a draft PR with gh. Never pushes main, never merges (TF-DEC-19, TF-DEC-40, TF-DEC-50).
//   npm run interview:notes -- --slug <slug> --session <id> --save-midterm
//       upsert the Q6 answer as "[Temper Mark] <Name> on the 2026 midterms" in tf_artifacts,
//       keyed by the midterm and panelist tags, after exporting any matching rows to
//       docs/interviews/snapshots/. Only after Myke has confirmed a dry run (TH-52 Autonomy).
//   --fixture <file.json>   read the session from a JSON file instead of Supabase (offline)
//
// Supabase: the project of record only. Before any read: the URL guard, then the library counts
// (dc_facilities >= 18000, artifacts >= 100000). Never prints a key.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PANEL } from "../src/data/panel.ts";
import { parseArc } from "../src/interview/guide.ts";
import { section } from "./lib/audit-core.ts";
import {
  assertProjectUrl, assertGuardCounts, assertSession, buildNotes, notesMarkdown, personaAnchors,
  applyPersonaDelta, applyDossierDelta, withoutAdditions, deltaBranch, midtermArtifact, midtermTitle, MIDTERM_TAG,
  type SessionRow, type Panelist, type CastText, type Addition,
} from "./lib/interview-notes-core.ts";

const ROOT = resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function args(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v !== undefined && !v.startsWith("--")) { out[k] = v; i++; } else out[k] = true;
  }
  return out;
}

function loadDotEnvLocal() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

function die(msg: string, code = 1): never {
  console.error(`interview:notes: ${msg}`);
  process.exit(code);
}

async function guardedClient(): Promise<SupabaseClient> {
  loadDotEnvLocal();
  const url = assertProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (run `vercel env pull .env.local` or export it)");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const dc = await sb.from("dc_facilities").select("*", { count: "exact", head: true });
  if (dc.error) throw new Error(`guard: counting dc_facilities failed: ${dc.error.message}`);
  const art = await sb.from("artifacts").select("*", { count: "exact", head: true });
  if (art.error) throw new Error(`guard: counting artifacts failed: ${art.error.message}`);
  assertGuardCounts({ dcFacilities: dc.count, artifacts: art.count });
  console.error(`guard: ok (dc_facilities ${dc.count}, artifacts ${art.count})`);
  return sb;
}

function git(...a: string[]): string {
  return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
}

async function main() {
  const a = args(process.argv.slice(2));
  const slug = typeof a.slug === "string" ? a.slug : "";
  const sessionId = typeof a.session === "string" ? a.session : "";
  if (!slug || !sessionId) die("usage: npm run interview:notes -- --slug <slug> --session <id> [--dry-run] [--deltas] [--pr] [--save-midterm] [--fixture <file.json>]", 2);
  const dryRun = a["dry-run"] === true;
  const wantPr = a.pr === true;
  const wantDeltas = wantPr || a.deltas === true;
  const saveMidterm = a["save-midterm"] === true;
  if (dryRun && (wantPr || saveMidterm)) die("--dry-run writes nothing; drop --pr / --save-midterm", 2);

  // Slug from the panel manifest (TH-64 may have renamed a panelist), and its cast folder.
  const member = PANEL.find((m) => m.slug === slug);
  if (!member || !existsSync(join(ROOT, "cast", slug, "persona.json"))) die(`unknown panelist slug '${slug}' (not in src/data/panel.ts or no cast/${slug}/persona.json); stopping`);

  // Session: fixture (offline) or the project of record behind the guard.
  let row: SessionRow | null;
  let sb: SupabaseClient | null = null;
  if (typeof a.fixture === "string") {
    row = JSON.parse(readFileSync(resolve(a.fixture), "utf8")) as SessionRow;
    if (row.id !== sessionId) row = null;
  } else {
    sb = await guardedClient();
    const r = await sb.from("tf_sessions").select("id, kind, panelist, asked_at, transcript").eq("id", sessionId).maybeSingle();
    if (r.error) throw new Error(`reading tf_sessions failed: ${r.error.message}`);
    row = r.data as SessionRow | null;
  }
  assertSession(row, sessionId, slug);

  // Switch to the delta branch before reading the cast files, so a rerun builds on its earlier deltas.
  let branch = "";
  if (wantPr) {
    if (git("status", "--porcelain", "--", `cast/${slug}`)) die(`cast/${slug} has uncommitted changes; commit or stash them first`);
    branch = deltaBranch(slug);
    if (branch === "main" || !branch.startsWith("th-52-notes-")) die("refusing to commit outside a th-52-notes-<slug> branch");
    const exists = git("branch", "--list", branch) !== "";
    git("checkout", ...(exists ? [branch] : ["-b", branch]));
  }

  const personaJson = read(`cast/${slug}/persona.json`);
  const persona = JSON.parse(personaJson);
  const p: Panelist = { slug, displayName: persona.display_name, role: persona.role };
  const arc = parseArc(section(read("docs/interviews/guide.md"), "The fixed arc"));
  const snapshot = JSON.parse(read("cast/_fixtures/people-snapshot.json")) as { people: { canonical_name: string }[] };
  const dossier = read(`cast/${slug}/dossier.md`);
  const cast: CastText = {
    // Earlier proposals stay out of the corpus, or a rerun on the delta branch would stop seeing them as new.
    corpus: [applyDossierDelta(dossier, []), read(`cast/${slug}/linkedin.md`), withoutAdditions(personaJson)].join("\n"),
    anchors: personaAnchors(persona),
    network: (persona.network as { name: string }[]).map((n) => n.name),
    spine: snapshot.people.map((x) => x.canonical_name),
    known: [...PANEL.map((m) => m.name), "Myke", "ThoughtForge", "Faraday", ...arc],
  };
  const notes = buildNotes(sessionId, row.transcript, arc, cast);
  const md = notesMarkdown(p, row, notes, arc.length);
  const notesPath = `cast/${slug}/interview-notes.md`;

  const nextPersona = applyPersonaDelta(personaJson, sessionId, notes.additions);
  const allAdditions = (JSON.parse(nextPersona).interview_additions ?? []) as Addition[];
  const nextDossier = applyDossierDelta(dossier, allAdditions);
  const summary = [
    `panelist: ${p.displayName} (${slug})`,
    `session: ${sessionId}, ${row.transcript.length} turns`,
    `held ${notes.held.length}, drifted ${notes.drifted.length}, new ${notes.added.length}; arc gaps: ${notes.arcGaps.map((n) => `Q${n}`).join(", ") || "none"}`,
    `persona.json: ${notes.additions.length} proposed interview_additions${nextPersona === personaJson ? " (no change)" : ""}`,
    `dossier.md: ${nextDossier === dossier ? "no change" : `"Interview additions (proposed, TH-52)" section with ${allAdditions.length} lines`}`,
    `midterm artifact: ${notes.q6 ? `"${midtermTitle(p.displayName)}" from turns ${notes.q6.turns.map((t) => `T${t}`).join(", ")}` : "none (Q6 not found)"}`,
    `delta branch: ${deltaBranch(slug)}`,
  ];

  if (dryRun) {
    process.stdout.write(md);
    console.log(`\n---- dry run: nothing written ----\n${summary.join("\n")}`);
    return;
  }

  const before = existsSync(join(ROOT, notesPath)) ? read(notesPath) : null;
  writeFileSync(join(ROOT, notesPath), md);
  console.log(`${before === md ? "unchanged" : "wrote"} ${notesPath}`);
  if (wantDeltas) {
    writeFileSync(join(ROOT, `cast/${slug}/persona.json`), nextPersona);
    writeFileSync(join(ROOT, `cast/${slug}/dossier.md`), nextDossier);
    console.log(`proposed deltas written to cast/${slug}/persona.json and cast/${slug}/dossier.md (not applied anywhere else)`);
  }

  if (wantPr) {
    const current = git("rev-parse", "--abbrev-ref", "HEAD");
    if (current !== branch) die(`expected to be on ${branch}, found ${current}; stopping before commit`);
    git("add", notesPath, `cast/${slug}/persona.json`, `cast/${slug}/dossier.md`);
    if (git("diff", "--cached", "--name-only")) {
      git("commit", "-m", `cast(${slug}): interview notes and proposed deltas from session ${sessionId} (TH-52)`);
    } else console.log("nothing to commit: rerun on the same session is a no-op");
    git("push", "-u", "origin", branch);
    const title = `TH-52 notes: ${p.displayName}, session ${sessionId.slice(0, 8)} (proposed deltas, do not auto-merge)`;
    const body = [
      `Interview notes and proposed cast deltas for ${p.displayName} from tf_sessions \`${sessionId}\` (TH-52).`,
      ``,
      summary.map((s) => `- ${s}`).join("\n"),
      ``,
      `Every proposed line is a verbatim quote tagged with its transcript turn. Nothing merges automatically; Myke decides what is kept (TF-DEC-19, TF-DEC-40, TF-DEC-50). Run \`npm run validate:cast && npm run audit:cast\` on this branch before review.`,
      ``,
      `🤖 Generated with Claude Code`,
    ].join("\n");
    try {
      const url = execFileSync("gh", ["pr", "create", "--draft", "--base", "main", "--head", branch, "--title", title, "--body", body], { cwd: ROOT, encoding: "utf8" }).trim();
      console.log(`draft PR: ${url}`);
    } catch {
      console.log(`gh could not open the PR; open a draft PR from ${branch} into main by hand. Title: ${title}`);
    }
  }

  if (saveMidterm) {
    if (!notes.q6) die("no Q6 answer in this session; no midterm artifact written");
    sb ??= await guardedClient();
    const existing = await sb.from("tf_artifacts").select("*").contains("tags", [MIDTERM_TAG, `panelist:${slug}`]);
    if (existing.error) throw new Error(`reading tf_artifacts failed: ${existing.error.message}`);
    const snapDir = join(ROOT, "docs/interviews/snapshots");
    mkdirSync(snapDir, { recursive: true });
    const snapPath = join(snapDir, `${slug}-midterm-${sessionId}.json`);
    writeFileSync(snapPath, `${JSON.stringify({ taken_before: "TH-52 --save-midterm", session_id: sessionId, rows: existing.data ?? [] }, null, 2)}\n`);
    console.log(`snapshot: ${(existing.data ?? []).length} matching rows exported to docs/interviews/snapshots/${slug}-midterm-${sessionId}.json`);
    const artifact = midtermArtifact(p, sessionId, row.asked_at, notes.q6, (persona.idf_domains as { code: string }[]).map((d) => d.code));
    const id = existing.data?.[0]?.id as string | undefined;
    const w = id ? await sb.from("tf_artifacts").update(artifact).eq("id", id).select("id").single() : await sb.from("tf_artifacts").insert(artifact).select("id").single();
    if (w.error) throw new Error(`writing tf_artifacts failed: ${w.error.message}`);
    console.log(`${id ? "updated" : "inserted"} tf_artifacts ${w.data.id}: ${artifact.title}`);
  }
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
