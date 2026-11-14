/**
 * Panel Podcast public episode model (TH-39, PP-05). Pure: no I/O, importable by tests and by server components.
 *
 * A PublishedEpisode is a tf_episodes row with status 'published' as the anon key sees it (RLS from PP-03). The
 * script, cast and signals columns are jsonb; they are narrowed here so a malformed row degrades (no transcript,
 * no signals) instead of crashing a public page.
 */
import { scriptSchema, type EpisodeScript } from "../lib/podcast/script-schema";

export const FALLBACK_SHOW = "ThoughtForge: The Signal"; // until TH-35 rules on the show name
export const PAGE_SIZE = 20;

/** Columns the public pages read. Never select signals.considered internals beyond what is rendered. */
export const PUBLIC_COLUMNS =
  "episode_id,show,title,digest_date,status,cast,signals,script,show_notes_md,audio_url,audio_bytes,duration_seconds,published_at";

export interface EpisodeSignal {
  signal_id: string;
  title: string;
  source_url: string | null;
  publisher: string | null;
  domain: string | null;
}

export interface CastSlot { slug: string; role: "chair" | "voice" }

export interface PublishedEpisode {
  episode_id: string;
  show: string;
  title: string;
  digest_date: string | null;
  cast: CastSlot[];
  signals: EpisodeSignal[];
  script: EpisodeScript | null;
  show_notes_md: string | null;
  audio_url: string | null;
  audio_bytes: number | null;
  duration_seconds: number | null;
  published_at: string; // ISO
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

export function showName(show: unknown): string {
  return str(show) ?? FALLBACK_SHOW;
}

function castOf(v: unknown): CastSlot[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is Raw => !!c && typeof c === "object" && typeof (c as Raw).slug === "string")
    .map((c) => ({ slug: c.slug as string, role: c.role === "chair" ? "chair" : "voice" }));
}

function signalsOf(v: unknown): EpisodeSignal[] {
  const sel = v && typeof v === "object" ? (v as Raw).selected : null;
  if (!Array.isArray(sel)) return [];
  return sel
    .filter((s): s is Raw => !!s && typeof s === "object" && typeof (s as Raw).title === "string")
    .map((s) => ({
      signal_id: str(s.signal_id) ?? "",
      title: s.title as string,
      source_url: str(s.source_url) && /^https?:\/\//.test(s.source_url as string) ? (s.source_url as string) : null,
      publisher: str(s.publisher),
      domain: str(s.idf_domain),
    }));
}

/** Normalize one row. Returns null for anything that is not a published episode with a publish time. */
export function toPublishedEpisode(row: Raw): PublishedEpisode | null {
  if (row.status !== "published") return null;
  const id = str(row.episode_id);
  const published = str(row.published_at);
  if (!id || !published || Number.isNaN(Date.parse(published))) return null;
  const parsed = row.script ? scriptSchema.safeParse(row.script) : null;
  return {
    episode_id: id,
    show: showName(row.show),
    title: str(row.title) ?? id,
    digest_date: str(row.digest_date),
    cast: castOf(row.cast),
    signals: signalsOf(row.signals),
    script: parsed?.success ? parsed.data : null,
    show_notes_md: str(row.show_notes_md),
    audio_url: str(row.audio_url) && /^https?:\/\//.test(row.audio_url as string) ? (row.audio_url as string) : null,
    audio_bytes: num(row.audio_bytes),
    duration_seconds: num(row.duration_seconds),
    published_at: new Date(published).toISOString(),
  };
}

/** Newest first: published_at desc, then episode_id desc for ties. */
export function sortNewestFirst(a: PublishedEpisode, b: PublishedEpisode): number {
  return b.published_at.localeCompare(a.published_at) || b.episode_id.localeCompare(a.episode_id);
}

/** Keyset page over an in-memory list (the mock source and tests). Cursor = published_at of the last row seen. */
export function pageOf(all: PublishedEpisode[], limit: number, cursor?: string | null): { items: PublishedEpisode[]; nextCursor: string | null } {
  const sorted = [...all].sort(sortNewestFirst);
  const start = cursor ? sorted.filter((e) => e.published_at < cursor) : sorted;
  const items = start.slice(0, limit);
  return { items, nextCursor: start.length > limit ? items[items.length - 1].published_at : null };
}

export function isCursor(v: unknown): v is string {
  return typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);
}

/** "November 8, 2026" in US Central. */
export function dateCT(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
}

export function mmss(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Speaker-labelled paragraphs for the transcript disclosure. */
export function transcript(script: EpisodeScript, names: Record<string, string>): { speaker: string; name: string; text: string }[] {
  return script.segments.flatMap((seg) => seg.turns.map((t) => ({ speaker: t.speaker, name: names[t.speaker] ?? t.speaker, text: t.text })));
}
