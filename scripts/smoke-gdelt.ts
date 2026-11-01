// Smoke test for the shared gdelt-research skill (Linear TH-14).
// Runs one DOC 2.0 timelinevol query for "data center moratorium" over the default 90-day lookback
// and prints the row count. Read-only: no write-back, no Supabase.
//
//   npm run smoke:gdelt
//
// Exit 0 when GDELT returns a timeline with at least one row, 1 otherwise.

import { docUrl, parseTimeline, sleep, PACE_MS } from "./lib/gdelt.ts";

const QUERY = '"data center moratorium"';
const TIMEOUT_MS = 30_000;

// HTTP 429 is GDELT's rate limit (it also throttles shared CI runner IPs); report it as such.
async function once(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "thoughtforge-smoke/1.0" } });
  if (res.status === 429) return "Please limit requests to one every 5 seconds (HTTP 429).";
  if (!res.ok) throw new Error(`HTTP ${res.status} from GDELT`);
  return res.text();
}

async function main() {
  const url = docUrl(QUERY, "timelinevol");
  console.log(`GDELT DOC 2.0 timelinevol: ${QUERY}`);
  console.log(url);

  let parsed = parseTimeline(await once(url));
  for (const wait of [PACE_MS, PACE_MS * 3]) {
    if (parsed.ok || !parsed.rateLimited) break;
    console.log(`rate limited, waiting ${wait / 1000}s and retrying`);
    await sleep(wait);
    parsed = parseTimeline(await once(url));
  }
  if (!parsed.ok) {
    console.error(`smoke:gdelt FAIL: ${parsed.message}`);
    process.exit(1);
  }
  console.log(`rows: ${parsed.rows}`);
  console.log(`series: ${parsed.series}; range ${parsed.first ?? "?"} to ${parsed.last ?? "?"}`);
  if (parsed.rows === 0) {
    console.error("smoke:gdelt FAIL: timeline came back empty");
    process.exit(1);
  }
  console.log("smoke:gdelt PASS");
}

main().catch((e) => {
  const cause = e instanceof Error && e.cause ? ` (cause: ${(e.cause as Error).message ?? String(e.cause)})` : "";
  console.error(`smoke:gdelt FAIL: ${e instanceof Error ? e.message : String(e)}${cause}`);
  process.exit(1);
});
