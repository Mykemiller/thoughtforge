// Offline tests for the panel voice plan (Linear TH-4). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { parsePanelSource, validateVoices, buildPlan, estSeconds, type VoicesFile } from "../lib/voices-core.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const voices = parse(readFileSync(join(ROOT, "cast/_shared/voices.yaml"), "utf8")) as VoicesFile;
const panel = parsePanelSource(readFileSync(join(ROOT, "src/data/panel.ts"), "utf8"));
const archetypes: string[] = JSON.parse(readFileSync(join(ROOT, "cast/_shared/cast-sheet-v1.snapshot.json"), "utf8")).archetypes;

test("panel.ts parses to ten members with avatar groups", () => {
  assert.equal(panel.length, 10);
  for (const p of panel) assert.match(p.heygenGroupId, /^[0-9a-f]{32}$/);
});

test("every panelist has one distinct voice and a clean intro", () => {
  assert.deepEqual(validateVoices(voices, panel, archetypes), []);
});

test("voice gender matches the cast register (six women)", () => {
  const women = Object.values(voices.panelists).filter((e) => e.gender === "female").length;
  assert.equal(women, 6);
});

test("validator catches a missing voice, a reused id and a forbidden name", () => {
  const bad: VoicesFile = structuredClone(voices);
  delete bad.panelists["mach-eigen"];
  bad.panelists["margo-brandt"].voice_id = bad.panelists["gilbert-faraday"].voice_id;
  bad.panelists["constance-wright"].intro = "As Riker would say, cite it.";
  const errs = validateVoices(bad, panel, archetypes);
  assert.ok(errs.some((e) => e.startsWith("mach-eigen: no voice")));
  assert.ok(errs.some((e) => e.includes("voice also used by")));
  assert.ok(errs.some((e) => e.includes('names "Riker"')));
});

test("plan uses the chosen look and keeps intros short", () => {
  const plan = buildPlan(voices, panel);
  const margo = plan.find((r) => r.slug === "margo-brandt")!;
  assert.equal(margo.avatar_look_id, "d70d92d1adfb49c9bca85d281115fb19");
  for (const r of plan) assert.ok(r.est_seconds <= 15, `${r.slug} intro is ${r.est_seconds}s`);
  assert.equal(estSeconds("one two three"), 2);
});
