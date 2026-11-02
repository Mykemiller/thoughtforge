import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, cookieMatchesKey, queryKeyMatches, isGatedPath } from "./access";

test("access cookie is the SHA-256 hex of the key", async () => {
  // Known vector: sha256("abc")
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const key = "example-key-not-a-secret";
  const cookie = await sha256Hex(key);
  assert.equal(await cookieMatchesKey(cookie, key), true);
  assert.equal(await cookieMatchesKey(cookie.toUpperCase(), key), true);
  assert.equal(await cookieMatchesKey(cookie, "other"), false);
  assert.equal(await cookieMatchesKey(undefined, key), false);
  assert.equal(await cookieMatchesKey(cookie, ""), false);
  assert.equal(await queryKeyMatches(key, key), true);
  assert.equal(await queryKeyMatches("nope", key), false);
});

test("only /ask and /api/ask are gated", () => {
  assert.equal(isGatedPath("/ask"), true);
  assert.equal(isGatedPath("/api/ask"), true);
  assert.equal(isGatedPath("/ask/anything"), true);
  assert.equal(isGatedPath("/"), false);
  assert.equal(isGatedPath("/panel"), false);
  assert.equal(isGatedPath("/panel/mach-eigen"), false);
  assert.equal(isGatedPath("/askew"), false);
});
