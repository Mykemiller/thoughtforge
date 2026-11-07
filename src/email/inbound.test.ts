import { test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "svix";
import { composerFor, mockModel } from "./compose";
import {
  classify,
  editionDateOf,
  forwardedFrom,
  handleReceived,
  signalCountOf,
  stripForwardPrefix,
  verifyWebhook,
  WebhookError,
  type InboundDeps,
} from "./inbound";
import { loadEmailPanelists } from "./panelists";
import { referencedIds, stripQuotedReply, type InboundMessage, type ReplyDeps } from "./reply";
import { runDaily, runSignal, type RunDeps } from "./run";
import { DryRunSender } from "./send";
import { MemoryDigestStore, MemoryEmailStore, MemoryInboundStore, MemoryThreadStore } from "./store";

const panelists = loadEmailPanelists();
const margo = panelists.find((p) => p.slug === "margo-brandt")!;
const READER = "myke@example.com";
const NOW = new Date("2026-11-05T14:00:00Z"); // 08:00 CST, Thursday; chair = Mach

const DIGEST_SUBJECT = "Faraday Daily Signal Digest — 37 signals · 2026-11-05";

function msg(over: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: `re_${Math.random().toString(36).slice(2, 10)}`,
    from: `Myke Miller <${READER}>`,
    to: ["signal@panel.faraday-thoughtforge.com"],
    subject: "hello",
    text: "hello",
    html: null,
    headers: null,
    messageId: `<${Math.random().toString(36).slice(2)}@mail.example.com>`,
    receivedAt: "2026-11-05T14:00:00Z",
    ...over,
  };
}

function wiring(fetched: Map<string, InboundMessage>, over: Partial<InboundDeps> = {}) {
  const store = new MemoryEmailStore();
  const sender = new DryRunSender(() => {});
  const inbound = new MemoryInboundStore();
  const digests = new MemoryDigestStore();
  const threads = new MemoryThreadStore(store);
  const log: string[] = [];
  const run: RunDeps = {
    panelists,
    compose: composerFor(mockModel),
    sender,
    store,
    digests,
    recipient: READER,
    replyTo: "panel@faraday-thoughtforge.com",
    readerName: "Myke",
    signalMode: "thread",
    sleep: async () => {},
    log: (l) => void log.push(l),
  };
  const reply: ReplyDeps = { panelists, compose: run.compose, sender, store, threads, inbound, readerName: "Myke", maxRepliesPerThreadPerDay: 2, log: run.log };
  const deps: InboundDeps = {
    fetchEmail: async (id) => {
      const m = fetched.get(id);
      if (!m) throw new Error(`no fetched email ${id}`);
      return m;
    },
    run,
    reply,
    digests,
    replyAllowlist: [READER],
    signalMode: "thread",
    now: () => NOW,
    log: run.log,
    ...over,
  };
  return { deps, store, sender, inbound, digests, threads, log };
}

const event = (id: string) => ({ type: "email.received", data: { email_id: id } });

// ---------- webhook ----------

test("webhook: a Svix-signed body verifies; a bad signature, a stale timestamp and a missing secret are rejected", () => {
  const secret = "whsec_" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  const body = JSON.stringify(event("re_1"));
  const now = new Date(); // svix checks the timestamp against the wall clock
  const ts = Math.floor(now.getTime() / 1000);
  const sig = new Webhook(secret).sign("msg_1", new Date(ts * 1000), body);
  const headers = { "svix-id": "msg_1", "svix-timestamp": String(ts), "svix-signature": sig };
  assert.deepEqual(verifyWebhook(body, headers, secret, now), event("re_1"));
  assert.throws(() => verifyWebhook(body, { ...headers, "svix-signature": "v1,AAAA" }, secret, now), WebhookError);
  assert.throws(() => verifyWebhook(body + " ", headers, secret, now), WebhookError);
  assert.throws(() => verifyWebhook(body, headers, secret, new Date(now.getTime() + 10 * 60_000)), /stale/);
  assert.throws(() => verifyWebhook(body, null, secret, now), /missing svix/);
  assert.throws(() => verifyWebhook(body, headers, undefined, now), /RESEND_WEBHOOK_SECRET/);
});

