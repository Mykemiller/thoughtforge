import { test } from "node:test";
import assert from "node:assert/strict";
import { describeError } from "./errors";
import { buildHealth } from "./health";
import { isGatedPath } from "./access";

test("describeError reads Postgrest-shaped objects", () => {
  const s = describeError({ message: "Invalid API key", code: "PGRST301", details: "", hint: "check the key" });
  assert.equal(s, "Invalid API key (code PGRST301; hint: check the key)");
  assert.equal(describeError({ message: "boom" }), "boom");
});

test("describeError handles Error, string, circular, null and never says [object Object]", () => {
  assert.equal(describeError(new Error("bad")), "bad");
  assert.equal(describeError("plain"), "plain");
  const c: Record<string, unknown> = { a: 1 };
  c.self = c;
  const cs = describeError(c);
  assert.ok(cs.includes("[circular]") && cs !== "[object Object]");
  assert.equal(describeError(null), "unknown error");
  assert.equal(describeError(undefined), "unknown error");
  assert.equal(describeError({}), "unknown error");
  assert.equal(describeError(42), "42");
  assert.ok(describeError({ x: "y".repeat(1000) }).length <= 300);
  const hostile = { get message(): string { throw new Error("x"); } };
  assert.equal(typeof describeError(hostile), "string");
});

test("buildHealth shapes ok and failure and never carries a key", () => {
  const ok = buildHealth(null, true, new Date("2026-11-07T18:30:00Z"));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { supabase: "ok", anthropic_key: "present", checked_at: "2026-11-07 12:30 CT" });
  const bad = buildHealth("Invalid API key (code PGRST301)", false);
  assert.equal(bad.status, 503);
  assert.equal(bad.body.supabase, "error");
  assert.equal(bad.body.supabase_note, "Invalid API key (code PGRST301)");
  assert.equal(bad.body.anthropic_key, "missing");
  assert.equal(buildHealth(null, false).status, 503);
  assert.equal(buildHealth("x", true).status, 503);
  assert.ok(!/sk-|eyJ|https?:/.test(JSON.stringify(ok.body)));
});

test("/api/health is gated", () => {
  assert.equal(isGatedPath("/api/health"), true);
  assert.equal(isGatedPath("/api/healthz"), false);
});
