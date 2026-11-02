// Minimal GDELT DOC 2.0 helpers shared by the smoke test and, later, the gdelt-research skill runner.
// Rules from cast/_shared/skills/gdelt-research/SKILL.md: one request per 5 seconds, tone is directional,
// never reproduce article text.

export const DOC_API = "https://api.gdeltproject.org/api/v2/doc/doc";
export const PACE_MS = 5000;
export const DEFAULT_TIMESPAN = "90d"; // README recommendation: default lookback 90 days

export function docUrl(query: string, mode: "artlist" | "timelinevol" | "timelinetone", timespan = DEFAULT_TIMESPAN, maxRecords = 250): string {
  const p = new URLSearchParams({ query, mode, format: "json", timespan });
  if (mode === "artlist") p.set("maxrecords", String(maxRecords));
  return `${DOC_API}?${p.toString()}`;
}

export type Parsed =
  | { ok: true; rows: number; series: string; first?: string; last?: string }
  | { ok: false; rateLimited: boolean; message: string };

/** GDELT answers errors as plain text with HTTP 200, so the body decides, not the status. */
export function parseTimeline(body: string): Parsed {
  const text = body.trim();
  if (!text.startsWith("{")) {
    return { ok: false, rateLimited: /limit requests|one every 5 seconds|too many/i.test(text), message: text.slice(0, 200) };
  }
  let j: { timeline?: { series?: string; data?: { date?: string; value?: number }[] }[] };
  try {
    j = JSON.parse(text);
  } catch (e) {
    return { ok: false, rateLimited: false, message: `invalid JSON: ${(e as Error).message}` };
  }
  const t = j.timeline?.[0];
  if (!t || !Array.isArray(t.data)) return { ok: false, rateLimited: false, message: "no timeline[0].data in response" };
  return { ok: true, rows: t.data.length, series: t.series ?? "", first: t.data[0]?.date, last: t.data.at(-1)?.date };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
