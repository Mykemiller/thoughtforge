import { test } from "node:test";
import assert from "node:assert/strict";
import { EmailEnvError, readEmailEnv } from "./env";

const full = {
  RESEND_API_KEY: "placeholder-not-a-key",
  PANEL_RECIPIENT_EMAIL: "someone@example.com",
  PANEL_REPLY_TO: "panel@example.com",
  PANEL_CRON_SECRET: "0123456789abcdef0123",
  ANTHROPIC_API_KEY: "placeholder-not-a-key",
  NEXT_PUBLIC_SUPABASE_URL: "https://ycadmmngkdhvpcsrcuaq.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "placeholder-not-a-key",
};

const errOf = (env: Record<string, string | undefined>) => {
  try {
    readEmailEnv(env);
  } catch (e) {
    if (e instanceof EmailEnvError) return e;
    throw e;
  }
  assert.fail("expected EmailEnvError");
};

test("live mode needs all seven; the error names them and never echoes a value", () => {
  const env = readEmailEnv(full);
  assert.equal(env.dryRun, false);
  assert.equal(env.resendApiKey, full.RESEND_API_KEY);
  const e = errOf({ ...full, RESEND_API_KEY: "", ANTHROPIC_API_KEY: undefined });
  assert.deepEqual(e.missing, ["RESEND_API_KEY", "ANTHROPIC_API_KEY"]);
  assert.ok(!e.message.includes("someone@example.com") && !e.message.includes(full.PANEL_CRON_SECRET));
});

test("DRY_RUN drops the Resend key; TF_MOCK drops the Anthropic key but only with DRY_RUN", () => {
  const { RESEND_API_KEY: _r, ANTHROPIC_API_KEY: _a, ...rest } = full;
  void _r;
  void _a;
  const env = readEmailEnv({ ...rest, DRY_RUN: "1", TF_MOCK: "1" });
  assert.equal(env.dryRun, true);
  assert.equal(env.mockCompose, true);
  assert.equal(env.resendApiKey, null);
  const e = errOf({ ...full, TF_MOCK: "1" });
  assert.match(e.message, /TF_MOCK \(canned compose needs DRY_RUN=1\)/);
});

test("format checks: addresses, secret length, decoy Supabase project", () => {
  const e = errOf({ ...full, PANEL_RECIPIENT_EMAIL: "not-an-email", PANEL_CRON_SECRET: "short", NEXT_PUBLIC_SUPABASE_URL: "https://xgbpmlkanxewtfizloay.supabase.co" });
  assert.equal(e.invalid.length, 3);
  assert.match(e.message, /PANEL_RECIPIENT_EMAIL \(not an email address\)/);
  assert.match(e.message, /PANEL_CRON_SECRET \(shorter than 16/);
  assert.match(e.message, /decoy/);
  assert.ok(!e.message.includes("not-an-email"));
});
