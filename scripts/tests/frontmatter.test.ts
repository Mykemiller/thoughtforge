import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseArtifactMarkdown } from "../lib/frontmatter.ts";

test("artifact front matter parses the example file", () => {
  const doc = parseArtifactMarkdown(readFileSync("artifacts/inbox/_example.md", "utf8"));
  assert.equal(doc.title, "Example: a fictional county's large-load interconnection memo");
  assert.equal(doc.source, "secondary");
  assert.equal(doc.published_at, "2026-10-15");
  assert.deepEqual(doc.idf_domains, ["D2", "D3"]);
  assert.ok(doc.body.startsWith("This is an original"));
  assert.equal(doc.url, null);
});

test("artifact front matter rejects missing title, bad source, bad date and bad url", () => {
  assert.throws(() => parseArtifactMarkdown("no front matter"), /front matter/);
  assert.throws(() => parseArtifactMarkdown("---\npublisher: x\n---\nbody"), /title/);
  assert.throws(() => parseArtifactMarkdown("---\ntitle: t\nsource: rumor\n---\nbody"), /source must be/);
  assert.throws(() => parseArtifactMarkdown("---\ntitle: t\npublished_at: 15/10/2026\n---\nbody"), /YYYY-MM-DD/);
  assert.throws(() => parseArtifactMarkdown("---\ntitle: t\nurl: ftp://x\n---\nbody"), /http/);
  assert.throws(() => parseArtifactMarkdown("---\ntitle: t\n---\n"), /body is empty/);
  const d = parseArtifactMarkdown("---\ntitle: t\ntags: a, b\npublished_at: 2026-01-02\nurl: https://example.com/x\n---\nbody");
  assert.deepEqual(d.tags, ["a", "b"]);
  assert.equal(d.published_at, "2026-01-02");
});
