import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFactcheck } from "./factcheck";

const slugs = ["margo-brandt", "mach-eigen"];

test("parseFactcheck reads verdicts and downgrades, drops malformed items", () => {
  const raw = `Here you go:\n{"verdicts":{"margo-brandt":"Proceed.","mach-eigen":"Clean."},"items":[{"panelist":"margo-brandt","claim":"x","tag_given":"SRC","tag_should_be":"EST","note":"projection"},{"panelist":"nobody","claim":"y","tag_given":"SRC","tag_should_be":"EST"},{"panelist":"mach-eigen","claim":"z","tag_given":"EST","tag_should_be":"EST"}]}`;
  const fc = parseFactcheck(raw, slugs);
  assert.deepEqual(fc.verdicts, { "margo-brandt": "Proceed.", "mach-eigen": "Clean." });
  assert.equal(fc.items.length, 1);
  assert.equal(fc.items[0].tag_should_be, "EST");
});

test("parseFactcheck degrades to a per-panelist note on garbage", () => {
  const fc = parseFactcheck("no json here", slugs);
  assert.equal(fc.items.length, 0);
  assert.match(fc.verdicts["mach-eigen"], /unavailable/);
  const fc2 = parseFactcheck("{not json}", slugs);
  assert.match(fc2.verdicts["margo-brandt"], /could not be parsed/);
});

// ---- TH-45: truncation repair and the degraded flag ----
import { repairTruncatedJson } from "./factcheck";
import { PANEL_ORDER } from "./roster";

const fullVerdicts = Object.fromEntries(PANEL_ORDER.map((s) => [s, `Grounded on the retrieved record; one projection over-tagged for ${s}.`]));
const fullItems = [
  { panelist: "margo-brandt", claim: "Hall 2 energizes in Q3 2027", tag_given: "SRC", tag_should_be: "EST", note: "A projection tagged SRC is always EST." },
  { panelist: "mach-eigen", claim: "800 VDC cuts conversion losses by 4 points", tag_given: "VRF", tag_should_be: "SRC", note: "Vendor brief, not a primary artifact." },
  { panelist: "albert-thorne", claim: "Utility queue position is 14th", tag_given: "SRC", tag_should_be: "INF", note: "Title not in the retrieved artifacts block." },
];
const fullPayload = JSON.stringify({ verdicts: fullVerdicts, items: fullItems });

test("valid JSON is parsed unchanged and is not marked repaired or degraded", () => {
  const fc = parseFactcheck(fullPayload, PANEL_ORDER);
  assert.equal(fc.degraded, undefined);
  assert.equal(fc.reason, undefined);
  assert.equal(fc.items.length, 3);
  assert.deepEqual(fc.verdicts, fullVerdicts);
  assert.equal(repairTruncatedJson(fullPayload), fullPayload);
});

test("a 400-token-style payload cut mid-item keeps all eight verdicts and every complete item", () => {
  const cut = fullPayload.indexOf('"claim":"Utility');
  const raw = fullPayload.slice(0, cut + 12); // ends inside the third item's claim string
  const fc = parseFactcheck(raw, PANEL_ORDER);
  assert.equal(fc.degraded, true);
  assert.equal(fc.reason, "repaired");
  assert.deepEqual(fc.verdicts, fullVerdicts);
  assert.equal(fc.items.length, 2, "the partial third item is dropped");
  assert.deepEqual(fc.items.map((i) => i.panelist), ["margo-brandt", "mach-eigen"]);
});

test("a payload cut mid-verdict string keeps the complete verdicts and flags the rest with raw.length", () => {
  const cut = fullPayload.indexOf(`"${PANEL_ORDER[5]}":`);
  const raw = "```json\n" + fullPayload.slice(0, cut + PANEL_ORDER[5].length + 12); // inside the sixth verdict's value
  const fc = parseFactcheck(raw, PANEL_ORDER);
  assert.equal(fc.reason, "repaired");
  for (const s of PANEL_ORDER.slice(0, 5)) assert.equal(fc.verdicts[s], fullVerdicts[s]);
  for (const s of PANEL_ORDER.slice(5)) {
    assert.match(fc.verdicts[s], /cut off/);
    assert.match(fc.verdicts[s], new RegExp(`grader output ${raw.length} chars`));
  }
  assert.equal(fc.items.length, 0);
});

test("a payload cut right after a comma (dangling separator) still parses", () => {
  const afterItemComma = fullPayload.indexOf("},{") + 2;
  const fc = parseFactcheck(fullPayload.slice(0, afterItemComma), PANEL_ORDER);
  assert.equal(fc.reason, "repaired");
  assert.equal(fc.items.length, 1);
  const afterVerdictComma = fullPayload.indexOf(`,"${PANEL_ORDER[1]}"`) + 1;
  const fc2 = parseFactcheck(fullPayload.slice(0, afterVerdictComma), PANEL_ORDER);
  assert.equal(fc2.verdicts[PANEL_ORDER[0]], fullVerdicts[PANEL_ORDER[0]]);
  assert.match(fc2.verdicts[PANEL_ORDER[1]], /cut off/);
});

test("repair drops a dangling key and colon and closes containers in reverse order", () => {
  assert.equal(repairTruncatedJson('{"verdicts":{"a":"x","b'), '{"verdicts":{"a":"x"}}');
  assert.equal(repairTruncatedJson('{"verdicts":{"a":"x"},"items":'), '{"verdicts":{"a":"x"}}');
  assert.equal(repairTruncatedJson('{"items":[{"p":"a"},{"p":"b"'), '{"items":[{"p":"a"}]}');
  assert.equal(repairTruncatedJson('{"a":"has \\"quoted } brace'), "{}");
});

test("text with no { is no_output and degraded; garbage with { is parse_failed; both carry raw.length", () => {
  const prose = "I reviewed all eight replies and the tags look broadly right.";
  const fc = parseFactcheck(prose, PANEL_ORDER);
  assert.equal(fc.degraded, true);
  assert.equal(fc.reason, "no_output");
  assert.match(fc.verdicts[PANEL_ORDER[0]], new RegExp(`no structured output \\(grader output ${prose.length} chars\\)`));
  const fc2 = parseFactcheck("{not json}", PANEL_ORDER);
  assert.equal(fc2.reason, "parse_failed");
  assert.match(fc2.verdicts[PANEL_ORDER[0]], /grader output 10 chars/);
});

test("a clean parse with zero downgrades is NOT degraded", () => {
  const fc = parseFactcheck(JSON.stringify({ verdicts: fullVerdicts, items: [] }), PANEL_ORDER);
  assert.equal(fc.items.length, 0);
  assert.equal(fc.degraded, undefined);
});
