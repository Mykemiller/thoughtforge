// Offline tests for the Podcast Library, home card and RSS feed (Linear TH-39, PP-05). Run: npm test
// Renders the presentational components with the TF_MOCK fixtures (fixtures/podcast/library.json); no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { EpisodeList } from "../components/podcast/EpisodeList";
import { EpisodeView } from "../components/podcast/EpisodeView";
import { LatestEpisodeCard } from "../components/podcast/LatestEpisodeCard";
import { PANEL } from "../data/panel";
import { FALLBACK_SHOW, dateCT, isCursor, mmss, pageOf, toPublishedEpisode, type PublishedEpisode } from "./episodes";
import { buildFeed, itunesDuration, xmlEscape } from "./feed";

const ROOT = resolve(import.meta.dirname, "..", "..");
const library = JSON.parse(readFileSync(join(ROOT, "fixtures/podcast/library.json"), "utf8")) as { episodes: Record<string, unknown>[] };
const published = library.episodes.map(toPublishedEpisode).filter((e): e is PublishedEpisode => e !== null);
const [newest, older] = pageOf(published, 20).items;

test("only published rows with a publish time survive normalization; the draft never renders", () => {
  assert.equal(library.episodes.length, 3);
  assert.deepEqual(published.map((e) => e.episode_id).sort(), ["PP-20261031-01", "PP-20261107-01"]);
  assert.equal(toPublishedEpisode({ ...library.episodes[0], published_at: null }), null);
  assert.equal(toPublishedEpisode({ ...library.episodes[0], status: "approved" }), null);
  assert.equal(toPublishedEpisode({ ...library.episodes[0], audio_url: "http://insecure.example/a.mp3" })?.audio_url, null, "https audio only");
});

test("show name comes from tf_episodes.show, falling back to ThoughtForge: The Signal", () => {
  assert.equal(newest.show, "The ThoughtForge Panel");
  assert.equal(older.show, FALLBACK_SHOW);
  assert.equal(FALLBACK_SHOW, "ThoughtForge: The Signal");
});

test("newest first, 20 per page, keyset cursor on published_at", () => {
  assert.equal(newest.episode_id, "PP-20261107-01");
  const many = Array.from({ length: 23 }, (_, i) => ({ ...newest, episode_id: `PP-202610${String(i + 1).padStart(2, "0")}-01`, published_at: new Date(Date.UTC(2026, 9, i + 1)).toISOString() }));
  const p1 = pageOf(many, 20);
  assert.equal(p1.items.length, 20);
  assert.equal(p1.items[0].episode_id, "PP-20261023-01");
  assert.ok(p1.nextCursor);
  const p2 = pageOf(many, 20, p1.nextCursor);
  assert.deepEqual(p2.items.map((e) => e.episode_id), ["PP-20261003-01", "PP-20261002-01", "PP-20261001-01"]);
  assert.equal(p2.nextCursor, null);
  assert.ok(isCursor(p1.nextCursor));
  assert.ok(!isCursor("'; drop table x; --"));
});

test("dates render in US Central and durations as mm:ss", () => {
  assert.equal(dateCT("2026-11-08T03:30:00Z"), "November 7, 2026"); // 21:30 CST the day before
  assert.equal(mmss(742), "12:22");
  assert.equal(mmss(null), null);
  assert.equal(itunesDuration(742), "00:12:22");
});

