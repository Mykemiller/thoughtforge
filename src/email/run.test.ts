import { test } from "node:test";
import assert from "node:assert/strict";
import { composerFor, mockModel } from "./compose";
import { loadEmailPanelists } from "./panelists";
import { chairFor, coldOpenSenderFor } from "./rotation";
import { parseSignalBody, runDaily, runSignal, SIGNAL_SPACING_MS, type RunDeps } from "./run";
import { SAMPLE_SIGNAL } from "./sample-signal";
import { DryRunSender, type OutboundEmail, type Sender } from "./send";
import { MemoryEmailStore } from "./store";

const panelists = loadEmailPanelists();
const order = panelists.map((p) => p.slug);

function deps(over: Partial<RunDeps> = {}) {
  const sleeps: number[] = [];
  const out: string[] = [];
  const sender = new DryRunSender((s) => void out.push(s));
  const store = new MemoryEmailStore();
  const d: RunDeps = {
    panelists,
    compose: composerFor(mockModel),
    sender,
    store,
    recipient: "recipient@example.com",
    replyTo: "panel@example.com",
    sleep: async (ms) => void sleeps.push(ms),
    ...over,
  };
  return { d, sender, store, sleeps, out };
}

// 13:00 UTC on each date is the cron's own run time (07:00 CST).
const at = (date: string) => new Date(`${date}T13:00:00Z`);

test("DRY_RUN cron, Wednesday: one briefing row from the chair; a re-run inserts none", async () => {
  const { d, store, sender, out } = deps();
  const r1 = await runDaily(at("2026-11-04"), d);
  assert.equal(r1.date, "2026-11-04");
  assert.deepEqual(r1.outcomes.map((o) => [o.kind, o.slug, o.status]), [["briefing", "margo-brandt", "sent"]]);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].resend_id, "dry-run");
  assert.match(store.list()[0].message_id ?? "", /^<[0-9a-f-]+@panel\.faraday-thoughtforge\.com>$/);
  const r2 = await runDaily(at("2026-11-04"), d);
  assert.deepEqual(r2.outcomes.map((o) => o.status), ["skipped"]);
  assert.equal(store.list().length, 1);
  assert.equal(sender.sent.length, 1);
  // The dry-run printout names the variables, never their values.
  assert.ok(out[0].includes("To: $PANEL_RECIPIENT_EMAIL") && !out[0].includes("recipient@example.com"));
});

test("DRY_RUN cron, Tuesday: briefing plus cold open (two rows); re-run inserts none", async () => {
  const { d, store } = deps();
  const r1 = await runDaily(at("2026-11-03"), d);
  assert.deepEqual(r1.outcomes.map((o) => [o.kind, o.slug, o.status]), [
    ["briefing", chairFor("2026-11-03", order), "sent"],
    ["cold-open", coldOpenSenderFor("2026-11-03", order), "sent"],
  ]);
  assert.equal(r1.outcomes[0].slug, "gilbert-faraday");
  assert.equal(r1.outcomes[1].subject, `${panelists.find((p) => p.slug === r1.outcomes[1].slug)!.firstName}: you should be looking at this`);
  assert.equal(store.list().length, 2);
  await runDaily(at("2026-11-03"), d);
  assert.equal(store.list().length, 2);
});

test("cron does nothing on a weekend", async () => {
  const { d, store } = deps();
  const r = await runDaily(at("2026-11-07"), d);
  assert.equal(r.skipped, "weekend");
  assert.equal(store.list().length, 0);
});

test("idempotency: an existing row (e.g. written by another run) is never re-sent, and compose is not even called", async () => {
  let composed = 0;
  const { d, store, sender } = deps({ compose: async (i) => (composed++, composerFor(mockModel)(i)) });
  await store.reserve({ kind: "briefing", send_date: "2026-11-04", panelist_slug: "margo-brandt", subject: "s", body: "b", resend_id: "re_x", message_id: null, in_reply_to: null, thread_key: null });
  const r = await runDaily(at("2026-11-04"), d);
  assert.deepEqual(r.outcomes.map((o) => o.status), ["skipped"]);
  assert.equal(composed, 0);
  assert.equal(sender.sent.length, 0);
});

test("a race lost at insert time (unique conflict) skips the send", async () => {
  const { d, store, sender } = deps();
  store.has = async () => false; // the pre-check misses it ...
  store.reserve = async () => null; // ... and the unique key catches it
  const r = await runDaily(at("2026-11-04"), d);
  assert.deepEqual(r.outcomes.map((o) => o.status), ["skipped"]);
  assert.equal(sender.sent.length, 0);
});

test("a failed send releases its row so the next run retries", async () => {
  const failing: Sender = { send: async () => Promise.reject(new Error("resend: validation_error: domain not verified")) };
  const { d, store } = deps({ sender: failing });
  const r = await runDaily(at("2026-11-04"), d);
  assert.equal(r.outcomes[0].status, "failed");
  assert.match(r.outcomes[0].reason ?? "", /domain not verified/);
  assert.equal(store.list().length, 0);
});

test("Signal: ten emails, cast order, identical Re: subject, ten distinct From, 2 s apart, thread_key = subject; re-run sends none", async () => {
  const { d, store, sender, sleeps } = deps();
  const r = await runSignal({ ...SAMPLE_SIGNAL, edition_date: "2026-11-03" }, at("2026-11-03"), d);
  assert.equal(r.subject, `Re: ${SAMPLE_SIGNAL.subject}`);
  assert.deepEqual(r.outcomes.map((o) => o.slug), order);
  assert.ok(r.outcomes.every((o) => o.status === "sent"));
  const sent = sender.sent as OutboundEmail[];
  assert.equal(sent.length, 10);
  assert.equal(new Set(sent.map((e) => e.subject)).size, 1);
  assert.equal(sent[0].subject, `Re: ${SAMPLE_SIGNAL.subject}`);
  assert.equal(new Set(sent.map((e) => e.from)).size, 10);
  assert.ok(sent.every((e) => e.text.startsWith("My most important takeaway:\n")));
  assert.ok(sent.every((e) => e.replyTo === "panel@example.com" && e.to === "recipient@example.com"));
  assert.deepEqual(sleeps, Array(9).fill(SIGNAL_SPACING_MS));
  assert.ok(store.list().every((row) => row.thread_key === r.subject && row.send_date === "2026-11-03" && row.kind === "signal-takeaway"));
  const again = await runSignal({ ...SAMPLE_SIGNAL, edition_date: "2026-11-03" }, at("2026-11-03"), d);
  assert.ok(again.outcomes.every((o) => o.status === "skipped"));
  assert.equal(store.list().length, 10);
});

test("Signal edition_date defaults to today in US Central", async () => {
  const { d } = deps();
  const r = await runSignal(SAMPLE_SIGNAL, new Date("2026-11-04T03:00:00Z"), d);
  assert.equal(r.edition_date, "2026-11-03");
});

test("Signal body validation", () => {
  assert.deepEqual(parseSignalBody({ subject: " S \n", text: "t" }), { subject: "S", text: "t" });
  assert.throws(() => parseSignalBody(null), /JSON object/);
  assert.throws(() => parseSignalBody({ text: "t" }), /subject is required/);
  assert.throws(() => parseSignalBody({ subject: "s" }), /text is required/);
  assert.throws(() => parseSignalBody({ subject: "s", text: "t", edition_date: "Nov 3" }), /YYYY-MM-DD/);
});
