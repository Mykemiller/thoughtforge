/**
 * Podcast RSS 2.0 feed with the iTunes namespace (TH-39, PP-05). Pure: the route handler passes episodes in.
 * Only published episodes with an audio_url become <item>s (an <enclosure> is required). Enclosure length is
 * tf_episodes.audio_bytes, 0 while unknown.
 */
import { FALLBACK_SHOW, type PublishedEpisode } from "./episodes";

export const SITE = "https://faraday-thoughtforge.com";
export const FEED_PATH = "/podcast/feed.xml";
export const COVER_PATH = "/podcast/cover-3000.png";
export const FEED_AUTHOR = "ThoughtForge";
export const FEED_SUMMARY =
  "Three ThoughtForge advisors take the day's strongest datacenter signals, argue them in the open, and the Chief of Staff rules. Every claim carries an evidence grade. A Faraday Intelligence production.";

export function xmlEscape(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** HH:MM:SS for <itunes:duration>. */
export function itunesDuration(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Plain-text description from the show notes: drop Markdown links' URLs, headings and emphasis; cap length. */
export function plainSummary(e: PublishedEpisode, max = 3800): string {
  const notes = e.show_notes_md ?? "";
  const signals = e.signals.map((s) => `• ${s.title}${s.publisher ? ` (${s.publisher})` : ""}`).join("\n");
  const base = signals ? `Signals discussed:\n${signals}` : notes;
  const text = base
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`]/g, "")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function buildFeed(episodes: PublishedEpisode[], opts: { site?: string; now?: Date } = {}): string {
  const site = (opts.site ?? SITE).replace(/\/+$/, "");
  const playable = episodes.filter((e) => e.audio_url).sort((a, b) => b.published_at.localeCompare(a.published_at));
  const title = playable[0]?.show ?? FALLBACK_SHOW;
  const lastBuild = (playable[0] ? new Date(playable[0].published_at) : (opts.now ?? new Date())).toUTCString();
  const cover = `${site}${COVER_PATH}`;
  const items = playable.map((e) => {
    const link = `${site}/podcast/${encodeURIComponent(e.episode_id)}`;
    const dur = itunesDuration(e.duration_seconds);
    const summary = plainSummary(e);
    return [
      "    <item>",
      `      <title>${xmlEscape(e.title)}</title>`,
      `      <link>${xmlEscape(link)}</link>`,
      `      <guid isPermaLink="false">${xmlEscape(e.episode_id)}</guid>`,
      `      <pubDate>${new Date(e.published_at).toUTCString()}</pubDate>`,
      `      <description>${xmlEscape(summary)}</description>`,
      `      <enclosure url="${xmlEscape(e.audio_url!)}" length="${Math.max(0, Math.round(e.audio_bytes ?? 0))}" type="audio/mpeg"/>`,
      dur ? `      <itunes:duration>${dur}</itunes:duration>` : null,
      `      <itunes:summary>${xmlEscape(summary)}</itunes:summary>`,
      "      <itunes:explicit>false</itunes:explicit>",
      "      <itunes:episodeType>full</itunes:episodeType>",
      "    </item>",
    ].filter(Boolean).join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xmlEscape(title)}</title>`,
    `    <link>${site}/podcast</link>`,
    `    <atom:link href="${site}${FEED_PATH}" rel="self" type="application/rss+xml"/>`,
    `    <description>${xmlEscape(FEED_SUMMARY)}</description>`,
    "    <language>en-us</language>",
    `    <copyright>© ${new Date(lastBuild).getUTCFullYear()} Faraday Intelligence</copyright>`,
    `    <lastBuildDate>${lastBuild}</lastBuildDate>`,
    "    <image>",
    `      <url>${site}/podcast/cover-600.png</url>`,
    `      <title>${xmlEscape(title)}</title>`,
    `      <link>${site}/podcast</link>`,
    "    </image>",
    `    <itunes:author>${FEED_AUTHOR}</itunes:author>`,
    `    <itunes:summary>${xmlEscape(FEED_SUMMARY)}</itunes:summary>`,
    `    <itunes:image href="${cover}"/>`,
    "    <itunes:explicit>false</itunes:explicit>",
    '    <itunes:category text="Technology"/>',
    "    <itunes:type>episodic</itunes:type>",
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
