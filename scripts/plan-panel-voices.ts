// Prints the voice and avatar render plan for the panel (Linear TH-4).
// Read-only: validates cast/_shared/voices.yaml against src/data/panel.ts and
// prints one row per panelist. It never calls HeyGen or ElevenLabs. Renders
// happen only after Myke confirms the voices (status: confirmed) and approves
// the credit spend.
// Run: npm run plan:voices   (add --json for machine-readable output)

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { parsePanelSource, validateVoices, buildPlan, type VoicesFile } from "./lib/voices-core.ts";

const ROOT = resolve(import.meta.dirname, "..");
const voices = parse(readFileSync(join(ROOT, "cast/_shared/voices.yaml"), "utf8")) as VoicesFile;
const panel = parsePanelSource(readFileSync(join(ROOT, "src/data/panel.ts"), "utf8"));
const snapshot = JSON.parse(readFileSync(join(ROOT, "cast/_shared/cast-sheet-v1.snapshot.json"), "utf8"));
const forbidden: string[] = snapshot.archetypes ?? [];

const errs = validateVoices(voices, panel, forbidden);
if (errs.length) {
  for (const e of errs) console.error(`FAIL ${e}`);
  process.exit(1);
}
const plan = buildPlan(voices, panel);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ status: voices.status, plan }, null, 2));
} else {
  console.log(`Voice plan (${voices.status}), engine ${voices.engine}, ${plan.length} panelists`);
  for (const r of plan) console.log(`- ${r.name}: ${r.voice_name} (${r.voice_id}), look ${r.avatar_look_id}, ~${r.est_seconds}s`);
  const total = plan.reduce((s, r) => s + r.est_seconds, 0);
  console.log(`Total intro audio ~${total}s. Nothing was rendered.`);
  if (voices.status === "proposed") console.log("Waiting on Myke to confirm the voices before any render.");
}
