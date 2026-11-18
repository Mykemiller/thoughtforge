// FDY-414 Faraday beta gate: ThoughtForge wrapper tests. No network: every fetch is injected.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { clearGateCache } from "../../lib/faraday-gate/server/check";
import { gateConfigFromEnv, gateEnforced, tfGateApiDenial, tfGateDecision, TF_GATE_APP, TF_GATE_COPY } from "./faradayGate";

const URL_ = "https://ycadmmngkdhvpcsrcuaq.supabase.co";
const ENV = { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: "svc", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

type Handler = (url: string, body: unknown) => { status?: number; json: unknown };
function fakeFetch(handler: Handler) {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    const out = handler(url, body);
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const rpcMissing: Handler = () => ({ status: 404, json: { code: "PGRST202", message: "Could not find the function public.estate_entitled" } });

beforeEach(() => clearGateCache());

test("config: existing env names, project of record only, decoy refused", () => {
  assert.equal(gateConfigFromEnv({}), null);
  assert.equal(gateConfigFromEnv({ NEXT_PUBLIC_SUPABASE_URL: URL_ }), null, "no service key");
  assert.equal(gateConfigFromEnv({ ...ENV, NEXT_PUBLIC_SUPABASE_URL: "https://xgbpmlkanxewtfizloay.supabase.co" }), null, "decoy");
  assert.equal(gateConfigFromEnv({ ...ENV, NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" }), null, "foreign project");
  const cfg = gateConfigFromEnv(ENV);
  assert.deepEqual(cfg, { supabaseUrl: URL_, serviceKey: "svc", anonKey: "anon" });
  assert.equal(gateConfigFromEnv({ ...ENV, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" })?.anonKey, undefined);
  assert.equal(TF_GATE_APP, "thoughtforge");
  assert.equal(TF_GATE_COPY.app_name, "ThoughtForge Panel");
});

test("enforce flag: only the exact string '1'", () => {
  assert.equal(gateEnforced({}), false);
  assert.equal(gateEnforced({ FARADAY_GATE_ENFORCE: "0" }), false);
  assert.equal(gateEnforced({ FARADAY_GATE_ENFORCE: "true" }), false);
  assert.equal(gateEnforced({ FARADAY_GATE_ENFORCE: "1" }), true);
});

test("pre-migration (estate_entitled missing): passes through when not enforced", async () => {
  const { f, calls } = fakeFetch(rpcMissing);
  const d = await tfGateDecision({ cookieHeader: null }, { env: ENV, fetchImpl: f });
  assert.deepEqual(d, { pass: true, why: "probe_error_passthrough", email: null });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/estate_entitled$/);
  assert.deepEqual(calls[0].body, { p_email: null, p_app: "thoughtforge" });
});

test("pre-migration with FARADAY_GATE_ENFORCE=1: fails closed (unavailable)", async () => {
  const { f } = fakeFetch(rpcMissing);
  const d = await tfGateDecision({ cookieHeader: null }, { env: { ...ENV, FARADAY_GATE_ENFORCE: "1" }, fetchImpl: f });
  assert.equal(d.pass, false);
  assert.equal(d.pass === false && d.view, "unavailable");
  assert.equal(d.why, "probe_error_enforced");
});

test("network failure on the probe behaves like a probe error", async () => {
  const f = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
  assert.equal((await tfGateDecision({}, { env: ENV, fetchImpl: f })).pass, true);
  clearGateCache();
  assert.equal((await tfGateDecision({}, { env: { ...ENV, FARADAY_GATE_ENFORCE: "1" }, fetchImpl: f })).pass, false);
});

test("missing config: passes through unless enforced", async () => {
  assert.deepEqual(await tfGateDecision({}, { env: {} }), { pass: true, why: "probe_error_passthrough", email: null });
  const d = await tfGateDecision({}, { env: { FARADAY_GATE_ENFORCE: "1" } });
  assert.equal(d.pass, false);
});

test("open mode (the seeded state): passes with no identity lookup", async () => {
  const { f, calls } = fakeFetch(() => ({ json: { allowed: true, reason: "open", mode: "open" } }));
  const d = await tfGateDecision({ cookieHeader: "fgate_at=tok; tf_access=x" }, { env: ENV, fetchImpl: f });
  assert.deepEqual(d, { pass: true, why: "open", email: null });
  assert.equal(calls.filter((c) => c.url.includes("/auth/v1/")).length, 0, "no auth call in open mode");
});

test("invite mode, signed out: shows the request view", async () => {
  const { f, calls } = fakeFetch(() => ({ json: { allowed: false, reason: "no_grant", mode: "invite" } }));
  const d = await tfGateDecision({ cookieHeader: null }, { env: ENV, fetchImpl: f });
  assert.equal(d.pass, false);
  assert.equal(d.pass === false && d.view, "request");
  assert.equal(calls.filter((c) => c.url.includes("/auth/v1/")).length, 0, "no token, no auth call");
});

test("invite mode, gate cookie with a grant: passes, identity from the gate's own code sign-in", async () => {
  const { f, calls } = fakeFetch((url, body) => {
    if (url.endsWith("/auth/v1/user")) return { json: { email: "Reader@Example.com" } };
    const b = body as { p_email: string | null };
    return { json: b.p_email ? { allowed: true, reason: "grant", mode: "invite" } : { allowed: false, reason: "no_grant", mode: "invite" } };
  });
  const d = await tfGateDecision({ cookieHeader: "tf_access=abc; fgate_at=tok123" }, { env: ENV, fetchImpl: f });
  assert.deepEqual(d, { pass: true, why: "allowed", email: "reader@example.com" });
  assert.ok(calls.some((c) => c.url.endsWith("/auth/v1/user")));
  assert.ok(calls.some((c) => (c.body as { p_email?: string } | null)?.p_email === "reader@example.com"));
});

test("invite mode, the per-email check errors after a good probe: fails closed even when not enforced", async () => {
  const { f } = fakeFetch((url, body) => {
    if (url.endsWith("/auth/v1/user")) return { json: { email: "reader@example.com" } };
    return (body as { p_email: string | null }).p_email ? { status: 500, json: {} } : { json: { allowed: false, reason: "no_grant", mode: "invite" } };
  });
  const d = await tfGateDecision({ cookieHeader: "fgate_at=tok" }, { env: ENV, fetchImpl: f });
  assert.equal(d.pass, false);
  assert.equal(d.pass === false && d.view, "unavailable");
});

test("unknown_app after the migration is a real answer, not a probe error: closed", async () => {
  const { f } = fakeFetch(() => ({ json: { allowed: false, reason: "unknown_app", mode: null } }));
  const d = await tfGateDecision({}, { env: ENV, fetchImpl: f });
  assert.equal(d.pass, false);
});

test("waitlist mode: waitlist view", async () => {
  const { f } = fakeFetch(() => ({ json: { allowed: false, reason: "waitlist_mode", mode: "waitlist" } }));
  const d = await tfGateDecision({}, { env: ENV, fetchImpl: f });
  assert.equal(d.pass === false && d.view, "waitlist");
});

test("API denial helper: null when passing, 403 JSON when denied", async () => {
  const open = fakeFetch(() => ({ json: { allowed: true, reason: "open", mode: "open" } }));
  assert.equal(await tfGateApiDenial(new Request("https://x/api/ask", { method: "POST" }), { env: ENV, fetchImpl: open.f }), null);
  clearGateCache();
  const pre = fakeFetch(rpcMissing);
  assert.equal(await tfGateApiDenial(new Request("https://x/api/ask", { method: "POST" }), { env: ENV, fetchImpl: pre.f }), null, "pre-migration passthrough");
  clearGateCache();
  const invite = fakeFetch(() => ({ json: { allowed: false, reason: "no_grant", mode: "invite" } }));
  const r = await tfGateApiDenial(new Request("https://x/api/ask", { method: "POST" }), { env: ENV, fetchImpl: invite.f });
  assert.ok(r);
  assert.equal(r.status, 403);
  const j = (await r.json()) as { error: string };
  assert.match(j.error, /private beta/);
  assert.equal(/\$|USD|per month|tokens?/i.test(j.error), false);
});
