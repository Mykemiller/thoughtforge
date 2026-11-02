import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentReply, splitRuling } from "./render";
import { loadMockSession } from "./mock";

test("segmentReply yields tag badges, source titles and contested spans", () => {
  const segs = segmentReply("Lead time is sixty weeks [SRC: Vendor survey]. Flat profiles move up [EST].", [
    { panelist: "x", claim: "Flat profiles move up", tag_given: "EST", tag_should_be: "INF", note: "n" },
  ]);
  const kinds = segs.map((s) => s.kind);
  assert.deepEqual(kinds, ["text", "tag", "text", "contested", "text", "tag", "text"]);
  const tag = segs[1];
  assert.ok(tag.kind === "tag" && tag.tag === "SRC" && tag.title === "Vendor survey");
  const contested = segs[3];
  assert.ok(contested.kind === "contested" && contested.text === "Flat profiles move up" && contested.item.tag_should_be === "INF");
  const plain = segs.map((s) => (s.kind === "tag" ? `[${s.tag}${s.title ? `: ${s.title}` : ""}]` : s.text)).join("");
  assert.equal(plain, "Lead time is sixty weeks [SRC: Vendor survey]. Flat profiles move up [EST].");
});

test("splitRuling separates the dissent and what-would-change lines", () => {
  const r = splitRuling(loadMockSession().ruling);
  assert.ok(r.body.length > 200);
  assert.match(r.dissent ?? "", /^Mach wanted hall one on DC/);
  assert.match(r.wouldChange ?? "", /^a third shelf vendor/);
  assert.ok(!r.body.includes("Dissent on the record"));
});
