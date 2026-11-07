// Offline tests for the Meet the Team disclosure and gallery (TH-65). Run: npm test
// The lightbox's Escape/focus-return behaviour needs a real DOM; it is covered by the Playwright pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { teamPhotos } from "../data/team-photos";
import { Gallery, MeetTheTeam, orderPhotos, readOpen, writeOpen, MEET_TEAM_STORAGE_KEY, type TeamBio } from "./MeetTheTeam";

const bios: TeamBio[] = [{ slug: "gilbert-faraday", name: "Gilbert Faraday", role: "Chief of Staff", thumb: "/panel/gilbert-faraday-thumb.webp", alt: "Gilbert Faraday, Chief of Staff", bio: "Forty years across utilities." }];

test("empty gallery renders the coming-soon fallback", () => {
  const html = renderToString(createElement(Gallery, { photos: [] }));
  assert.match(html, /Group photos coming soon/);
  assert.doesNotMatch(html, /<img/);
});

test("gallery with photos renders a tile per photo using the -sm source", () => {
  const photo = { id: "01", file: "/team/group-01.webp", fileSm: "/team/group-01-sm.webp", kind: "formal" as const, title: "The Board", alt: "x", caption: "The Board", generatedAt: "", model: "m" };
  const html = renderToString(createElement(Gallery, { photos: [photo] }));
  assert.match(html, /group-01-sm/);
  assert.match(html, /The Board: view larger/);
});

test("disclosure renders closed: aria-expanded=false, panel hidden, bios present", () => {
  const html = renderToString(createElement(MeetTheTeam, { photos: teamPhotos, bios }));
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="/);
  assert.match(html, /hidden/);
  assert.match(html, /Meet the Team/);
  assert.match(html, /Gilbert Faraday/);
  assert.match(html, /href="\/panel\/gilbert-faraday"/);
});

test("closed by default fetches no gallery image (gallery not rendered before first open)", () => {
  const photo = { id: "01", file: "/team/group-01.webp", fileSm: "/team/group-01-sm.webp", kind: "formal" as const, title: "The Board", alt: "x", caption: "The Board", generatedAt: "", model: "m" };
  const html = renderToString(createElement(MeetTheTeam, { photos: [photo], bios }));
  assert.doesNotMatch(html, /group-01/);
});

test("orderPhotos puts formal first and keeps order within a kind", () => {
  const mk = (id: string, kind: "formal" | "candid") => ({ id, file: "", fileSm: "", kind, title: "", alt: "", caption: "", generatedAt: "", model: "" });
  assert.deepEqual(orderPhotos([mk("04", "candid"), mk("01", "formal"), mk("05", "candid"), mk("02", "formal")]).map((p) => p.id), ["01", "02", "04", "05"]);
});

test("open-state storage tolerates a missing or throwing store", () => {
  const mem = new Map<string, string>();
  const ok = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.equal(readOpen(ok), false);
  writeOpen(true, ok);
  assert.equal(mem.get(MEET_TEAM_STORAGE_KEY), "1");
  assert.equal(readOpen(ok), true);
  const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readOpen(boom), false);
  assert.doesNotThrow(() => writeOpen(true, boom));
});