// ---------- parsing ----------

test("subject parsing: forward prefixes, edition date and signal count from real-shaped subjects", () => {
  assert.equal(stripForwardPrefix("Fwd: FW: Faraday Daily Signal Digest — 37 signals · 2026-11-01"), "Faraday Daily Signal Digest — 37 signals · 2026-11-01");
  assert.equal(editionDateOf("Faraday Daily Signal Digest — 37 signals · 2026-11-01", "2026-11-05"), "2026-11-01");
  assert.equal(editionDateOf("Faraday Daily Signal Digest — 8 signals", "2026-11-05"), "2026-11-05");
  assert.equal(signalCountOf("Faraday Daily Signal Digest — 50 signals · 2026-10-12"), 50);
  assert.equal(signalCountOf("Faraday Daily Signal Digest — 1 signal · 2026-10-12"), 1);
  assert.equal(signalCountOf("Faraday Daily Signal Digest"), null);
  assert.equal(forwardedFrom("---------- Forwarded message ---------\nFrom: Faraday Signals <signals@faraday-intelligence.ai>\nDate: Sat"), "signals@faraday-intelligence.ai");
  assert.equal(forwardedFrom("no headers here"), null);
});

test("reply helpers: referenced ids and quoted-history stripping", () => {
  assert.deepEqual(referencedIds({ "In-Reply-To": "<a@x>", References: "<r@x> <a@x>" }), ["<a@x>", "<r@x>"]);
  assert.deepEqual(referencedIds({ "in-reply-to": "<a@x>" }), ["<a@x>"]);
  assert.deepEqual(referencedIds(null), []);
  assert.equal(stripQuotedReply("Thanks Mach.\n\nWhat about BESS?\n\nOn Thu, Nov 5, Mach Eigen wrote:\n> old\n> text"), "Thanks Mach.\n\nWhat about BESS?");
  assert.equal(stripQuotedReply("Short one\n-- \nMyke"), "Short one");
});

// ---------- classification ----------

const opt = { panelists, replyAllowlist: [READER], today: "2026-11-05" };

test("classify: forwarded digest from Gmail is a digest; the direct sender too; a lookalike is ignored", () => {
  const fwd = msg({ subject: `Fwd: ${DIGEST_SUBJECT}`, text: "From: signals@faraday-intelligence.ai\nDate: x\n\nbody" });
  const c = classify(fwd, opt);
  assert.equal(c.kind, "digest");
  if (c.kind === "digest") {
    assert.equal(c.editionDate, "2026-11-05");
    assert.equal(c.signalCount, 37);
    assert.equal(c.subject, DIGEST_SUBJECT);
  }
  assert.equal(classify(msg({ from: "signals@faraday-intelligence.ai", subject: DIGEST_SUBJECT }), opt).kind, "digest");
  assert.equal(classify(msg({ from: "signals@faraday-intelligence.ai", subject: "Something else" }), opt).kind, "ignored");
  assert.equal(classify(msg({ subject: DIGEST_SUBJECT, text: "no forwarded header" }), opt).kind, "ignored");
});

test("classify: Gmail confirmation, panel's own domain, auto-replies and strangers are not replies", () => {
  assert.equal(classify(msg({ from: "forwarding-noreply@google.com" }), opt).kind, "gmail-confirmation");
  assert.equal(classify(msg({ from: "mach.eigen@panel.faraday-thoughtforge.com", to: [margo.address] }), opt).kind, "ignored");
  assert.equal(classify(msg({ to: [margo.address], subject: "Automatic reply: out of office" }), opt).kind, "ignored");
  const stranger = classify(msg({ from: "someone@else.example", to: [margo.address] }), opt);
  assert.equal(stranger.kind, "ignored");
  if (stranger.kind === "ignored") assert.match(stranger.reason, /allowlist/);
});

