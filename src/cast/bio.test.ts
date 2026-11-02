import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { panelStaticParams } from "./params";
import { loadCast } from "./loader";
import { aboutFromLinkedin, voices, lifeOutsideWork, experience, relationshipLabel } from "./bio";

test("/panel/[slug] static params cover exactly the ten cast slugs", () => {
  const params = panelStaticParams().map((p) => p.slug);
  const dirs = readdirSync("cast").filter((d) => !d.startsWith("_") && statSync(join("cast", d)).isDirectory()).sort();
  assert.equal(params.length, 10);
  assert.deepEqual([...params].sort(), dirs);
  assert.equal(new Set(params).size, 10);
});

test("bio helpers read About, Voices and Life outside work from the cast files", () => {
  const mach = loadCast().find((m) => m.slug === "mach-eigen")!;
  assert.match(aboutFromLinkedin(mach.linkedin), /^Power engineer by training/);
  const v = voices(mach);
  assert.equal(v.length, 8);
  assert.deepEqual(v[0], { name: "Jensen Huang", kind: "shared a room with", venue: "NVIDIA GTC 2024 keynote, SAP Center, San Jose (in the audience)", since: 2024 });
  assert.ok(v.every((x) => x.since < 2025));
  const life = lifeOutsideWork(mach);
  assert.equal(life[0].label, "Hobbies");
  assert.ok(life.some((r) => r.label === "What makes Mach laugh"));
  assert.equal(experience(mach)[0].employer, "ThoughtForge Panel");
  assert.equal(relationshipLabel("cites"), "cites");
});
