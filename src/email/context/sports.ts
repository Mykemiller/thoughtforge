/**
 * sports lane (TH-66): last night's finished games for the teams today's panelists follow,
 * from ESPN's public scoreboard JSON (one fetch per league needed, no key). When the feed is
 * down or a team did not play, the lane is simply empty for that team and the prompt forbids
 * inventing a result.
 */
import type { Fetcher } from "./projects";
import type { GameResult } from "./types";

export const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
export const SPORTS_MAX_LEAGUES = 6;

export interface TeamEntry {
  /** Matched against the dossier's "Sports:" bullet. */
  match: RegExp;
  /** ESPN team displayName. */
  team: string;
  /** ESPN path: sport/league. */
  path: string;
  /** ESPN `groups` query value for college scoreboards (80 FBS, 81 FCS, 50 Division I basketball). */
  groups?: string;
}

/** The teams the ten v2 dossiers name. Fictional fans, real public teams (TF-DEC-45 public settings). */
export const TEAM_CATALOG: readonly TeamEntry[] = [
  { match: /Ohio State football/i, team: "Ohio State Buckeyes", path: "football/college-football", groups: "80" },
  { match: /Wisconsin basketball/i, team: "Wisconsin Badgers", path: "basketball/mens-college-basketball", groups: "50" },
  { match: /\bOrioles\b/, team: "Baltimore Orioles", path: "baseball/mlb" },
  { match: /\bRavens\b/, team: "Baltimore Ravens", path: "football/nfl" },
  // "Cubs fan", not "tolerates Delia's Cubs".
  { match: /\bCubs fan\b/i, team: "Chicago Cubs", path: "baseball/mlb" },
  { match: /\bSeahawks\b/, team: "Seattle Seahawks", path: "football/nfl" },
  { match: /\bMariners\b/, team: "Seattle Mariners", path: "baseball/mlb" },
  { match: /\bUVA basketball\b/i, team: "Virginia Cavaliers", path: "basketball/mens-college-basketball", groups: "50" },
  { match: /North Dakota State football/i, team: "North Dakota State Bison", path: "football/college-football", groups: "81" },
  { match: /Colorado Avalanche/i, team: "Colorado Avalanche", path: "hockey/nhl" },
  { match: /VfB Stuttgart/i, team: "VfB Stuttgart", path: "soccer/ger.1" },
  { match: /\bChiefs\b/, team: "Kansas City Chiefs", path: "football/nfl" },
  { match: /\bthe Wild\b/i, team: "Minnesota Wild", path: "hockey/nhl" },
  { match: /\bLynx\b/, team: "Minnesota Lynx", path: "basketball/wnba" },
  { match: /\bWhite Sox\b/, team: "Chicago White Sox", path: "baseball/mlb" },
  { match: /\bBlackhawks\b/, team: "Chicago Blackhawks", path: "hockey/nhl" },
  { match: /Duke basketball/i, team: "Duke Blue Devils", path: "basketball/mens-college-basketball", groups: "50" },
];

export function teamsIn(sportsLine: string): string[] {
  return TEAM_CATALOG.filter((t) => t.match.test(sportsLine)).map((t) => t.team);
}

const entryFor = (team: string) => TEAM_CATALOG.find((t) => t.team === team);

/** "2026-11-09" -> "20261108": the evening before the day being planned. */
export function lastNight(date: string): string {
  const d = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function scoreboardUrl(entry: Pick<TeamEntry, "path" | "groups">, yyyymmdd: string): string {
  const p = new URLSearchParams({ dates: yyyymmdd });
  if (entry.groups) p.set("groups", entry.groups);
  if (entry.path.startsWith("football/college") || entry.path.startsWith("basketball/mens-college")) p.set("limit", "400");
  return `${ESPN_BASE}/${entry.path}/scoreboard?${p.toString()}`;
}

interface Competitor {
  team?: { displayName?: string };
  score?: string | number | { value?: number };
}
interface EspnEvent {
  status?: { type?: { completed?: boolean } };
  competitions?: { competitors?: Competitor[]; status?: { type?: { completed?: boolean } } }[];
}

const scoreOf = (c: Competitor): number => {
  const s = c.score;
  const n = typeof s === "object" && s !== null ? Number(s.value) : Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/** Pure: finished games in a scoreboard JSON for any of `teams`. Unfinished or unscored games are dropped. */
export function parseScoreboard(json: unknown, teams: readonly string[], league: string): GameResult[] {
  const events = (json as { events?: EspnEvent[] })?.events;
  if (!Array.isArray(events)) return [];
  const out: GameResult[] = [];
  for (const ev of events) {
    const comp = ev?.competitions?.[0];
    const completed = ev?.status?.type?.completed ?? comp?.status?.type?.completed;
    if (!completed || !comp?.competitors || comp.competitors.length !== 2) continue;
    for (const [i, c] of comp.competitors.entries()) {
      const name = c.team?.displayName;
      if (!name || !teams.includes(name)) continue;
      const other = comp.competitors[1 - i];
      const a = scoreOf(c);
      const b = scoreOf(other);
      if (!Number.isFinite(a) || !Number.isFinite(b) || !other.team?.displayName) continue;
      out.push({ team: name, opponent: other.team.displayName, teamScore: a, opponentScore: b, result: a > b ? "W" : a < b ? "L" : "T", league });
    }
  }
  return out;
}

/** By slug: last night's finished games for each panelist's teams. A failed league fetch only empties that league. */
export async function fetchSports(opts: {
  date: string;
  teamsBySlug: Record<string, string[]>;
  fetcher?: Fetcher;
  timeoutMs?: number;
  log?: (s: string) => void;
}): Promise<Record<string, GameResult[]>> {
  const fetcher = opts.fetcher ?? fetch;
  const night = lastNight(opts.date);
  const wanted = [...new Set(Object.values(opts.teamsBySlug).flat())];
  const leagues = new Map<string, { entry: TeamEntry; teams: string[] }>();
  for (const team of wanted) {
    const e = entryFor(team);
    if (!e) continue;
    const key = `${e.path}|${e.groups ?? ""}`;
    const cur = leagues.get(key);
    if (cur) cur.teams.push(team);
    else leagues.set(key, { entry: e, teams: [team] });
  }
  const results = await Promise.all(
    [...leagues.values()].slice(0, SPORTS_MAX_LEAGUES).map(async ({ entry, teams }) => {
      try {
        const res = await fetcher(scoreboardUrl(entry, night), { signal: AbortSignal.timeout(opts.timeoutMs ?? 5000) });
        if (!res.ok) {
          opts.log?.(`[email:context] sports: ${entry.path} answered ${res.status}`);
          return [];
        }
        return parseScoreboard(await res.json(), teams, entry.path.split("/")[1]);
      } catch (e) {
        opts.log?.(`[email:context] sports: ${entry.path}: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      }
    }),
  );
  const games = results.flat();
  return Object.fromEntries(Object.entries(opts.teamsBySlug).map(([slug, teams]) => [slug, games.filter((g) => teams.includes(g.team))]));
}
