import { test } from "node:test";
import assert from "node:assert/strict";
import { capSlots, centralToUtc, DEFAULT_MAX_DAILY, planDay, slotsFor } from "./day-plan";
import { EMAIL_ORDER } from "./panelists";
import { chairFor, weekdayOf } from "./rotation";

const order = [...EMAIL_ORDER];
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

test("slot count: Mon/Wed/Fri four, Tue/Thu five, Saturday one, Sunday none", () => {
  // 2026-11-09 is a Monday.
  const counts = [0, 1, 2, 3, 4, 5, 6].map((i) => planDay(addDays("2026-11-09", i), order).slots.length);
  assert.deepEqual(counts, [4, 5, 4, 5, 4, 1, 0]);
  assert.deepEqual(planDay("2026-11-14", order).slots.map((s) => [s.slot, s.local]), [["weekend-note", "09:00"]]);
  assert.deepEqual(slotsFor("2026-11-15"), []);
});

test("weekday slots in time order, Central times converted to UTC", () => {
  const tue = planDay("2026-11-10", order);
  assert.deepEqual(tue.slots.map((s) => [s.slot, s.local]), [
    ["morning-note", "07:00"],
    ["cold-open", "08:30"],
    ["thread-reply", "10:30"],
    ["aside", "12:45"],
    ["signal-or-news", "16:30"],
  ]);
  assert.equal(tue.slots[0].at, "2026-11-10T13:00:00.000Z"); // CST, UTC-6
  assert.equal(tue.slots[2].replyToSlot, "morning-note");
  // DST: in July Central is UTC-5.
  assert.equal(centralToUtc("2026-07-15", "07:00"), "2026-07-15T12:00:00.000Z");
  assert.equal(centralToUtc("2026-03-08", "10:30"), "2026-03-08T15:30:00.000Z"); // the morning DST starts
});

test("the morning note is the TH-31 chair; nobody appears twice in a day (a year of days)", () => {
  for (let i = 0; i < 371; i++) {
    const date = addDays("2026-11-02", i);
    const plan = planDay(date, order);
    const slugs = plan.slots.map((s) => s.slug);
    assert.equal(new Set(slugs).size, slugs.length, `${date}: ${slugs.join(", ")}`);
    const lead = plan.slots.find((s) => s.slot === "morning-note" || s.slot === "weekend-note");
    if (lead) assert.equal(lead.slug, chairFor(date, order), date);
  }
});

test("every panelist appears at least twice in every Monday-to-Sunday week (53 weeks)", () => {
  for (let w = 0; w < 53; w++) {
    const monday = addDays("2026-11-09", 7 * w);
    assert.equal(weekdayOf(monday), 1);
    const count = new Map<string, number>(order.map((s) => [s, 0]));
    for (let d = 0; d < 7; d++) for (const s of planDay(addDays(monday, d), order).slots) count.set(s.slug, count.get(s.slug)! + 1);
    for (const [slug, n] of count) assert.ok(n >= 2, `week of ${monday}: ${slug} appears ${n} time(s)`);
  }
});

test("deterministic: the same date plans the same day", () => {
  assert.deepEqual(planDay("2026-11-12", order), planDay("2026-11-12", order));
});

test("cap: default 5; a lower PANEL_MAX_DAILY keeps the morning note, then thread-reply, signal-or-news, aside, cold-open", () => {
  assert.equal(DEFAULT_MAX_DAILY, 5);
  assert.equal(planDay("2026-11-10", order).slots.length, 5);
  assert.deepEqual(planDay("2026-11-10", order, { maxDaily: 3 }).slots.map((s) => s.slot), ["morning-note", "thread-reply", "signal-or-news"]);
  assert.deepEqual(planDay("2026-11-10", order, { maxDaily: 1 }).slots.map((s) => s.slot), ["morning-note"]);
  assert.deepEqual(capSlots(["morning-note", "cold-open", "thread-reply", "aside", "signal-or-news"], 4), ["morning-note", "thread-reply", "aside", "signal-or-news"]);
  // Raising the cap never adds slots beyond the day's own.
  assert.equal(planDay("2026-11-10", order, { maxDaily: 9 }).slots.length, 5);
  assert.equal(planDay("2026-11-14", order, { maxDaily: 1 }).slots.length, 1);
});
