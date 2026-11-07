/**
 * news lane (TH-66): three to five items from the last 24 hours on the panel's focus, through
 * the repo's shared GDELT DOC client (scripts/lib/gdelt.ts, the gdelt-research skill's rules:
 * one request, headline and outlet only, never article text). No new vendor. Empty on 429,
 * GDELT's plain-text rate-limit answer, a timeout or anything malformed.
 */
import { docUrl } from "../../../scripts/lib/gdelt";
import type { Fetcher } from "./projects";
import type { NewsItem } from "./types";

export const NEWS_QUERY =
  '("data center" OR "data centre" OR datacenter) (power OR grid OR cooling OR construction OR permit OR substation OR transmission OR interconnection) sourcelang:english';
export const NEWS_TIMESPAN = "24h";
export const NEWS_MIN = 3;
export const NEWS_MAX = 5;

interface Article {
  title?: string;
  url?: string;
  domain?: string;
  seendate?: string;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** Pure: GDELT artlist JSON to at most five items, one per outlet, near-duplicate headlines dropped. Fewer than three means empty. */
export function parseNews(body: string): NewsItem[] {
  const text = body.trim();
  if (!text.startsWith("{")) return [];
  let j: { articles?: Article[] };
  try {
    j = JSON.parse(text);
  } catch {
    return [];
  }
  const out: NewsItem[] = [];
  const domains = new Set<string>();
  const titles = new Set<string>();
  for (const a of j.articles ?? []) {
    if (!a?.title || !a.url || !a.domain) continue;
    const key = norm(a.title).slice(0, 60);
    if (!key || domains.has(a.domain) || titles.has(key)) continue;
    domains.add(a.domain);
    titles.add(key);
    out.push({ title: a.title.replace(/\s+/g, " ").trim(), domain: a.domain, url: a.url, seen: a.seendate ?? "" });
    if (out.length >= NEWS_MAX) break;
  }
  return out.length >= NEWS_MIN ? out : [];
}

export async function fetchNews(opts: { fetcher?: Fetcher; timeoutMs?: number; log?: (s: string) => void } = {}): Promise<NewsItem[]> {
  const fetcher = opts.fetcher ?? fetch;
  try {
    const res = await fetcher(docUrl(NEWS_QUERY, "artlist", NEWS_TIMESPAN, 50), { signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) });
    if (!res.ok) {
      opts.log?.(`[email:context] news: GDELT answered ${res.status}`);
      return [];
    }
    return parseNews(await res.text());
  } catch (e) {
    opts.log?.(`[email:context] news: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}
