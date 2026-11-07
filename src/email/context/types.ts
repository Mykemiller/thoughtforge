/**
 * Context lanes for the panel day (TH-66). One DayContext is built per day; each email gets
 * the slice its slot needs (SlotContext). Every lane degrades to empty and never throws; the
 * composer is told what is in front of the panelist, never what is missing.
 */

/** A Linear issue on team TH that moved in the last 36 hours. Plain title only: no TH-number. */
export interface ProjectItem {
  title: string;
  state: string;
  /** Up to 280 characters of the newest comment, TH-numbers stripped. */
  lastComment?: string;
  updatedAt: string;
}

/** The newest Signal Digest within four days (TF-DEC-100), cut to its top items. */
export interface SignalLane {
  editionDate: string;
  subject: string;
  /** At most five items, in digest order. */
  items: string[];
  /** True when the edition landed in the 24 hours before the day's run (the 16:30 slot may then be a roundtable). */
  fresh: boolean;
}

/** One current news item (GDELT DOC artlist). Title and outlet only: article text is never reproduced. */
export interface NewsItem {
  title: string;
  domain: string;
  url: string;
  seen: string;
}

/** What a panelist's v2 dossier says about life outside work. All fictional people. */
export interface PersonalLane {
  sports: string;
  hobbies: string;
  laughs: string;
  places: string;
  /** "Paul Reyes, Husband (married 2004). High school history teacher in Evanston." per line. */
  family: string[];
  /** Team display names this panelist follows, matched to the scores feed. */
  teams: string[];
}

/** A finished game from last night for a team a panelist follows. Only real, fetched results. */
export interface GameResult {
  team: string;
  opponent: string;
  teamScore: number;
  opponentScore: number;
  /** "W", "L" or "T". */
  result: "W" | "L" | "T";
  league: string;
}

export interface DayContext {
  date: string;
  projects: ProjectItem[];
  signal: SignalLane | null;
  news: NewsItem[];
  /** By panelist slug. */
  personal: Record<string, PersonalLane>;
  /** By panelist slug: last night's finished games for their teams. */
  sports: Record<string, GameResult[]>;
}

/** One earlier email of the day, as later slots see it. */
export interface DayThreadEntry {
  author: string;
  firstName: string;
  slot: string;
  subject: string;
  body: string;
  messageId: string;
}

/** The slice one email is composed with. */
export interface SlotContext {
  projects: ProjectItem[];
  signal: SignalLane | null;
  news: NewsItem[];
  personal?: PersonalLane;
  sports: GameResult[];
  /** Today's earlier emails, slot order. */
  thread: DayThreadEntry[];
  /** For thread-reply: the email being answered. */
  answering?: DayThreadEntry;
}

export const emptyDayContext = (date: string): DayContext => ({ date, projects: [], signal: null, news: [], personal: {}, sports: {} });
