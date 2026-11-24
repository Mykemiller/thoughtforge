// FDY-297 (ADM-2.4) — PANEL_SIGNAL_MODE and the reply caps as data, with the env as the fail-closed fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createResolver } from "../config/resolver";
import type { EmailEnv } from "./env";
import { handleSignal, type HttpDeps } from "./http";
import { PANEL_SETTING_SPECS, applyPanelSettings } from "./settings";

const URL = "https://ycadmmngkdhvpcsrcuaq.supabase.co";
const env: EmailEnv = {
  dryRun: true, mockCompose: true, resendApiKey: null, recipient: "r@example.com", replyTo: "p@example.com",
  cronSecret: "test-secret-0123456789abcdef", supabaseUrl: URL, webhookSecret: null, signalMode: "thread",
  readerName: "Myke", replyAllowlist: ["r@example.com"], maxRepliesPerThreadPerDay: 6, linearApiKey: null, maxDaily: 5,
};
const row = (key: string, value: unknown, source = "setting") =>
  ({ app_code: "TF", scope: "default", key, value, source, is_default: source === "default" });
const resolverWith = (rows: unknown, ok = true) =>
  createResolver({ url: URL, key: "test-key", client: async () => ({ ok, json: async () => rows }) });
const quietly = async <T>(f: () => Promise<T>) => {
  const w = console.warn; console.warn = () => {};
  try { return await f(); } finally { console.warn = w; }
};

test("the TF setting keys", () => {
  const s = PANEL_SETTING_SPECS(env);
  assert.deepEqual([s.signalMode.key, s.maxRepliesPerThreadPerDay.key, s.maxDaily.key],
    ["panel_signal_mode", "panel_reply_max_per_thread_per_day", "panel_max_daily"]);
});

test("values set in the console override the env", async () => {
  const out = await applyPanelSettings(env, resolverWith([
    row("panel_signal_mode", "roundtable"), row("panel_reply_max_per_thread_per_day", 2), row("panel_max_daily", 3)]));
  assert.equal(out.signalMode, "roundtable");
  assert.equal(out.maxRepliesPerThreadPerDay, 2);
  assert.equal(out.maxDaily, 3);
  assert.equal(out.cronSecret, env.cronSecret, "everything else is untouched");
});

test("read failure → the env values stay", async () => {
  const out = await quietly(() => applyPanelSettings(env, resolverWith([], false)));
  assert.deepEqual(out, env);
});

test("definition defaults, unknown modes and out-of-range caps → the env values stay", async () => {
  const out = await quietly(() => applyPanelSettings(env, resolverWith([
    row("panel_signal_mode", "roundtable", "default"), row("panel_reply_max_per_thread_per_day", 0), row("panel_max_daily", 11)])));
  assert.deepEqual(out, env);
  const bad = await quietly(() => applyPanelSettings(env, resolverWith([row("panel_signal_mode", "broadcast")])));
  assert.equal(bad.signalMode, "thread");
});

test("handleSignal builds its run from the env with the settings overlaid", async () => {
  let built: EmailEnv | null = null;
  const deps: HttpDeps = {
    cronSecret: () => env.cronSecret,
    env: () => env,
    settings: (e) => applyPanelSettings(e, resolverWith([row("panel_signal_mode", "roundtable")])),
    build: (e) => { built = e; throw new Error("stop after build"); },
    buildInbound: () => { throw new Error("unused"); },
    buildDay: () => { throw new Error("unused"); },
    now: () => new Date("2026-11-24T12:00:00Z"),
  };
  const req = new Request("http://x/api/email/signal", { method: "POST", headers: { authorization: `Bearer ${env.cronSecret}` }, body: "{}" });
  await assert.rejects(() => handleSignal(req, deps), /stop after build/);
  assert.equal((built as EmailEnv | null)?.signalMode, "roundtable");
});
