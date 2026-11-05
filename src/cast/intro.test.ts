import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getIntro } from "./intro";

test("getIntro shows nothing until the MP4 is in the repo", () => {
  const root = mkdtempSync(join(tmpdir(), "intro-"));
  assert.equal(getIntro("mach-eigen", root), null);
  const dir = join(root, "public", "panel", "intro");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mach-eigen.mp4"), "x");
  const i = getIntro("mach-eigen", root);
  assert.equal(i?.src, "/panel/intro/mach-eigen.mp4");
  assert.equal(i?.captions, null);
  assert.match(i?.transcript ?? "", /^Mach Eigen, chief engineer\./);
  writeFileSync(join(dir, "mach-eigen.vtt"), "WEBVTT");
  assert.equal(getIntro("mach-eigen", root)?.captions, "/panel/intro/mach-eigen.vtt");
});

test("getIntro rejects unknown or odd slugs", () => {
  assert.equal(getIntro("nobody"), null);
  assert.equal(getIntro("../etc"), null);
});
