import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyProblems, composeEmail, composerFor, mentionsMissingInput, mockModel, renderLanes, userPrompt, type EmailModel } from "./compose";
import { emptyDayContext, sliceFor, type DayContext } from "./context";
import { personalLanes } from "./context/personal";
import { runPanelDay, type DayRunDeps } from "./day-run";
import { loadEmailPanelists } from "./panelists";
import { DryRunSender, threadingHeaders } from "./send";
import { MemoryDayPlanStore, MemoryEmailStore } from "./store";

const panel = loadEmailPanelists();
const delia = panel.find((p) => p.slug === "delia-marchetti")!;

function deps(ctx: DayContext, over: Partial<DayRunDeps> = {}) {
  const sender = new DryRunSender(() => {});
  const store = new MemoryEmailStore();
  const dayPlans = new MemoryDayPlanStore();
  const d: DayRunDeps = {
    panelists: panel,
    compose: composerFor(mockModel),
    sender,
    store,
    dayPlans,
    recipient: "r@example.com",
    replyTo: "panel@example.com",
    lanes: { offline: true },
    context: ctx,
    ...over,
  };
  return { d, sender, store, dayPlans };
}
const at = (iso: string) => new Date(iso);

test("forbidden-phrase guard: sentences about missing input and issue numbers make a body unsendable", () => {
  for (const bad of [
    "Myke, no Signal Digest has landed since Tuesday, so here is my own pick.",
    "I have no fresh news item for you today.",
    "Nothing new landed overnight.",
    "The digest hasn't arrived yet, so I went to the queue.",
    "No news today worth your time.",
    "There's nothing new in front of me this morning.",
  ]) {
    assert.ok(mentionsMissingInput(bad), bad);
    assert.ok(bodyProblems(bad).includes("talks about missing input"), bad);
  }
  for (const ok of [
    "Myke, the Signal's third item is the one: transformer lead times again.",
    "The county board landed on a 120-day pause, which is the story.",
    "No signal from the utility yet on the tariff; that is the thing to chase.",
    "Gina beat me at the crossword again, which is news to nobody.",
  ]) assert.ok(!mentionsMissingInput(ok), ok);
  assert.ok(bodyProblems("Per TH-47 the feed is live.").includes("names an issue number"));
});

test("threading headers: Message-ID always; In-Reply-To and References only on a reply", () => {
  assert.deepEqual(threadingHeaders({ messageId: "<a@x>" }), { "Message-ID": "<a@x>" });
  assert.deepEqual(threadingHeaders({ messageId: "<b@x>", inReplyTo: "<a@x>", references: ["<a@x>"] }), { "Message-ID": "<b@x>", "In-Reply-To": "<a@x>", References: "<a@x>" });
});

test("weekday day: slot 1 now, the rest scheduled; the thread-reply answers the morning note by Message-ID; Reply-To is each panelist's own", async () => {
  const { d, sender, store, dayPlans } = deps(emptyDayContext("2026-11-09"));
  const r = await runPanelDay(at("2026-11-09T13:00:00Z"), d);
  assert.equal(r.status, "scheduled");
  assert.equal(sender.sent.length, 4);
  const [morning, reply, aside, news] = sender.sent;
  assert.equal(morning.scheduledAt, undefined, "slot 1 goes now");
  assert.deepEqual([reply.scheduledAt, aside.scheduledAt, news.scheduledAt], ["2026-11-09T16:30:00.000Z", "2026-11-09T18:45:00.000Z", "2026-11-09T22:30:00.000Z"]);
  assert.match(morning.subject, /^Morning note from /);
  assert.equal(reply.subject, `Re: ${morning.subject}`);
  assert.equal(reply.inReplyTo, morning.messageId);
  assert.deepEqual(reply.references, [morning.messageId]);
  assert.equal(new Set(sender.sent.map((e) => e.messageId)).size, 4);
  for (const e of sender.sent) assert.match(e.replyTo, /^[a-z]+@faraday-thoughtforge\.com$/);
  assert.equal(new Set(sender.sent.map((e) => e.from)).size, 4, "four different panelists");
  // Rows carry slot and thread_key; the reply's thread_key is the morning note's Message-ID.
  const rows = store.list();
  assert.deepEqual(rows.map((x) => [x.kind, x.slot]), [["briefing", "morning-note"], ["thread-reply", "thread-reply"], ["aside", "aside"], ["news-take", "signal-or-news"]]);
  assert.equal(rows[1].thread_key, morning.messageId);
  assert.equal(rows[1].in_reply_to, morning.messageId);
  assert.equal((await dayPlans.get("2026-11-09"))!.status, "scheduled");
  // Idempotent: a re-run for a scheduled day does nothing.
  const again = await runPanelDay(at("2026-11-09T13:05:00Z"), d);
  assert.equal(again.skipped, "already scheduled");
  assert.equal(sender.sent.length, 4);
  assert.equal(store.list().length, 4);
});

