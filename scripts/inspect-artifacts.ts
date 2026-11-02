// Read-only schema discovery for retrieval Source B (TH-32 §4.2).
//
//   npm run inspect:artifacts
//
// Lists columns of every public table whose name starts with "artifact" using the
// service-role key from .env.local or the environment, after the decoy guard.
// The result recorded for this run is in docs/decisions-th32.md.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { requireServiceEnv } from "./lib/supabase-guard.ts";

const p = resolve(process.cwd(), ".env.local");
if (existsSync(p)) {
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
const { url, key } = requireServiceEnv();
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// PostgREST does not expose information_schema; the migration ships tf_inspect_artifact_columns()
// for this purpose. If the function is missing, fall back to probing the known main table.
const { data, error } = await sb.rpc("tf_inspect_artifact_columns");
if (error) {
  console.error(`tf_inspect_artifact_columns unavailable (${error.message}); probing public.artifacts directly`);
  const probe = await sb.from("artifacts").select("artifact_id,source_url,published_at,signal_envelope,fts").limit(1);
  if (probe.error) throw probe.error;
  console.log(JSON.stringify(Object.keys(probe.data?.[0] ?? {}), null, 2));
  process.exit(0);
}
let table = "";
for (const row of (data ?? []) as { table_name: string; column_name: string; data_type: string }[]) {
  if (row.table_name !== table) {
    table = row.table_name;
    console.log(`\n${table}`);
  }
  console.log(`  ${row.column_name}  ${row.data_type}`);
}
