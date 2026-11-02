import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSlugs, loadCastWithShared } from "./loader";
import { composePanelistCore, composeSystemPrompt, estimateTokens, PROMPT_TOKEN_LIMIT, EVIDENCE_LADDER_CONTRACT } from "./prompt";

const cast = loadCastWithShared();

test("the cast loads ten members in manifest order and validates against the schema", () => {
  assert.equal(cast.members.length, 10);
  assert.deepEqual(cast.members.map((m) => m.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(cast.members[0].slug, "gilbert-faraday");
  assert.equal(cast.members[9].slug, "constance-wright");
  for (const m of cast.members) {
    assert.equal(m.skills.length, 3, `${m.slug} should have three persona skills`);
    assert.ok(m.network.entries.length >= 6, `${m.slug} network`);
    assert.ok(m.linkedin.includes("## About"));
  }
  assert.equal(cast.shared.all.length, 3);
});

test("a slug mismatch between cast/ and the manifest fails with the slug named", () => {
  assert.throws(() => checkSlugs(["mach-eigen", "extra-person"], ["mach-eigen"]), /cast\/extra-person exists but is not in src\/data\/panel.ts/);
  assert.throws(() => checkSlugs(["mach-eigen"], ["mach-eigen", "margo-brandt"]), /margo-brandt is in src\/data\/panel.ts but cast\/margo-brandt is missing/);
  assert.doesNotThrow(() => checkSlugs(["a-b", "c-d"], ["c-d", "a-b"]));
});

test("every panelist's fixed prompt stays under the 6,000-token budget", () => {
  for (const m of cast.members) {
    const core = composePanelistCore(m, cast.shared);
    const t = estimateTokens(core);
    assert.ok(t < PROMPT_TOKEN_LIMIT, `${m.slug}: ${t} tokens`);
    assert.ok(t > 1500, `${m.slug}: ${t} tokens looks too small to carry the dossier`);
  }
});

test("prompt order is identity, voice, backstory, life, own skills, shared skills, contract", () => {
  const m = cast.members.find((x) => x.slug === "mach-eigen")!;
  const core = composePanelistCore(m, cast.shared);
  const idx = [
    core.indexOf("# You are Mach Eigen, Chief Engineer"),
    core.indexOf("## Voice"),
    core.indexOf("## Backstory"),
    core.indexOf("## Life outside work"),
    core.indexOf("## Skill: one-line-diagram"),
    core.indexOf("## Shared skill: evidence-ladder"),
    core.indexOf(EVIDENCE_LADDER_CONTRACT),
  ];
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1] && idx[i - 1] >= 0, `section ${i} out of order`);
  assert.ok(core.includes("D2 Power Architecture"));
});

test("retrieval block says so when nothing was retrieved, and lists titles when it was", () => {
  const m = cast.members[1];
  const none = composeSystemPrompt(m, cast.shared, { artifacts: [] });
  assert.ok(none.includes("No artifacts were retrieved for this question; tag accordingly."));
  const some = composeSystemPrompt(m, cast.shared, {
    artifacts: [{ title: "Example tariff filing", publisher: "Example PUC", published_at: "2024-05-01", excerpt: "x".repeat(900), source: "primary" }],
    turnInstructions: "Turn note.",
  });
  assert.ok(some.includes("1. Example tariff filing (Example PUC · 2024-05-01 · primary)"));
  assert.ok(some.endsWith("Turn note."));
  assert.ok(!some.includes("x".repeat(301)), "excerpt is capped at 300 chars");
});
