// Offline tests for Meet the Team (TH-65). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { PANEL_SORTED } from "../../src/data/panel.ts";
import { teamPhotos } from "../../src/data/team-photos.ts";
import { TEAM_SHOTS, buildPrompt, normalizeOnly, renderManifest, SCENE_PROMPT } from "../lib/team-shots.ts";

const ROOT = resolve(import.meta.dirname, "../..");

test("shot list: eight shots, three formal and five candid, unique ids, 01..08", () => {
  assert.equal(TEAM_SHOTS.length, 8);
  assert.deepEqual(TEAM_SHOTS.map((s) => s.id), ["01", "02", "03", "04", "05", "06", "07", "08"]);
  assert.equal(TEAM_SHOTS.filter((s) => s.kind === "formal").length, 3);
  assert.equal(TEAM_SHOTS.filter((s) => s.kind === "candid").length, 5);
  for (const s of TEAM_SHOTS) assert.ok(buildPrompt(s).startsWith(SCENE_PROMPT));
});

test("teamPhotos is empty (placeholder state) or exactly eight real files with unique ids", () => {
  if (teamPhotos.length === 0) return; // pre-generation: UI shows the coming-soon line
  assert.equal(teamPhotos.length, 8);
  assert.equal(new Set(teamPhotos.map((p) => p.id)).size, 8);
  for (const p of teamPhotos) {
    assert.ok(existsSync(join(ROOT, "public", p.file)), p.file);
    assert.ok(existsSync(join(ROOT, "public", p.fileSm)), p.fileSm);
  }
});

test("alt text and captions name only ThoughtForge panelists and no archetype", () => {
  for (const s of TEAM_SHOTS) {
    let text = s.alt;
    for (const m of PANEL_SORTED) text = text.replaceAll(m.name, "");
    assert.doesNotMatch(text, /\b[A-Z][a-z]+ [A-Z][a-z]+\b/, `unexpected personal name in: ${text}`);
    assert.doesNotMatch(`${text} ${s.caption}`, /archetype/i);
  }
});

test("--only parsing and manifest rendering", () => {
  assert.equal(normalizeOnly(undefined), null);
  assert.equal(normalizeOnly("4"), "04");
  assert.equal(normalizeOnly("08"), "08");
  assert.throws(() => normalizeOnly("9"));
  assert.match(renderManifest([]), /teamPhotos: TeamPhoto\[\] = \[\];/);
});

