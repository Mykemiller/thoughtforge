// Offline tests for the interview face clip sync (Linear TH-51, wave 2). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { renderedClips } from "../lib/interview-clips-core.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");

test("renderedClips keeps only rendered lines with a video id", () => {
  const c = renderedClips({
    panelists: {
      "mach-eigen": { transition: { status: "rendered", video_id: "v1", line: " Next. " }, outro: { status: "proposed", line: "Done." } },
      "margo-brandt": { transition: { status: "rendered", line: "no id" } },
    },
  });
  assert.deepEqual(c, [{ slug: "mach-eigen", segment: "transition", key: "mach-eigen-transition", videoId: "v1", line: "Next." }]);
});

test("offline sync writes the rendered clip and its captions", () => {
  const dir = mkdtempSync(join(tmpdir(), "clips-"));
  const fake = join(dir, "fake.mp4");
  writeFileSync(fake, Buffer.from("not really a video"));
  writeFileSync(join(dir, "urls.json"), JSON.stringify({ "mach-eigen-transition": { url: pathToFileURL(fake).href, duration: 4.31 } }));
  const out = join(dir, "out");
  execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "scripts/sync-interview-clips.ts"), "--urls", join(dir, "urls.json"), "--only", "mach-eigen", "--out", out], { cwd: ROOT });
  assert.ok(existsSync(join(out, "mach-eigen-transition.mp4")));
  assert.match(readFileSync(join(out, "mach-eigen-transition.vtt"), "utf8"), /^WEBVTT\n\n00:00:00\.000 --> 00:00:04\.310\nGood\. That's the baseline\./);
});