test("/podcast list renders rows with date, duration, headshots, play button and a link to the episode", () => {
  const html = renderToString(createElement(EpisodeList, { items: [newest, older], nextCursor: null }));
  assert.match(html, /November 8, 2026/);
  assert.match(html, /12:22/);
  assert.match(html, /href="\/podcast\/PP-20261107-01"/);
  assert.match(html, /gilbert-faraday-thumb\.webp/);
  assert.match(html, /aria-label="Play: November 7, 2026/);
  assert.match(html, /cover-600\.png/);
  assert.doesNotMatch(html, /Unpublished draft/);
  assert.doesNotMatch(html, /Older episodes/);
});

test("/podcast empty state when nothing is published", () => {
  const html = renderToString(createElement(EpisodeList, { items: [], nextCursor: null }));
  assert.match(html, /first episode is in production/);
});

test("episode page: notes as sanitized Markdown, signals open in a new tab, cast links, transcript disclosure", () => {
  const evil = { ...newest, show_notes_md: `${newest.show_notes_md}\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))` };
  const html = renderToString(createElement(EpisodeView, { e: evil }));
  assert.match(html, /<h1[^>]*>November 7, 2026: Power Architecture/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /href="\/panel\/albert-thorne"/);
  assert.match(html, /<details[^>]*><summary[^>]*>Transcript<\/summary>/);
  assert.match(html, /Gilbert Faraday:<\/span> Good morning/);
  assert.match(html, /Show notes/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /javascript:alert/);
});

test("home card renders the latest episode and renders nothing when there is none", () => {
  const html = renderToString(createElement(LatestEpisodeCard, { episode: newest }));
  assert.match(html, /LATEST EPISODE/);
  assert.match(html, /Podcast Library/);
  assert.match(html, /Play episode/);
  assert.match(html, /min-h-\[168px\]/); // reserved height
  assert.equal(renderToString(createElement(LatestEpisodeCard, { episode: null })), "");
});

test("pages render only manifest names (real-name audit surface)", () => {
  const html = renderToString(createElement(EpisodeView, { e: newest }));
  const names = new Set(PANEL.map((p) => p.name));
  for (const m of html.matchAll(/<span class="font-semibold text-primary">([^<:]+):<\/span>/g)) assert.ok(names.has(m[1]), `unexpected speaker ${m[1]}`);
});

// ------------------------------------------------------------------------------------------------ feed

function parseFeed(xml: string) {
  const valid = XMLValidator.validate(xml);
  assert.equal(valid, true, JSON.stringify(valid));
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" }).parse(xml);
}

test("feed.xml is well-formed RSS 2.0 with the required channel and iTunes fields", () => {
  const doc = parseFeed(buildFeed(published));
  assert.equal(doc.rss["@version"], "2.0");
  assert.equal(doc.rss["@xmlns:itunes"], "http://www.itunes.com/dtds/podcast-1.0.dtd");
  const ch = doc.rss.channel;
  for (const k of ["title", "link", "description", "language", "itunes:author", "itunes:summary", "itunes:explicit", "itunes:type"]) assert.ok(ch[k] !== undefined, `channel ${k}`);
  assert.equal(ch["itunes:author"], "ThoughtForge");
  assert.equal(ch["itunes:explicit"], false);
  assert.equal(ch["itunes:category"]["@text"], "Technology");
  assert.equal(ch["itunes:image"]["@href"], "https://faraday-thoughtforge.com/podcast/cover-3000.png");
  assert.equal(ch["atom:link"]["@href"], "https://faraday-thoughtforge.com/podcast/feed.xml");
  assert.equal(ch.title, "The ThoughtForge Panel");
});

test("feed items: enclosure url/length/type, guid not a permalink, pubDate, itunes:duration; null audio_bytes -> length 0", () => {
  const items = parseFeed(buildFeed(published)).rss.channel.item;
  assert.equal(items.length, 2);
  const [a, b] = items;
  assert.equal(a.guid["#text"], "PP-20261107-01");
  assert.equal(a.guid["@isPermaLink"], "false");
  assert.equal(a.enclosure["@type"], "audio/mpeg");
  assert.equal(a.enclosure["@length"], "11872000");
  assert.match(a.enclosure["@url"], /^https:\/\/episodes\.example\.invalid\/episodes\/PP-20261107-01\/audio\.mp3$/);
  assert.equal(a.pubDate, "Sun, 08 Nov 2026 13:30:00 GMT");
  assert.equal(a["itunes:duration"], "00:12:22");
  assert.equal(a.link, "https://faraday-thoughtforge.com/podcast/PP-20261107-01");
  assert.equal(b.enclosure["@length"], "0");
});

test("feed with zero episodes is still a valid channel; episodes without audio are left out", () => {
  const empty = parseFeed(buildFeed([]));
  assert.equal(empty.rss.channel.title, FALLBACK_SHOW);
  assert.equal(empty.rss.channel.item, undefined);
  const noAudio = parseFeed(buildFeed([{ ...newest, audio_url: null }]));
  assert.equal(noAudio.rss.channel.item, undefined);
});

test("feed escapes XML special characters", () => {
  assert.equal(xmlEscape(`a & b < c > "d" 'e'`), "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;");
  const xml = buildFeed([{ ...newest, title: "Power & <Cooling> \"now\"" }]);
  assert.equal(parseFeed(xml).rss.channel.item.title, `Power & <Cooling> "now"`);
});