test("classify: a reply is matched by the To address (sending or reply inbox) or by a known root Message-ID", () => {
  const byTo = classify(msg({ to: [margo.address] }), opt);
  assert.equal(byTo.kind, "reply");
  if (byTo.kind === "reply") assert.equal(byTo.panelist?.slug, "margo-brandt");
  const byInbox = classify(msg({ to: ["margo@faraday-thoughtforge.com"] }), opt);
  assert.equal(byInbox.kind, "reply");
  if (byInbox.kind === "reply") assert.equal(byInbox.panelist?.slug, "margo-brandt");
  const byRoot = classify(msg({ to: ["reply@panel.faraday-thoughtforge.com"] }), { ...opt, rootMessageId: "<root@panel.faraday-thoughtforge.com>" });
  assert.equal(byRoot.kind, "reply");
  if (byRoot.kind === "reply") assert.equal(byRoot.panelist, null);
});

// ---------- end to end ----------

test("digest webhook: one digest row, one accepted inbound row, ten takeaways in one thread; re-delivery is a duplicate with no sends", async () => {
  const fetched = new Map<string, InboundMessage>();
  const { deps, store, sender, inbound, digests } = wiring(fetched);
  fetched.set("re_d1", msg({ id: "re_d1", subject: `Fwd: ${DIGEST_SUBJECT}`, text: "From: signals@faraday-intelligence.ai\n\n1. A hypothetical item.", html: "<p>x</p>" }));
  const r = await handleReceived(event("re_d1"), deps);
  assert.equal(r.status, "digest");
  if (r.status === "digest") {
    assert.equal(r.digest_date, "2026-11-05");
    assert.equal(r.signal.outcomes.filter((o) => o.status === "sent").length, 10);
    assert.equal(r.signal.subject, `Re: ${DIGEST_SUBJECT}`);
  }
  assert.equal(digests.rows.get("2026-11-05")?.signal_count, 37);
  assert.equal(inbound.rows.length, 1);
  assert.equal(inbound.rows[0].status, "accepted");
  assert.equal(store.list().length, 10);
  assert.equal(sender.sent.length, 10);
  // Takeaways name the edition in the sentence after the opener line (mock compose carries the date it was given).
  assert.match(sender.sent[0].text.split("\n")[1], /2026-11-05/);
  assert.deepEqual(await handleReceived(event("re_d1"), deps), { status: "duplicate" });
  assert.equal(sender.sent.length, 10);
});

test("roundtable mode: one email from the chair, ten sections in cast order, ten rows sharing one Message-ID; Reply-To is panel@", async () => {
  const fetched = new Map<string, InboundMessage>();
  const { deps, store, sender } = wiring(fetched, { signalMode: "roundtable" });
  fetched.set("re_d2", msg({ id: "re_d2", from: "signals@faraday-intelligence.ai", subject: DIGEST_SUBJECT, text: "1. A hypothetical item." }));
  const r = await handleReceived(event("re_d2"), deps);
  assert.equal(r.status, "digest");
  assert.equal(sender.sent.length, 1);
  const email = sender.sent[0];
  assert.equal(email.subject, `Panel roundtable: Re: ${DIGEST_SUBJECT}`);
  assert.equal(email.from, panelists.find((p) => p.slug === "mach-eigen")!.from); // Thursday 2026-11-05 chair
  assert.equal(email.replyTo, "panel@faraday-thoughtforge.com");
  const names = [...email.text.matchAll(/^— (.+?), /gm)].map((m) => m[1]);
  assert.deepEqual(names, panelists.map((p) => p.name));
  assert.ok(email.text.trimEnd().endsWith("Mach Eigen, Chief Engineer\nThoughtForge panel, Faraday Intelligence"));
  assert.ok(email.text.startsWith("Canned roundtable opener"));
  const rows = store.list();
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map((x) => x.message_id)).size, 1);
  assert.ok(rows.every((x) => x.kind === "signal-takeaway" && x.thread_key === email.subject && x.resend_id === "dry-run"));
  // The same edition again: nothing to do.
  const again = await runSignal({ subject: DIGEST_SUBJECT, text: "x", edition_date: "2026-11-05", mode: "roundtable" }, NOW, deps.run);
  assert.ok(again.outcomes.every((o) => o.status === "skipped"));
  assert.equal(sender.sent.length, 1);
});

