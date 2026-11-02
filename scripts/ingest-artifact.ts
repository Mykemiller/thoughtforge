// Ingest Markdown artifacts into tf_artifacts (TH-32 §5).
//
//   npm run ingest:artifact -- artifacts/inbox/my-note.md
//   npm run ingest:artifact -- artifacts/inbox            # every .md in the directory (skips _example.md and README.md)
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local or the
// environment, runs the decoy guard, upserts on url when present, prints one id per file.
// Never prints a key.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseArtifactMarkdown } from "./lib/frontmatter.ts";
import { requireServiceEnv } from "./lib/supabase-guard.ts";

function loadDotEnvLocal() {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

const target = process.argv[2];
if (!target) {
  console.error("usage: npm run ingest:artifact -- <file.md | directory>");
  process.exit(2);
}
loadDotEnvLocal();
const { url, key } = requireServiceEnv();
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const files = statSync(target).isDirectory()
  ? readdirSync(target).filter((f) => f.endsWith(".md") && !f.startsWith("_") && f.toLowerCase() !== "readme.md").map((f) => join(target, f))
  : [target];
if (!files.length) {
  console.error(`no .md files in ${target}`);
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  try {
    const doc = parseArtifactMarkdown(readFileSync(file, "utf8"));
    const row = {
      title: doc.title,
      publisher: doc.publisher,
      url: doc.url,
      published_at: doc.published_at,
      body: doc.body,
      source: doc.source,
      idf_domains: doc.idf_domains,
      tags: doc.tags,
      created_by: process.env.TF_INGEST_ACTOR ?? "ingest-artifact",
    };
    const q = doc.url
      ? sb.from("tf_artifacts").upsert(row, { onConflict: "url" }).select("id").single()
      : sb.from("tf_artifacts").insert(row).select("id").single();
    const { data, error } = await q;
    if (error) throw error;
    console.log(`${basename(file)} -> ${data.id}${doc.url ? " (upsert on url)" : ""}`);
  } catch (err) {
    failed++;
    console.error(`${basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(failed ? 1 : 0);
