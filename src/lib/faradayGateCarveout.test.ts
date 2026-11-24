/**
 * FDY-433 (ADM-1.7h): the Panel Podcast feed stays public in every gate mode; the Panel pages stay gated.
 * No network. The end-to-end version (real `next start` against a mock estate_entitled) is
 * scripts/faraday-gate-carveout-smoke.mjs.
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { clearGateCache } from "../../lib/faraday-gate/server/check";
import { buildFeed } from "../podcast/feed";
import { toPublishedEpisode, type PublishedEpisode } from "../podcast/episodes";
import { TF_GATE_PUBLIC_PATHS, tfGateDecision } from "./faradayGate";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

beforeEach(() => clearGateCache());

test("the feed is a route handler: no page or layout of its own that a gate could wrap", () => {
  assert.ok(exists("app/podcast/feed.xml/route.ts"));
  for (const f of ["page.tsx", "layout.tsx", "page.ts", "layout.ts"]) assert.ok(!exists(`app/podcast/feed.xml/${f}`), f);
  assert.doesNotMatch(read("app/podcast/feed.xml/route.ts"), /faradayGate|FaradayGateBoundary|tfGateApiDenial/);
});

test("the cover art the feed points at is a static file in public/", () => {
  for (const p of TF_GATE_PUBLIC_PATHS.filter((x) => x.endsWith(".png"))) assert.ok(exists(`public${p}`), p);
});

test("the magic-word wall in proxy.ts never matches /podcast", () => {
  const m = read("proxy.ts").match(/matcher:\s*\[([^\]]*)\]/);
  assert.ok(m, "proxy.ts has a matcher");
  const entries = [...m![1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  assert.ok(entries.length > 0);
  for (const e of entries) {
    assert.ok(!e.startsWith("/podcast"), `matcher entry ${e} would cover the podcast`);
    assert.ok(e !== "/" && !e.startsWith("/:") && !e.startsWith("/("), `matcher entry ${e} is a catch-all`);
  }
});

test("the Panel surfaces stay behind the gate", () => {
  for (const l of ["app/podcast/layout.tsx", "app/ask/layout.tsx", "app/interview/layout.tsx"]) assert.match(read(l), /<FaradayGateBoundary/, l);
  for (const r of ["app/api/ask/route.ts", "app/api/interview/route.ts"]) assert.match(read(r), /tfGateApiDenial/, r);
});

test("the feed renders valid RSS with an enclosure per published episode", () => {
  const library = JSON.parse(read("fixtures/podcast/library.json")) as { episodes: Record<string, unknown>[] };
  const published = library.episodes.map(toPublishedEpisode).filter((e): e is PublishedEpisode => e !== null);
  const xml = buildFeed(published);
  assert.match(xml, /^<\?xml version="1.0"/);
  assert.match(xml, /<rss [^>]*version="2.0"/);
  assert.equal((xml.match(/<enclosure url="https:\/\//g) ?? []).length, published.filter((e) => e.audio_url).length);
  assert.match(xml, /<\/rss>\s*$/);
});

test("mode invite + FARADAY_GATE_ENFORCE=1: a stranger is turned away from the Panel pages", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ allowed: false, reason: "no_grant", mode: "invite" }), { status: 200 })) as unknown as typeof fetch;
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://ycadmmngkdhvpcsrcuaq.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", FARADAY_GATE_ENFORCE: "1" };
  const d = await tfGateDecision({ cookieHeader: null }, { env, fetchImpl });
  assert.equal(d.pass, false);
});

test("mode open: the Panel pages pass straight through", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ allowed: true, reason: "open", mode: "open" }), { status: 200 })) as unknown as typeof fetch;
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://ycadmmngkdhvpcsrcuaq.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc", FARADAY_GATE_ENFORCE: "1" };
  const d = await tfGateDecision({ cookieHeader: null }, { env, fetchImpl });
  assert.equal(d.pass, true);
});
