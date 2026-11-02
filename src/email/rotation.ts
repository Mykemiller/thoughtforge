/**
 * Chair rotation and cold-open selection (TH-31). Pure and deterministic.
 *
 * Dates are calendar dates in US Central (America/Chicago), YYYY-MM-DD.
 * Chair rotation is by calendar day, weekends included in the count, so the
 * chair for a weekday does not depend on which earlier days actually sent.
 */

export const ROTATION_EPOCH = "2026-11-03";
export const PANEL_TZ = "America/Chicago";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(date: string): { y: number; m: number; d: number } {
  const m = date.match(DATE_RE);
  if (!m) throw new Error(`rotation: "${date}" is not YYYY-MM-DD`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) throw new Error(`rotation: "${date}" is not a real date`);
  return { y, m: mo, d };
}

export function isValidDate(date: string): boolean {
  try {
    parseDate(date);
    return true;
  } catch {
    return false;
  }
}

const utcMs = (date: string) => {
  const { y, m, d } = parseDate(date);
  return Date.UTC(y, m - 1, d);
};

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMs(to) - utcMs(from)) / 86_400_000);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(utcMs(date)).getUTCDay();
}

export const isWeekend = (date: string) => [0, 6].includes(weekdayOf(date));
/** Cold opens go out Tuesday and Thursday only. */
export const isColdOpenDay = (date: string) => [2, 4].includes(weekdayOf(date));

/** The calendar date in US Central at instant `now`. */
export function centralDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PANEL_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Chair for a date = order[daysSince(2026-11-03) mod 10]. */
export function chairFor(date: string, order: readonly string[]): string {
  if (!order.length) throw new Error("rotation: empty order");
  return order[mod(daysBetween(ROTATION_EPOCH, date), order.length)];
}

/** ISO 8601 week-numbering year and week for a date. */
export function isoWeek(date: string): { year: number; week: number } {
  const t = new Date(utcMs(date));
  const day = t.getUTCDay() || 7; // Mon=1..Sun=7
  t.setUTCDate(t.getUTCDate() + 4 - day); // Thursday of this ISO week decides the year
  const year = t.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((t.getTime() - jan1) / 86_400_000 + 1) / 7);
  return { year, week };
}

/** mulberry32: small, well-known seeded PRNG; enough for picking one of ten. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cold-open sender: a seeded random panelist, seed = ISO year * 100 + ISO week.
 * The seed is per week, so Tuesday and Thursday of one ISO week share a sender.
 */
export function coldOpenSenderFor(date: string, order: readonly string[]): string {
  if (!order.length) throw new Error("rotation: empty order");
  const { year, week } = isoWeek(date);
  const rand = mulberry32(year * 100 + week);
  return order[Math.floor(rand() * order.length)];
}
