import { test } from "node:test";
import assert from "node:assert/strict";
import { centralDate, chairFor, coldOpenSenderFor, daysBetween, isColdOpenDay, isoWeek, isWeekend, parseDate, weekdayOf } from "./rotation";
import { EMAIL_ORDER } from "./panelists";

test("chair rotates by calendar day from 2026-11-03", () => {
  assert.equal(chairFor("2026-11-03", EMAIL_ORDER), "gilbert-faraday");
  assert.equal(chairFor("2026-11-04", EMAIL_ORDER), "margo-brandt");
  assert.equal(chairFor("2026-11-13", EMAIL_ORDER), "gilbert-faraday");
  assert.equal(chairFor("2026-11-12", EMAIL_ORDER), "constance-wright");
  // Before the epoch wraps backwards, never negative.
  assert.equal(chairFor("2026-11-02", EMAIL_ORDER), "constance-wright");
  // Across a month and a year boundary the count stays calendar-true.
  assert.equal(daysBetween("2026-11-03", "2027-01-01"), 59);
  assert.equal(chairFor("2027-01-01", EMAIL_ORDER), EMAIL_ORDER[59 % 10]);
});

test("ten consecutive days give ten different chairs", () => {
  const chairs = Array.from({ length: 10 }, (_, i) => chairFor(`2026-11-${String(3 + i).padStart(2, "0")}`, EMAIL_ORDER));
  assert.equal(new Set(chairs).size, 10);
});

test("weekdays: 2026-11-03 is a Tuesday; Tue/Thu are cold-open days; Sat/Sun are weekend", () => {
  assert.equal(weekdayOf("2026-11-03"), 2);
  assert.ok(isColdOpenDay("2026-11-03") && isColdOpenDay("2026-11-05"));
  assert.ok(!isColdOpenDay("2026-11-02") && !isColdOpenDay("2026-11-04") && !isColdOpenDay("2026-11-06"));
  assert.ok(isWeekend("2026-11-07") && isWeekend("2026-11-08") && !isWeekend("2026-11-09"));
});

test("central date: 13:00 UTC is 07:00 CST the same day; a late-evening UTC instant is still the prior Central day", () => {
  assert.equal(centralDate(new Date("2026-11-03T13:00:00Z")), "2026-11-03");
  assert.equal(centralDate(new Date("2026-11-04T03:00:00Z")), "2026-11-03");
  assert.equal(centralDate(new Date("2026-07-01T04:30:00Z")), "2026-06-30"); // CDT, UTC-5
});

test("ISO week numbering at the year edges", () => {
  assert.deepEqual(isoWeek("2026-01-01"), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek("2026-12-31"), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek("2027-01-01"), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek("2021-01-03"), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek("2026-11-03"), isoWeek("2026-11-05"));
});

test("cold-open sender is seeded by ISO week: deterministic, shared by Tue and Thu of one week, a panelist", () => {
  const tue = coldOpenSenderFor("2026-11-03", EMAIL_ORDER);
  assert.equal(coldOpenSenderFor("2026-11-03", EMAIL_ORDER), tue);
  assert.equal(coldOpenSenderFor("2026-11-05", EMAIL_ORDER), tue);
  assert.ok((EMAIL_ORDER as readonly string[]).includes(tue));
  // Over a year of weeks the pick is spread across the panel, not stuck on one slug.
  const picks = new Set(Array.from({ length: 52 }, (_, w) => coldOpenSenderFor(new Date(Date.UTC(2027, 0, 5 + 7 * w)).toISOString().slice(0, 10), EMAIL_ORDER)));
  assert.ok(picks.size >= 6, `only ${picks.size} distinct senders in 52 weeks`);
});

test("dates are validated", () => {
  assert.throws(() => parseDate("2026-02-30"), /not a real date/);
  assert.throws(() => parseDate("11/03/2026"), /not YYYY-MM-DD/);
});
