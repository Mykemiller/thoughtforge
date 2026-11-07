/**
 * signal lane (TH-66): the newest tf_signal_digests row within four days (TF-DEC-100), top five items.
 */
import type { DigestRow } from "../types";
import type { SignalLane } from "./types";

export const SIGNAL_MAX_AGE_DAYS = 4;
export const SIGNAL_TOP_ITEMS = 5;
export const SIGNAL_ITEM_MAX_CHARS = 400;

const dayMs = 86_400_000;
const utcDay = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Numbered or bulleted lines first; otherwise the first substantial paragraphs. Forward headers are skipped. */
export function topItems(text: string, n = SIGNAL_TOP_ITEMS): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const listed = lines
    .map((l) => l.match(/^\s*(?:\d+[.)]|[-*•])\s+(.{20,})$/)?.[1]?.trim())
    .filter((l): l is string => Boolean(l));
  const pool = listed.length
    ? listed
    : text
        .split(/\n{2,}/)
        .map((p) => p.replace(/\s+/g, " ").trim())
        .filter((p) => p.length >= 40 && !/^(-{3,}|from:|subject:|to:|date:)/i.test(p));
  return pool.slice(0, n).map((s) => (s.length > SIGNAL_ITEM_MAX_CHARS ? `${s.slice(0, SIGNAL_ITEM_MAX_CHARS)}...` : s));
}

/** Pure. `date` is the day's US Central date; `now` decides "fresh" (ingested in the last 24 hours, else edition dated today or yesterday). */
export function signalLaneFrom(row: (DigestRow & { ingested_at?: string | null }) | null, date: string, now: Date): SignalLane | null {
  if (!row || !row.raw_text?.trim()) return null;
  const age = Math.round((utcDay(date) - utcDay(row.digest_date)) / dayMs);
  if (!Number.isFinite(age) || age < 0 || age > SIGNAL_MAX_AGE_DAYS) return null;
  const items = topItems(row.raw_text);
  if (!items.length) return null;
  const ingested = row.ingested_at ? Date.parse(row.ingested_at) : NaN;
  const fresh = Number.isFinite(ingested) ? now.getTime() - ingested <= dayMs && now.getTime() >= ingested : age <= 1;
  return { editionDate: row.digest_date, subject: row.subject || "Faraday Daily Signal Digest", items, fresh };
}
