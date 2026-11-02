import { test } from "node:test";
import assert from "node:assert/strict";
import { panelArtifactTitle, panelArtifactBody } from "./save";
import { loadMockSession } from "./mock";

test("panel artifact title is the first 80 chars of the question; body is ruling plus eight replies", () => {
  const long = "x".repeat(200);
  assert.equal(panelArtifactTitle(long).length, "Panel ruling: ".length + 80);
  const body = panelArtifactBody(loadMockSession());
  assert.match(body, /^# Ruling\n/);
  assert.equal((body.match(/^## /gm) ?? []).length, 8);
  assert.ok(body.includes("## Margo Brandt"));
});
