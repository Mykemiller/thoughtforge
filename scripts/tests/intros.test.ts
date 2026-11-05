// Offline tests for the panel intro sync (Linear TH-4). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { vttTime, introVtt, parseVideoStatus } from "../lib/intro-core.ts";
import type { VoicesFile } from "../lib/voices-core.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const voices = parse(readFileSync(join(ROOT, "cast/_shared/voices.yaml"), "utf8")) as VoicesFile;

test("vttTime formats seconds as WebVTT time", () => {
  assert.equal(vttTime(0), "00:00:00.000");
  assert.equal(vttTime(7.41878), "00:00:07.419");
  assert.equal(vttTime(3725.5), "01:02:05.500");
});

test("introVtt writes one cue covering the clip", () => {
  assert.equal(introVtt("  Hart   Caldwell, counsel. ", 5.9), "WEBVTT\n\n00:00:00.000 --> 00:00:05.900\nHart Caldwell, counsel.\n");
  assert.match(introVtt("x", NaN), /--> 00:00:10\.000/);
  assert.throws(() => introVtt("   ", 3));
});

test("parseVideoStatus reads HeyGen's v1 and v2 answers", () => {
  assert.deepEqual(parseVideoStatus({ code: 100, data: { status: "completed", video_url: "https://x/v.mp4", duration: 7.1 } }), {
    status: "completed", url: "https://x/v.mp4", duration: 7.1, error: null,
  });
  assert.equal(parseVideoStatus({ status: "failed", failure_message: "boom" }).error, "boom");
  assert.equal(parseVideoStatus(null).status, "unknown");
});

test("every panelist has a rendered video_id", () => {
  assert.equal(voices.status, "rendered");
  for (const [slug, e] of Object.entries(voices.panelists)) assert.match(e.video_id ?? "", /^[0-9a-f]{32}$/, slug);
});

test("offline sync writes an MP4 and a caption file per panelist", () => {
  const dir = mkdtempSync(join(tmpdir(), "intros-"));
  const fake = join(dir, "fake.mp4");
  writeFileSync(fake, Buffer.from("not really a video"));
  const urls: Record<string, { url: string; duration: number }> = {};
  for (const slug of ["mach-eigen", "margo-brandt"]) urls[slug] = { url: pathToFileURL(fake).href, duration: 7 };
  writeFileSync(join(dir, "urls.json"), JSON.stringify(urls));
  const out = join(dir, "out");
  execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "scripts/sync-panel-intros.ts"), "--urls", join(dir, "urls.json"), "--only", "mach-eigen,margo-brandt", "--out", out], { cwd: ROOT });
  assert.ok(existsSync(join(out, "mach-eigen.mp4")));
  assert.match(readFileSync(join(out, "margo-brandt.vtt"), "utf8"), /^WEBVTT\n\n00:00:00\.000 --> 00:00:07\.000\nMargo Brandt\./);
});
