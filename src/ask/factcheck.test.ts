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
