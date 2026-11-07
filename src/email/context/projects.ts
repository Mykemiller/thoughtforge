/**
 * projects lane (TH-66): Linear issues on team TH updated in the last 36 hours, through the
 * Linear GraphQL API with a read-only LINEAR_API_KEY. Panelists refer to issues by plain
 * title, so every TH-number is stripped before the text reaches a prompt.
 */
import type { ProjectItem } from "./types";

export const LINEAR_API = "https://api.linear.app/graphql";
export const PROJECTS_LOOKBACK_HOURS = 36;
export const PROJECTS_MAX = 8;
export const COMMENT_EXCERPT_CHARS = 280;
export const LINEAR_TEAM_KEY = "TH";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const QUERY = `query ($since: DateTimeOrDuration!, $team: String!, $first: Int!) {
  issues(first: $first, orderBy: updatedAt, filter: { team: { key: { eq: $team } }, updatedAt: { gt: $since } }) {
    nodes { identifier title updatedAt state { name } comments(first: 5) { nodes { body createdAt } } }
  }
}`;

/** "TH-31", "TH-47's", "(TH-66)" all go; the surrounding prose stays readable. */
export function stripIssueNumbers(s: string): string {
  return s
    .replace(/\(\s*TH-\d+\s*\)/gi, "")
    .replace(/\bTH-\d+(?:'s)?\b:?\s*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Markdown and links out, one line, cut on a word boundary. */
export function excerpt(md: string, max = COMMENT_EXCERPT_CHARS): string {
  const flat = stripIssueNumbers(
    md
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/[*\x60]/g, "")
      .replace(/[#>|]/g, " ")
      .replace(/\s+/g, " "),
  );
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6))}...`;
}

interface IssueNode {
  title?: string;
  updatedAt?: string;
  state?: { name?: string };
  comments?: { nodes?: { body?: string; createdAt?: string }[] };
}

/** Pure: the GraphQL JSON to ProjectItems. Anything malformed is dropped, never thrown. */
export function parseProjects(json: unknown): ProjectItem[] {
  const nodes = (json as { data?: { issues?: { nodes?: IssueNode[] } } })?.data?.issues?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .filter((n) => typeof n?.title === "string" && n.title.trim())
    .slice(0, PROJECTS_MAX)
    .map((n) => {
      const comments = (n.comments?.nodes ?? []).filter((c) => typeof c?.body === "string" && c.body.trim());
      comments.sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? ""));
      const item: ProjectItem = { title: stripIssueNumbers(n.title!), state: n.state?.name ?? "unknown", updatedAt: n.updatedAt ?? "" };
      if (comments[0]?.body) item.lastComment = excerpt(comments[0].body);
      return item;
    });
}

/** The lane. Empty when the key is unset, on any HTTP or GraphQL error, or on timeout. */
export async function fetchProjects(opts: { apiKey: string | undefined; now: Date; fetcher?: Fetcher; timeoutMs?: number; log?: (s: string) => void }): Promise<ProjectItem[]> {
  if (!opts.apiKey) return [];
  const since = new Date(opts.now.getTime() - PROJECTS_LOOKBACK_HOURS * 3_600_000).toISOString();
  const fetcher = opts.fetcher ?? fetch;
  try {
    const res = await fetcher(LINEAR_API, {
      method: "POST",
      // Linear personal API keys go in Authorization without a Bearer prefix.
      headers: { "content-type": "application/json", authorization: opts.apiKey },
      body: JSON.stringify({ query: QUERY, variables: { since, team: LINEAR_TEAM_KEY, first: PROJECTS_MAX } }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    if (!res.ok) {
      opts.log?.(`[email:context] projects: Linear answered ${res.status}`);
      return [];
    }
    return parseProjects(await res.json());
  } catch (e) {
    opts.log?.(`[email:context] projects: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}
