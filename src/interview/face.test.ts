// TH-51 wave 2: pre-rendered interview face clips. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { faceClipsFor, faceEnabled, readClipsYaml, type ClipsYaml } from "./face";
import { nextSegment, transitionTurn, type FaceClips, type FaceSegment } from "./face-cues";
import { PANEL } from "../data/panel";

const ON = { TF_INTERVIEW_FACE: "1" };
const clip = (segment: FaceSegment) => ({ segment, src: `/x/${segment}.mp4`, captions: null, transcript: segment });
const ALL: FaceClips = { intro: clip("intro"), transition: clip("transition"), outro: clip("outro") };
const none = new Set<FaceSegment>();

test("flag: only TF_INTERVIEW_FACE=1 turns the face on", () => {
  assert.equal(faceEnabled({}), false);
  assert.equal(faceEnabled({ TF_INTERVIEW_FACE: "true" }), false);
  assert.equal(faceEnabled(ON), true);
});

test("flag off: no clips at all, so the room is the TH-50 voice room", () => {
  assert.equal(faceClipsFor("mach-eigen", { env: {} }), null);
});

test("intro reuses the TH-4 intro; transition/outro need rendered status AND the MP4", () => {
  const root = mkdtempSync(join(tmpdir(), "face-"));
  const yaml: ClipsYaml = { panelists: { "mach-eigen": { transition: { status: "rendered", video_id: "a".repeat(32), line: "Next question." }, outro: { status: "proposed", line: "Done." } } } };
  assert.deepEqual(faceClipsFor("mach-eigen", { root, env: ON, yaml }), {});
  mkdirSync(join(root, "public/panel/intro"), { recursive: true });
  writeFileSync(join(root, "public/panel/intro/mach-eigen.mp4"), "x");
  const dir = join(root, "public/panel/interview");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mach-eigen-transition.mp4"), "x");
  writeFileSync(join(dir, "mach-eigen-transition.vtt"), "WEBVTT");
  writeFileSync(join(dir, "mach-eigen-outro.mp4"), "x"); // file present but line only proposed
  const c = faceClipsFor("mach-eigen", { root, env: ON, yaml })!;
  assert.equal(c.intro?.src, "/panel/intro/mach-eigen.mp4");
  assert.deepEqual(c.transition, { segment: "transition", src: "/panel/interview/mach-eigen-transition.mp4", captions: "/panel/interview/mach-eigen-transition.vtt", transcript: "Next question." });
  assert.equal(c.outro, undefined);
});

test("faceClipsFor rejects odd slugs", () => {
  assert.equal(faceClipsFor("../etc", { env: ON }), null);
});

test("cues: intro first, transition once at the midpoint, outro at the end", () => {
  const s = (turns: number, played = none, extra = {}) => nextSegment(ALL, { turns, arcLength: 9, played, busy: false, ...extra });
  assert.equal(transitionTurn(9), 5);
  assert.equal(s(0), "intro");
  assert.equal(s(0, new Set(["intro"])), null);
  assert.equal(s(4, new Set(["intro"])), null);
  assert.equal(s(5, new Set(["intro"])), "transition");
  assert.equal(s(6, new Set(["intro", "transition"])), null);
  assert.equal(s(9, new Set(["intro", "transition"])), "outro");
  assert.equal(s(9, new Set<FaceSegment>(["intro", "transition", "outro"])), null);
  // The outro wins over a still-unplayed transition once the arc is done.
  assert.equal(s(9, new Set(["intro"])), "outro");
});

test("cues: never during a live reply; wrap-up plays the outro early", () => {
  assert.equal(nextSegment(ALL, { turns: 5, arcLength: 9, played: new Set(["intro"]), busy: true }), null);
  assert.equal(nextSegment(ALL, { turns: 2, arcLength: 9, played: new Set(["intro"]), busy: false, wrapUp: true }), "outro");
});

test("cues: missing clips are skipped, not waited for", () => {
  assert.equal(nextSegment({}, { turns: 0, arcLength: 9, played: none, busy: false }), null);
  assert.equal(nextSegment({ outro: clip("outro") }, { turns: 5, arcLength: 9, played: none, busy: false }), null);
});

test("interview-clips.yaml covers exactly the ten panelists, with short lines in their own names", () => {
  const y = readClipsYaml();
  const slugs = Object.keys(y.panelists ?? {}).sort();
  assert.deepEqual(slugs, PANEL.map((m) => m.slug).sort());
  for (const [slug, e] of Object.entries(y.panelists!)) {
    for (const seg of ["transition", "outro"] as const) {
      const l = e[seg];
      assert.ok(l?.line, `${slug} ${seg} has a line`);
      assert.ok(["proposed", "confirmed", "rendered"].includes(l!.status ?? ""), `${slug} ${seg} status`);
      if (l!.status === "rendered") assert.match(l!.video_id ?? "", /^[0-9a-f]{32}$/, `${slug} ${seg} video_id`);
      // ~2.5 words/s; keep fixed clips under 8 s.
      assert.ok(l!.line!.split(/\s+/).length <= 20, `${slug} ${seg} is short`);
    }
  }
  // Raw file stays parseable YAML.
  assert.ok(parse(readFileSync(join(process.cwd(), "cast/_shared/interview-clips.yaml"), "utf8")));
});