test("a late cron sends past slots now and still schedules the later ones", async () => {
  const { d, sender } = deps(emptyDayContext("2026-11-09"));
  await runPanelDay(at("2026-11-09T19:00:00Z"), d); // 13:00 Central
  assert.deepEqual(sender.sent.map((e) => e.scheduledAt ?? "now"), ["now", "now", "now", "2026-11-09T22:30:00.000Z"]);
});

test("Saturday: one weekend note from Saturday's chair, now; Sunday: nothing", async () => {
  const sat = deps(emptyDayContext("2026-11-14"));
  const r = await runPanelDay(at("2026-11-14T15:00:00Z"), sat.d);
  assert.equal(sat.sender.sent.length, 1);
  assert.match(sat.sender.sent[0].subject, /^Weekend note from /);
  assert.equal(r.slots[0].slot, "weekend-note");
  const sun = deps(emptyDayContext("2026-11-15"));
  const s = await runPanelDay(at("2026-11-15T15:00:00Z"), sun.d);
  assert.equal(s.skipped, "sunday");
  assert.equal(sun.sender.sent.length, 0);
});

const freshSignal = (date: string): DayContext => ({
  ...emptyDayContext(date),
  signal: { editionDate: date, subject: "Faraday Daily Signal Digest — 4 signals", items: ["A hypothetical tariff item.", "A hypothetical permit pause."], fresh: true },
});

test("a fresh Signal edition makes the 16:30 slot a roundtable from that slot's panelist (ten takeaway rows); already-sent takeaways fall back to a news-take", async () => {
  const { d, sender, store } = deps(freshSignal("2026-11-09"));
  const r = await runPanelDay(at("2026-11-09T13:00:00Z"), d);
  const slot = r.slots.find((s) => s.slot === "signal-or-news")!;
  assert.equal(slot.kind, "signal-takeaway");
  const rt = sender.sent.at(-1)!;
  assert.match(rt.subject, /^Panel roundtable: Re: Faraday Daily Signal Digest/);
  assert.equal(rt.scheduledAt, "2026-11-09T22:30:00.000Z");
  assert.equal(store.list().filter((x) => x.kind === "signal-takeaway").length, 10);

  const pre = deps(freshSignal("2026-11-10"));
  await pre.store.reserve({ kind: "signal-takeaway", send_date: "2026-11-10", panelist_slug: "gilbert-faraday", subject: "s", body: "b", resend_id: "x", message_id: "<m@x>", in_reply_to: null, thread_key: "s" });
  const r2 = await runPanelDay(at("2026-11-10T13:00:00Z"), pre.d);
  assert.equal(r2.slots.find((s) => s.slot === "signal-or-news")!.kind, "news-take");
});

