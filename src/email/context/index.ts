/**
 * buildDayContext (TH-66): every lane once per day, in parallel, each degrading to empty.
 * Fetchers are injected so tests run with no network; the defaults are the real ones.
 */
import type { DigestStore } from "../store";
import type { EmailPanelist } from "../types";
import { fetchNews } from "./news";
import { personalLanes } from "./personal";
import { fetchProjects, type Fetcher } from "./projects";
import { signalLaneFrom } from "./signal";
import { fetchSports } from "./sports";
import type { DayContext, DayThreadEntry, SlotContext } from "./types";

export * from "./types";

export interface LaneSources {
  /** Read-only Linear key (LINEAR_API_KEY). Unset: the projects lane is empty. */
  linearApiKey?: string;
  digests?: DigestStore;
  /** One fetch for every HTTP lane; tests pass a stub. */
  fetcher?: Fetcher;
  /** Skip every network lane (preview without keys, tests). */
  offline?: boolean;
  log?: (s: string) => void;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Never throws. `slugs` are today's panelists, so sports is fetched only for them. */
export async function buildDayContext(date: string, now: Date, panelists: readonly EmailPanelist[], slugs: readonly string[], src: LaneSources): Promise<DayContext> {
  const log = src.log;
  const personal = (() => {
    try {
      return personalLanes(panelists);
    } catch (e) {
      log?.(`[email:context] personal: ${errMsg(e)}`);
      return {};
    }
  })();
  const signalP = (async () => {
    try {
      return src.digests ? signalLaneFrom(await src.digests.latest(), date, now) : null;
    } catch (e) {
      log?.(`[email:context] signal: ${errMsg(e)}`);
      return null;
    }
  })();
  const teamsBySlug = Object.fromEntries(slugs.map((s) => [s, personal[s]?.teams ?? []]));
  const [projects, signal, news, sports] = await Promise.all([
    src.offline ? [] : fetchProjects({ apiKey: src.linearApiKey, now, fetcher: src.fetcher, log }),
    signalP,
    src.offline ? [] : fetchNews({ fetcher: src.fetcher, log }),
    src.offline ? {} : fetchSports({ date, teamsBySlug, fetcher: src.fetcher, log }).catch(() => ({})),
  ]);
  return { date, projects, signal, news, personal, sports };
}

/** The slice for one email: shared lanes, this panelist's personal lane and games, the day's thread so far. */
export function sliceFor(ctx: DayContext, slug: string, thread: DayThreadEntry[], answering?: DayThreadEntry): SlotContext {
  return {
    projects: ctx.projects,
    signal: ctx.signal,
    news: ctx.news,
    personal: ctx.personal[slug],
    sports: ctx.sports[slug] ?? [],
    thread,
    ...(answering ? { answering } : {}),
  };
}
