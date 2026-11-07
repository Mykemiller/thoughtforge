import { test } from "node:test";
import assert from "node:assert/strict";
import { rulingUserContent } from "./orchestrate";
import { LIMITS } from "./roster";

const verdicts = { "margo-brandt": "Clean." };

test("the ruling receives a DEGRADED status line only when the fact-check is degraded (TH-45)", () => {
  const clean = rulingUserContent("Q?", "replies", { items: [], verdicts });
  assert.doesNotMatch(clean, /DEGRADED/);
  assert.match(clean, /## Fact-Checker \(Constance Wright\)\n\{"items":\[\]/);
  const degraded = rulingUserContent("Q?", "replies", { items: [], verdicts, degraded: true, reason: "parse_failed" });
  assert.match(degraded, /Fact-Checker status: DEGRADED \(parse_failed\); the record is ungraded\.\n\{/);
});

test("the Fact-Checker budget is 1500 tokens (TH-45 D1)", () => {
  assert.equal(LIMITS.factcheckMaxTokens, 1500);
});