test("a failed send leaves the day partial; the re-run resumes it with the same Message-IDs and sends only what failed", async () => {
  const { d, store, dayPlans } = deps(emptyDayContext("2026-11-11"));
  const inner = new DryRunSender(() => {});
  let fail = true;
  d.sender = { send: async (e) => (e.subject.startsWith("Re:") && fail ? Promise.reject(new Error("resend 500")) : inner.send(e)) };
  const r1 = await runPanelDay(at("2026-11-11T13:00:00Z"), d);
  assert.equal(r1.status, "partial");
  assert.equal(r1.slots.find((s) => s.slot === "thread-reply")!.status, "failed");
  const morningId = r1.slots[0].messageId;
  fail = false;
  const r2 = await runPanelDay(at("2026-11-11T13:10:00Z"), d);
  assert.equal(r2.status, "scheduled");
  assert.equal(r2.slots[0].messageId, morningId);
  const reply = inner.sent.filter((e) => e.subject.startsWith("Re:"));
  assert.equal(reply.length, 1);
  assert.equal(reply[0].inReplyTo, morningId);
  assert.equal(inner.sent.length, 4, "nothing went twice");
  assert.equal(store.list().length, 4);
  assert.equal((await dayPlans.get("2026-11-11"))!.status, "scheduled");
});

// ---------- prompts ----------

test("slot prompts: lanes are rendered when present and never announced when empty; replies address the earlier author", () => {
  const personal = personalLanes(panel);
  const ctx: DayContext = {
    ...emptyDayContext("2026-11-09"),
    projects: [{ title: "Panel email, Week 2", state: "In Progress", updatedAt: "2026-11-09T02:00:00Z" }],
    news: [{ title: "County weighs data center noise rules", domain: "news.example", url: "https://news.example/a", seen: "" }],
    personal,
    sports: { "delia-marchetti": [{ team: "Chicago Cubs", opponent: "Other Club", teamScore: 3, opponentScore: 5, result: "L", league: "mlb" }] },
  };
  const morning = { author: "Mach Eigen", firstName: "Mach", slot: "morning-note", subject: "Morning note from Mach: x", body: "Myke, the queue moved.", messageId: "<m@x>" };
  const aside = userPrompt("aside", delia, { date: "2026-11-09", day: sliceFor(ctx, "delia-marchetti", [morning]) });
  assert.match(aside, /Chicago Cubs lost to Other Club, 3-5/);
  assert.match(aside, /Door County/);
  assert.match(aside, /Panel email, Week 2/);
  assert.match(aside, /Earlier today from the panel/);
  const noScores = renderLanes(sliceFor(emptyDayContext("2026-11-09"), "x", []));
  assert.equal(noScores, "", "an empty context renders nothing");
  const quietAside = userPrompt("aside", delia, { date: "2026-11-09", day: sliceFor({ ...emptyDayContext("2026-11-09"), personal }, "delia-marchetti", []) });
  assert.match(quietAside, /didn't catch the end/);
  const reply = userPrompt("thread-reply", delia, { date: "2026-11-09", day: sliceFor(ctx, "delia-marchetti", [morning], morning) });
  assert.match(reply, /Address Mach by first name/);
  assert.match(reply, /quote at most one short phrase/);
  assert.throws(() => userPrompt("thread-reply", delia, { date: "2026-11-09", day: sliceFor(ctx, "delia-marchetti", []) }), /needs context.day.answering/);
  for (const kind of ["briefing", "aside", "news-take", "weekend-note", "thread-reply"] as const) {
    const p = userPrompt(kind, delia, { date: "2026-11-09", day: sliceFor(emptyDayContext("2026-11-09"), "delia-marchetti", [morning], morning) });
    assert.doesNotMatch(p, /no Signal Digest has landed|nothing new landed|says so plainly/i, kind);
  }
});

test("compose retries once when the model talks about missing input, then gives up rather than send it", async () => {
  let calls = 0;
  const bad: EmailModel = async () => (calls++, { text: "Hook: a hook of words\n\nNo Signal Digest has landed today, Myke.", stopReason: "end_turn" });
  await assert.rejects(composeEmail({ panelist: delia, kind: "aside", context: { date: "2026-11-09", day: sliceFor(emptyDayContext("2026-11-09"), "delia-marchetti", []) } }, bad), /missing input/);
  assert.equal(calls, 2);
});
