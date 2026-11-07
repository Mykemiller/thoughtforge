import { test } from "node:test";
import assert from "node:assert/strict";
import { composerFor, mockModel } from "./compose";
import { EmailEnvError, type EmailEnv } from "./env";
import { bearerMatches, handleCron, handleSignal, type HttpDeps } from "./http";
import { loadEmailPanelists } from "./panelists";
import { SAMPLE_SIGNAL } from "./sample-signal";
import { DryRunSender } from "./send";
import { emptyDayContext } from "./context";
import { MemoryDayPlanStore, MemoryEmailStore } from "./store";

const SECRET = "test-secret-0123456789abcdef";
const env: EmailEnv = {
  dryRun: true,
  mockCompose: true,
  resendApiKey: null,
  recipient: "r@example.com",
  replyTo: "p@example.com",
  cronSecret: SECRET,
  supabaseUrl: "https://ycadmmngkdhvpcsrcuaq.supabase.co",
  webhookSecret: null,
  signalMode: "thread",
  readerName: "Myke",
  replyAllowlist: ["r@example.com"],
  maxRepliesPerThreadPerDay: 6,
  linearApiKey: null,
  maxDaily: 5,
};

function httpDeps(over: Partial<HttpDeps> = {}) {
  const store = new MemoryEmailStore();
  const dayPlans = new MemoryDayPlanStore();
  const sender = new DryRunSender(() => {});
  const d: HttpDeps = {
    cronSecret: () => SECRET,
    env: () => env,
    build: () => ({ panelists: loadEmailPanelists(), compose: composerFor(mockModel), sender, store, recipient: env.recipient, replyTo: env.replyTo, sleep: async () => {} }),
    buildInbound: () => {
      throw new Error("not used in this test");
    },
    buildDay: (_env, run) => ({ ...run, dayPlans, lanes: { offline: true }, context: emptyDayContext("2026-11-03"), maxDaily: 5 }),
    now: () => new Date("2026-11-03T13:00:00Z"),
    ...over,
  };
  return { d, store, sender };
}
const req = (path: string, init: RequestInit = {}) => new Request(`http://localhost${path}`, init);
const auth = (token = SECRET) => ({ authorization: `Bearer ${token}` });

test("bearer guard: exact secret only", () => {
  assert.ok(bearerMatches(`Bearer ${SECRET}`, SECRET));
  assert.ok(!bearerMatches(`Bearer ${SECRET}x`, SECRET));
  assert.ok(!bearerMatches(SECRET, SECRET));
  assert.ok(!bearerMatches(null, SECRET));
  assert.ok(!bearerMatches(`Bearer ${SECRET}`, undefined));
});

test("cron: 503 when the secret is unset, 401 without or with a wrong bearer; nothing runs", async () => {
  const { d, store } = httpDeps({ cronSecret: () => undefined });
  assert.equal((await handleCron(req("/api/email/cron", { headers: auth() }), d)).status, 503);
  const ok = httpDeps();
  assert.equal((await handleCron(req("/api/email/cron"), ok.d)).status, 401);
  assert.equal((await handleCron(req("/api/email/cron", { headers: auth("nope-nope-nope-nope") }), ok.d)).status, 401);
  assert.equal(store.list().length + ok.store.list().length, 0);
});

test("cron: env errors name variables, never values", async () => {
  const { d } = httpDeps({ env: () => { throw new EmailEnvError(["RESEND_API_KEY"], []); } });
  const res = await handleCron(req("/api/email/cron", { headers: auth() }), d);
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /missing: RESEND_API_KEY/);
});

test("cron with the bearer, Tuesday 2026-11-03: the panel day (five rows, four scheduled); a second call adds none", async () => {
  const { d, store, sender } = httpDeps();
  const res = await handleCron(req("/api/email/cron", { headers: auth() }), d);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.dry_run, true);
  assert.equal(body.status, "scheduled");
  assert.deepEqual(body.slots.map((s: { slot: string }) => s.slot), ["morning-note", "cold-open", "thread-reply", "aside", "signal-or-news"]);
  assert.ok(body.slots.every((s: { body?: string }) => s.body === undefined), "bodies stay out of the cron response");
  assert.equal(store.list().length, 5);
  assert.equal(sender.sent.filter((e) => e.scheduledAt).length, 4);
  const again = await (await handleCron(req("/api/email/cron", { headers: auth() }), d)).json();
  assert.equal(again.skipped, "already scheduled");
  assert.equal(store.list().length, 5);
});

test("signal: 400 on a bad body, ten identical subjects on a good one", async () => {
  const { d, sender } = httpDeps();
  const bad = await handleSignal(req("/api/email/signal", { method: "POST", headers: auth(), body: "{" }), d);
  assert.equal(bad.status, 400);
  const missing = await handleSignal(req("/api/email/signal", { method: "POST", headers: auth(), body: JSON.stringify({ subject: "x" }) }), d);
  assert.equal(missing.status, 400);
  const res = await handleSignal(req("/api/email/signal", { method: "POST", headers: auth(), body: JSON.stringify(SAMPLE_SIGNAL) }), d);
  assert.equal(res.status, 200);
  assert.equal(sender.sent.length, 10);
  assert.equal(new Set(sender.sent.map((e) => e.subject)).size, 1);
  assert.equal((await handleSignal(req("/api/email/signal", { method: "POST", body: JSON.stringify(SAMPLE_SIGNAL) }), d)).status, 401);
});