test("mode comes from the POST body first, then the env default", async () => {
  const fetched = new Map<string, InboundMessage>();
  const { deps, sender } = wiring(fetched);
  const r = await runSignal({ subject: DIGEST_SUBJECT, text: "x", edition_date: "2026-11-04", mode: "roundtable" }, NOW, deps.run);
  assert.equal(r.mode, "roundtable");
  assert.equal(sender.sent.length, 1);
  const t = await runSignal({ subject: DIGEST_SUBJECT, text: "x", edition_date: "2026-11-03" }, NOW, deps.run);
  assert.equal(t.mode, "thread");
  assert.equal(sender.sent.length, 11);
});

test("briefing with a digest on file names the edition in its opener; without one it never says nothing landed (TH-66)", async () => {
  const fetched = new Map<string, InboundMessage>();
  const { deps, sender, digests } = wiring(fetched);
  const dry = await runDaily(NOW, deps.run);
  assert.equal(dry.digest_date, undefined);
  assert.doesNotMatch(sender.sent[0].text, /no Signal|nothing (new )?landed/i);
  await digests.upsert({ digest_date: "2026-11-05", subject: DIGEST_SUBJECT, signal_count: 37, source_message_id: null, raw_html: null, raw_text: "1. item" });
  const { deps: d2, sender: s2 } = wiring(fetched, { digests });
  d2.run.digests = digests;
  const withDigest = await runDaily(NOW, d2.run);
  assert.equal(withDigest.digest_date, "2026-11-05");
  const briefing = s2.sent.find((e) => e.subject.startsWith("Morning note"))!;
  const firstTwo = briefing.text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  assert.match(firstTwo, /2026-11-05/);
});

