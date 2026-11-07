/**
 * The panel day (TH-66). Pure and deterministic: a date and the cast order give the same
 * slots, panelists and send times every time.
 *
 * Weekdays (America/Chicago): 07:00 morning-note (the TH-31 chair), 10:30 thread-reply,
 * 12:45 aside, 16:30 signal-or-news, and on Tue/Thu the cold-open at 08:30. Saturday: one
 * weekend-note at 09:00. Sunday: nothing. Nobody appears twice in a day.
 *
 * Panelists, with n = days since the rotation epoch and i = the chair's index:
 *   morning-note   order[i]       (chairFor, unchanged from TH-31)
 *   thread-reply   order[i + 3]
 *   aside          order[i + 6]
 *   signal-or-news order[i + 8]
 *   weekend-note   order[i]       (Saturday's own chair)
 *   cold-open      coldOpenSenderFor (TH-31), moved to the next free panelist in cast order on a clash.
 * Over Monday to Saturday the offsets {0, 3, 6, 8} on five weekdays plus Saturday's chair put
 * every one of ten panelists on at least two emails a week (day-plan.test.ts checks a year).
 */
import { chairFor, coldOpenSenderFor, daysBetween, isColdOpenDay, parseDate, PANEL_TZ, ROTATION_EPOCH, weekdayOf } from "./rotation";
import type { DaySlot, EmailKind } from "./types";

export const DEFAULT_MAX_DAILY = 5;

/** Local send time per slot, America/Chicago. */
export const SLOT_TIMES: Record<DaySlot, string> = {
  "morning-note": "07:00",
  "cold-open": "08:30",
  "thread-reply": "10:30",
  aside: "12:45",
  "signal-or-news": "16:30",
  "weekend-note": "09:00",
};

/** Offset from the chair's index in cast order. */
export const SLOT_OFFSETS: Partial<Record<DaySlot, number>> = { "morning-note": 0, "thread-reply": 3, aside: 6, "signal-or-news": 8, "weekend-note": 0 };

/** When PANEL_MAX_DAILY is below the day's slot count, slots are kept in this order. */
export const SLOT_PRIORITY: readonly DaySlot[] = ["morning-note", "weekend-note", "thread-reply", "signal-or-news", "aside", "cold-open"];

/** Words asked of the model per slot (the issue's ranges). */
export const SLOT_WORDS: Record<DaySlot, [number, number]> = {
  "morning-note": [180, 300],
  "cold-open": [120, 220],
  "thread-reply": [80, 160],
  aside: [50, 120],
  "signal-or-news": [120, 220],
  "weekend-note": [60, 120],
};

export interface PlannedSlot {
  slot: DaySlot;
  slug: string;
  /** "07:00", America/Chicago. */
  local: string;
  /** The same instant in UTC, ISO 8601. */
  at: string;
  /** Decided when the day runs (signal-or-news becomes signal-takeaway roundtable or news-take). */
  kind?: EmailKind;
  /** Our own Message-ID, assigned before anything is sent so later slots can reference it. */
  messageId?: string;
  /** For thread-reply: the slot it answers. */
  replyToSlot?: DaySlot;
  subject?: string;
  /** Composed text, kept so a resumed day can thread later slots on it. */
  body?: string;
  status?: "scheduled" | "sent" | "skipped" | "failed";
  resendId?: string;
  reason?: string;
}

export interface PanelDay {
  date: string;
  weekday: number;
  slots: PlannedSlot[];
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** UTC offset of America/Chicago at an instant, in minutes (e.g. -360 for CST). */
export function tzOffsetMinutes(instant: number, timeZone = PANEL_TZ): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant) / 60_000);
}

/** "2026-11-09" + "10:30" Central -> "2026-11-09T16:30:00.000Z". DST-correct. */
export function centralToUtc(date: string, hhmm: string): string {
  const { y, m, d } = parseDate(date);
  const [hh, mm] = hhmm.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let t = naive - tzOffsetMinutes(naive) * 60_000;
  t = naive - tzOffsetMinutes(t) * 60_000; // second pass settles a DST edge
  return new Date(t).toISOString();
}

export function slotsFor(date: string): DaySlot[] {
  const wd = weekdayOf(date);
  if (wd === 0) return [];
  if (wd === 6) return ["weekend-note"];
  const s: DaySlot[] = ["morning-note"];
  if (isColdOpenDay(date)) s.push("cold-open");
  s.push("thread-reply", "aside", "signal-or-news");
  return s;
}

/** Keeps at most `max` slots by SLOT_PRIORITY, then returns them in time order. */
export function capSlots(slots: DaySlot[], max: number): DaySlot[] {
  const n = Math.max(1, Math.floor(max));
  const keep = new Set([...slots].sort((a, b) => SLOT_PRIORITY.indexOf(a) - SLOT_PRIORITY.indexOf(b)).slice(0, n));
  return slots.filter((s) => keep.has(s));
}

/** The whole day. `order` is EMAIL_ORDER (cast order). */
export function planDay(date: string, order: readonly string[], opts: { maxDaily?: number } = {}): PanelDay {
  if (order.length < 5) throw new Error("day-plan: the panel needs at least five panelists for a weekday");
  const weekday = weekdayOf(date);
  const slots = capSlots(slotsFor(date), opts.maxDaily ?? DEFAULT_MAX_DAILY);
  const chairIdx = order.indexOf(chairFor(date, order));
  const used = new Set<string>();
  const planned: PlannedSlot[] = [];
  for (const slot of slots) {
    let slug: string;
    if (slot === "cold-open") {
      const others = new Set(slots.filter((s) => s !== "cold-open").map((s) => order[mod(chairIdx + (SLOT_OFFSETS[s] ?? 0), order.length)]));
      const start = order.indexOf(coldOpenSenderFor(date, order));
      let k = 0;
      while (others.has(order[mod(start + k, order.length)]) || used.has(order[mod(start + k, order.length)])) k++;
      slug = order[mod(start + k, order.length)];
    } else {
      slug = order[mod(chairIdx + (SLOT_OFFSETS[slot] ?? 0), order.length)];
    }
    if (used.has(slug)) throw new Error(`day-plan: ${slug} would appear twice on ${date}`);
    used.add(slug);
    const local = SLOT_TIMES[slot];
    planned.push({ slot, slug, local, at: centralToUtc(date, local), ...(slot === "thread-reply" && slots.includes("morning-note") ? { replyToSlot: "morning-note" as DaySlot } : {}) });
  }
  planned.sort((a, b) => a.at.localeCompare(b.at));
  return { date, weekday, slots: planned };
}

/** Days since the rotation epoch, exposed for tests and the preview header. */
export const dayIndex = (date: string) => daysBetween(ROTATION_EPOCH, date);
