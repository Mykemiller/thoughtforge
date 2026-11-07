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

import type { SupabaseClient } from "@supabase/supabase-js";
import { saveSession } from "./save";
import { saveInterview } from "../interview/save";

function fakeClient(mode: "pgrst" | "throw" | "ok"): SupabaseClient {
  const result = () => (mode === "pgrst" ? { error: { message: "Invalid API key", code: "PGRST301" } } : { error: null, data: [] });
  const chain: Record<string, unknown> = {
    insert: async () => { if (mode === "throw") throw new Error("socket hang up"); return result(); },
    upsert: async () => { if (mode === "throw") throw new Error("socket hang up"); return result(); },
    select: () => chain, contains: () => chain, limit: async () => result(),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

test("saveSession returns the real Supabase message, not [object Object]", async () => {
  const s = loadMockSession();
  const bad = await saveSession(s, {}, fakeClient("pgrst"));
  assert.equal(bad.saved, false);
  assert.match(bad.note ?? "", /^not saved: Invalid API key/);
  assert.ok(!bad.note?.includes("[object Object]"));
  const thrown = await saveSession(s, {}, fakeClient("throw"));
  assert.match(thrown.note ?? "", /socket hang up/);
  assert.deepEqual(await saveSession(s, {}, fakeClient("ok")), { saved: true });
});

test("saveInterview uses the same readable text", async () => {
  const cast = (await import("../cast/loader")).loadCast()[0];
  const session = {
    session_id: crypto.randomUUID(), panelist: cast.slug, started_at: "2026-11-07T00:00:00.000Z", artifacts: [],
    transcript: [{ role: "interviewer", content: "Hello?" }], model_versions: {},
  } as unknown as Parameters<typeof saveInterview>[0];
  const bad = await saveInterview(session, fakeClient("pgrst"));
  assert.match(bad.note ?? "", /Invalid API key/);
  assert.equal((await saveInterview(session, fakeClient("ok"))).saved, true);
});