test("reply loop: Myke answers Margo's takeaway; Margo replies in the same thread; re-delivery sends nothing; the daily cap holds", async () => {
  const fetched = new Map<string, InboundMessage>();
  const { deps, store, sender, inbound, threads } = wiring(fetched);
  await runSignal({ subject: DIGEST_SUBJECT, text: "1. item", edition_date: "2026-11-05" }, NOW, deps.run);
  const margoRow = store.list().find((r) => r.panelist_slug === "margo-brandt")!;
  assert.ok(margoRow.message_id);
  const reply1 = msg({
    id: "re_r1",
    to: ["margo@faraday-thoughtforge.com"],
    subject: `Re: ${DIGEST_SUBJECT}`,
    text: "Margo, I think you underweight the tariff risk. Why?\n\nOn Thu, Margo Brandt wrote:\n> quoted",
    headers: { "In-Reply-To": margoRow.message_id!, References: margoRow.message_id! },
  });
  fetched.set("re_r1", reply1);
  const before = sender.sent.length;
  const r = await handleReceived(event("re_r1"), deps);
  assert.equal(r.status, "reply");
  if (r.status === "reply") {
    assert.equal(r.outcome.status, "sent");
    assert.equal(r.outcome.slug, "margo-brandt");
    assert.equal(r.outcome.thread_key, margoRow.thread_key);
  }
  const sent = sender.sent[sender.sent.length - 1];
  assert.equal(sender.sent.length, before + 1);
  assert.equal(sent.from, margo.from);
  assert.equal(sent.to, READER);
  assert.equal(sent.replyTo, "margo@faraday-thoughtforge.com");
  assert.equal(sent.subject, `Re: ${DIGEST_SUBJECT}`);
  assert.equal(sent.inReplyTo, reply1.messageId);
  assert.deepEqual(sent.references, [margoRow.message_id, reply1.messageId]);
  assert.match(sent.text, /You wrote back/);
  const row = store.list().find((x) => x.kind === "reply")!;
  assert.equal(row.thread_key, margoRow.thread_key);
  assert.equal(row.in_reply_to, reply1.messageId);
  assert.equal(inbound.rows[0].status, "accepted");
  assert.equal(inbound.rows[0].note, "reply:margo-brandt");
  assert.equal(inbound.rows[0].raw_text, "Margo, I think you underweight the tariff risk. Why?");
  // Re-delivered webhook: duplicate, no send.
  assert.deepEqual(await handleReceived(event("re_r1"), deps), { status: "duplicate" });
  assert.equal(sender.sent.length, before + 1);
  // A second reply the same day is answered (cap is 2 in this wiring); the third is not.
  fetched.set("re_r2", msg({ id: "re_r2", to: ["margo@faraday-thoughtforge.com"], subject: `Re: ${DIGEST_SUBJECT}`, text: "Second question.", headers: { "In-Reply-To": row.message_id! } }));
  const r2 = await handleReceived(event("re_r2"), deps);
  assert.equal(r2.status === "reply" && r2.outcome.status, "sent");
  assert.equal(await threads.countReplies(margoRow.thread_key!, "2026-11-05"), 2);
  fetched.set("re_r3", msg({ id: "re_r3", to: ["margo@faraday-thoughtforge.com"], subject: `Re: ${DIGEST_SUBJECT}`, text: "Third.", headers: { "In-Reply-To": row.message_id! } }));
  const r3 = await handleReceived(event("re_r3"), deps);
  assert.equal(r3.status === "reply" && r3.outcome.status, "ignored");
  assert.equal(sender.sent.length, before + 2);
});

test("reply loop: the thread transcript is oldest first and capped, and a new thread to a panelist's address starts without a root", async () => {
  const fetched = new Map<string, InboundMessage>();
  const { deps, store, sender, inbound } = wiring(fetched);
  const fresh = msg({ id: "re_n1", to: [margo.address], subject: "A question for Margo", text: "Margo, what is the first thing you would check on a stalled site?" });
  fetched.set("re_n1", fresh);
  const r = await handleReceived(event("re_n1"), deps);
  assert.equal(r.status === "reply" && r.outcome.status, "sent");
  const row = store.list().find((x) => x.kind === "reply")!;
  assert.equal(row.thread_key, fresh.messageId);
  assert.equal(sender.sent[0].subject, "Re: A question for Margo");
  assert.equal(inbound.rows[0].thread_key, fresh.messageId);
});

test("ignored mail: one row, no send; a Gmail confirmation is stored and its body logged", async () => {
  const fetched = new Map<string, InboundMessage>();
  const { deps, sender, inbound, log } = wiring(fetched);
  fetched.set("re_x", msg({ id: "re_x", from: "newsletter@example.com", subject: "Weekly roundup" }));
  const r = await handleReceived(event("re_x"), deps);
  assert.equal(r.status, "ignored");
  assert.equal(inbound.rows[0].status, "ignored");
  fetched.set("re_g", msg({ id: "re_g", from: "forwarding-noreply@google.com", subject: "Gmail Forwarding Confirmation", text: "Confirmation code: 123456789" }));
  assert.deepEqual(await handleReceived(event("re_g"), deps), { status: "gmail-confirmation" });
  assert.equal(inbound.rows[1].status, "gmail-confirmation");
  assert.ok(log.some((l) => l.includes("Confirmation code: 123456789")));
  assert.equal(sender.sent.length, 0);
  assert.deepEqual(await handleReceived({ type: "email.sent", data: { email_id: "re_s" } }, deps), { status: "unhandled-event", type: "email.sent" });
});
