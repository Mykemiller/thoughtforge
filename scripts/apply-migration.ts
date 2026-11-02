// Apply a SQL migration file to the project of record (TH-32 §5).
//
//   npm run apply:migration -- supabase/migrations/20261101_tf_artifacts.sql
//
// Order of attempts, after the decoy guard on NEXT_PUBLIC_SUPABASE_URL:
//   1. SUPABASE_DB_URL set and `psql` on PATH  -> psql -f <file>
//   2. SUPABASE_ACCESS_TOKEN set                -> Supabase Management API POST /v1/projects/<ref>/database/query
//   3. otherwise                                -> print what to run by hand and exit 1
// The service-role key alone cannot run DDL (PostgREST has no SQL endpoint), so it is not an option here.
// Nothing secret is ever printed.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assertProjectOfRecord, PROJECT_REF } from "./lib/supabase-guard.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: npm run apply:migration -- <path.sql>");
  process.exit(2);
}
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
if (process.env.NEXT_PUBLIC_SUPABASE_URL) assertProjectOfRecord(process.env.NEXT_PUBLIC_SUPABASE_URL);
const sql = readFileSync(file, "utf8");

if (process.env.SUPABASE_DB_URL) {
  if (!process.env.SUPABASE_DB_URL.includes(PROJECT_REF)) throw new Error(`SUPABASE_DB_URL does not name ${PROJECT_REF}`);
  const r = spawnSync("psql", [process.env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit" });
  if (r.error) console.error(`psql not available: ${r.error.message}`);
  else process.exit(r.status ?? 1);
}
if (process.env.SUPABASE_ACCESS_TOKEN) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    console.error(`Management API returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`applied ${file} to ${PROJECT_REF} via the Management API`);
  process.exit(0);
}
console.error(`Cannot apply ${file}: set SUPABASE_DB_URL (with psql installed) or SUPABASE_ACCESS_TOKEN, or paste the file into the Supabase SQL editor for ${PROJECT_REF}.`);
process.exit(1);
