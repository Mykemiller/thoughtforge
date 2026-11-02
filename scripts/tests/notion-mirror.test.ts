// Offline tests for the cast Notion mirror (Linear TH-28): the Markdown converter, the API-limit
// batching, page content, and page resolution against a fake Notion. No network, no token.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  richText, markdownToBlocks, tableBlock, paragraph, writeBlocks, batches, splitForRequest, body, plainText, countBlocks,
  MAX_TEXT, MAX_RICH_TEXT_ITEMS, MAX_CHILDREN, MAX_LIST_DEPTH, type Block, type RichText,
} from "../lib/notion-blocks.ts";
import {
  panelistDoc, standardDoc, panelistSlugs, centralTimestamp, loadMapping, writeDoc, Resolver, markerOf, titleFor,
  CAST_SHEET_PAGE_ID, NEVER_TOUCH, STANDARD_KEY, TITLE_TEMPLATE,
  type NotionApi, type PageInfo, type ChildInfo, type Mapping, type MirrorMeta,
} from "../lib/notion-mirror.ts";

const ROOT = resolve(import.meta.dirname, "..", "..");
const META: MirrorMeta = { sha: "abc1234", timestamp: "2026-11-02 09:00 CST", dirty: false };
const AUDIT_PAGE = "40b89a0c168081f59977f31fd7e31f8e";

// ---------- converter ----------

test("rich text splits at 2,000 characters and keeps every character", () => {
  const long = "x".repeat(4500);
  const items = richText(`**${long}**`);
  assert.equal(items.length, 3);
  assert.ok(items.every((r) => r.text.content.length <= MAX_TEXT && r.annotations?.bold));
  assert.equal(plainText(items), long);
});

test("inline bold, italic, code and links; snake_case is not italic", () => {
  const items = richText("A **bold** and *it* and `code_x` and [site](https://example.com) and cast_slug_value");
  const find = (t: string) => items.find((r) => r.text.content === t);
  assert.equal(find("bold")?.annotations?.bold, true);
  assert.equal(find("it")?.annotations?.italic, true);
  assert.equal(find("code_x")?.annotations?.code, true);
  assert.equal(find("site")?.text.link?.url, "https://example.com");
  assert.ok(items[items.length - 1].text.content.endsWith("cast_slug_value"));
  assert.equal(items[items.length - 1].annotations, undefined);
});

test("a paragraph past 100 rich-text items continues in another paragraph", () => {
  const md = Array.from({ length: 130 }, (_, i) => `**b${i}** p${i}`).join(" ");
  const blocks = paragraph(md);
  assert.ok(blocks.length >= 2);
  assert.ok(blocks.every((b) => (body(b).rich_text ?? []).length <= MAX_RICH_TEXT_ITEMS));
  assert.equal(blocks.map((b) => plainText(body(b).rich_text)).join(""), plainText(richText(md)));
});

test("headings, lists with hard-break continuations, tables, code and rules", () => {
  const md = [
    "# Title", "", "## Section", "", "Para line one", "line two.", "",
    "- **Role**, Firm · 2020  ", "  What they did.", "- Second", "",
    "1. First", "2. Second", "",
    "| A | B |", "| --- | --- |", "| 1 | 2 |", "| 3 |", "",
    "```json", '{"k": 1}', "```", "", "---", "> quoted",
  ].join("\n");
  const b = markdownToBlocks(md, { headingOffset: 1 });
  assert.deepEqual(b.map((x) => x.type), [
    "heading_2", "heading_3", "paragraph", "bulleted_list_item", "bulleted_list_item",
    "numbered_list_item", "numbered_list_item", "table", "code", "divider", "quote",
  ]);
  assert.equal(plainText(body(b[2]).rich_text), "Para line one line two.");
  assert.equal(plainText(body(b[3]).rich_text), "Role, Firm · 2020\nWhat they did.");
  const table = body(b[7]);
  assert.equal(table.table_width, 2);
  assert.equal(table.has_column_header, true);
  assert.deepEqual((table.children ?? []).map((r) => (body(r).cells ?? []).map(plainText)), [["A", "B"], ["1", "2"], ["3", ""]]);
  assert.equal(body(b[8]).language, "json");
});

test("nested bullets nest, and depth is capped", () => {
  const md = ["- a", "  - b", "    - c", "      - d", "- e"].join("\n");
  const b = markdownToBlocks(md);
  assert.equal(b.length, 2);
  const depth = (x: Block): number => 1 + Math.max(0, ...(body(x).children ?? []).map(depth));
  assert.equal(depth(b[0]), MAX_LIST_DEPTH);
  const c = body(body(b[0]).children![0]).children![0];
  assert.deepEqual((body(c).children ?? []).length, 0);
  assert.deepEqual(body(body(b[0]).children![0]).children!.map((x) => plainText(body(x).rich_text)), ["c", "d"]);
});

// ---------- batching ----------

const recorder = () => {
  const calls: { parent: string; n: number; children: Block[] }[] = [];
  let id = 0;
  const append = async (parent: string, children: Block[]) => { calls.push({ parent, n: children.length, children }); return children.map(() => `id${id++}`); };
  return { calls, append };
};

test("append batches hold at most 100 top-level blocks", async () => {
  const blocks = Array.from({ length: 250 }, (_, i) => paragraph(`p${i}`)[0]);
  assert.deepEqual(batches(blocks).map((x) => x.length), [100, 100, 50]);
  const r = recorder();
  assert.equal(await writeBlocks(r.append, "page", blocks), 3);
  assert.ok(r.calls.every((c) => c.parent === "page" && c.n <= MAX_CHILDREN));
});

test("a table over 100 rows is created with 100 and gets the rest appended to it", async () => {
  const rows = [["h1", "h2"], ...Array.from({ length: 149 }, (_, i) => [`r${i}`, "v"])];
  const r = recorder();
  const calls = await writeBlocks(r.append, "page", [tableBlock(rows)]);
  assert.equal(calls, 2);
  assert.equal((body(r.calls[0].children[0]).children ?? []).length, 100);
  assert.equal(r.calls[1].parent, "id0");
  assert.equal(r.calls[1].n, 50);
  assert.ok(r.calls[1].children.every((c) => c.type === "table_row"));
});

test("blocks nested deeper than one request allows are appended level by level", async () => {
  const leaf = (t: string): Block => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(t) } });
  const nest = (t: string, kids: Block[]): Block => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(t), children: kids } });
  const deep = nest("1", [nest("2", [nest("3", [leaf("4")])])]);
  assert.equal(splitForRequest(deep).later.length, 1);
  const r = recorder();
  await writeBlocks(r.append, "page", [deep]);
  const maxDepth = (bs: Block[]): number => Math.max(0, ...bs.map((b) => 1 + maxDepth(body(b).children ?? [])));
  assert.ok(r.calls.every((c) => maxDepth(c.children) <= 3));
  assert.equal(r.calls.reduce((n, c) => n + countBlocks(c.children), 0), 4);
});

// ---------- page content ----------

test("US Central timestamp follows daylight time", () => {
  assert.equal(centralTimestamp(new Date("2026-11-02T15:00:00Z")), "2026-11-02 09:00 CST");
  assert.equal(centralTimestamp(new Date("2026-07-04T15:00:00Z")), "2026-07-04 10:00 CDT");
});

test("panelist page: title, header line, marker, network table and skills list", () => {
  const doc = panelistDoc(ROOT, "mach-eigen", META);
  const persona = JSON.parse(readFileSync(join(ROOT, "cast/mach-eigen/persona.json"), "utf8"));
  assert.equal(TITLE_TEMPLATE, "{display_name} — dossier (mirror)");
  assert.equal(doc.title, "Mach Eigen — dossier (mirror)");
  assert.equal(plainText(body(doc.blocks[0]).rich_text), "Mirror of cast/mach-eigen/ at commit abc1234, 2026-11-02 09:00 CST. Edit in the repo, not here.");
  assert.equal(markerOf(doc.blocks), "mach-eigen");
  const net = doc.blocks.find((b) => b.type === "table" && plainText(body(body(b).children![0]).cells![0]) === "Name")!;
  assert.deepEqual(body(body(net).children![0]).cells!.map(plainText), ["Name", "Relationship kind", "Venue"]);
  const skillsAt = doc.blocks.findIndex((b) => b.type === "heading_1" && plainText(body(b).rich_text) === "Skills");
  assert.equal(doc.blocks.slice(skillsAt).filter((b) => b.type === "bulleted_list_item").length, persona.skills.length);
  assert.equal(titleFor("Dr. Ingrid Halverson"), "Dr. Ingrid Halverson — dossier (mirror)");
});

test("every page the mirror would write stays inside Notion's limits", () => {
  const docs = [...panelistSlugs(ROOT).map((s) => panelistDoc(ROOT, s, META)), standardDoc(ROOT, META)];
  assert.equal(docs.length, 11);
  const check = (bs: Block[], depth: number) => {
    for (const b of bs) {
      const bd = body(b);
      const texts: RichText[][] = [bd.rich_text ?? [], ...(bd.cells ?? [])];
      for (const t of texts) {
        assert.ok(t.length <= MAX_RICH_TEXT_ITEMS, `${b.type} has ${t.length} rich-text items`);
        for (const r of t) assert.ok(r.text.content.length <= MAX_TEXT);
      }
      if (b.type === "table") assert.ok((bd.children ?? []).every((r) => (r.table_row?.cells ?? []).length === bd.table_width));
      check(bd.children ?? [], depth + 1);
    }
  };
  for (const d of docs) { check(d.blocks, 0); assert.equal(markerOf(d.blocks), d.key); }
});

// ---------- mapping ----------

test("mapping names every panelist and the standard page, and no protected page", () => {
  const m = loadMapping(ROOT);
  assert.deepEqual(Object.keys(m.pages).sort(), [...panelistSlugs(ROOT), STANDARD_KEY].sort());
  for (const id of Object.values(m.pages)) {
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.notEqual(id, CAST_SHEET_PAGE_ID);
    assert.ok(!(id in NEVER_TOUCH));
  }
  assert.ok(AUDIT_PAGE in NEVER_TOUCH);
});

// ---------- resolution and writes against a fake Notion ----------

interface FakePage { parent: string; title: string; inTrash?: boolean; children: ChildInfo[] }
function fakeNotion(pages: Record<string, FakePage>) {
  const log: string[] = [];
  const touched = new Set<string>();
  let n = 0;
  const api: NotionApi = {
    async getPage(id): Promise<PageInfo | null> {
      touched.add(id);
      const p = pages[id];
      return p ? { id, parentPageId: p.parent, inTrash: Boolean(p.inTrash), title: p.title } : null;
    },
    async listChildren(id, limit) {
      touched.add(id);
      const kids = pages[id]?.children ?? [];
      return limit === undefined ? kids : kids.slice(0, limit);
    },
    async append(parentId, children) {
      log.push(`append ${parentId} ${children.length}`);
      const ids = children.map(() => `new${n++}`);
      if (pages[parentId]) pages[parentId].children.push(...children.map((c, i) => ({ id: ids[i], type: c.type, text: plainText(body(c).rich_text) })));
      return ids;
    },
    async archiveBlock(id) {
      log.push(`archive ${id}`);
      for (const p of Object.values(pages)) p.children = p.children.filter((c) => c.id !== id);
    },
    async createPage(parent, title) {
      const id = `${(n++).toString(16).padStart(32, "f")}`;
      log.push(`create ${parent} ${title}`);
      pages[id] = { parent, title, children: [] };
      pages[parent]?.children.push({ id, type: "child_page", text: title });
      return id;
    },
    async setTitle(pageId, title) { log.push(`title ${pageId} ${title}`); pages[pageId].title = title; },
  };
  return { api, log, touched, pages };
}

const P = (c: string) => c.repeat(32).slice(0, 32);
const sheetChildren = (...ids: string[]): ChildInfo[] => ids.map((id) => ({ id, type: "child_page", text: "" }));
const doc = (key: string) => ({ key, title: `${key} — dossier (mirror)`, blocks: [paragraph(`cast_slug: ${key}`)[0], paragraph("body")[0]], sources: [] });
const mappingOf = (pages: Record<string, string>): Mapping => ({ parent_page_id: CAST_SHEET_PAGE_ID, pages });

test("a mapped page is updated in place: renamed, old blocks archived, sub-pages kept, nothing created", async () => {
  const f = fakeNotion({
    [CAST_SHEET_PAGE_ID]: { parent: "root", title: "Cast Sheet", children: sheetChildren(P("a"), AUDIT_PAGE) },
    [P("a")]: { parent: CAST_SHEET_PAGE_ID, title: "Mach Eigen — Chief Engineer (dossier v2 draft)", children: [
      { id: "old1", type: "paragraph", text: "hand mirror" }, { id: "old2", type: "heading_2", text: "Identity" }, { id: "sub", type: "child_page", text: "notes" },
    ] },
    [AUDIT_PAGE]: { parent: CAST_SHEET_PAGE_ID, title: "Cast audit 2026-11-01", children: [{ id: "x", type: "paragraph", text: "cast_slug: mach-eigen" }] },
  });
  const mapping = mappingOf({ "mach-eigen": P("a") });
  const r = await writeDoc(f.api, new Resolver(f.api, mapping), mapping, doc("mach-eigen"));
  assert.equal(r.how, "mapping");
  assert.equal(r.pageId, P("a"));
  assert.deepEqual([r.archived, r.kept, r.renamed], [2, 1, true]);
  assert.deepEqual(f.log, [`title ${P("a")} mach-eigen — dossier (mirror)`, "archive old1", "archive old2", `append ${P("a")} 2`]);
  assert.deepEqual(f.pages[P("a")].children.map((c) => c.id), ["sub", "new0", "new1"]);
  assert.ok(!f.touched.has(AUDIT_PAGE));
  assert.ok(!f.log.some((l) => l.includes(CAST_SHEET_PAGE_ID)));
});

test("an unmapped page is found by its cast_slug marker; the audit page is never read", async () => {
  const f = fakeNotion({
    [CAST_SHEET_PAGE_ID]: { parent: "root", title: "Cast Sheet", children: [{ id: "intro", type: "paragraph", text: "Cast Sheet body" }, ...sheetChildren(AUDIT_PAGE, P("b"), P("c"))] },
    [AUDIT_PAGE]: { parent: CAST_SHEET_PAGE_ID, title: "Cast audit", children: [{ id: "x", type: "paragraph", text: "cast_slug: margo-brandt" }] },
    [P("b")]: { parent: CAST_SHEET_PAGE_ID, title: "Decision log", children: [{ id: "d1", type: "paragraph", text: "TF-DEC-01" }] },
    [P("c")]: { parent: CAST_SHEET_PAGE_ID, title: "Margo Brandt — dossier (mirror)", children: [{ id: "h", type: "quote", text: "Mirror of" }, { id: "m", type: "paragraph", text: "cast_slug: margo-brandt" }] },
  });
  const mapping = mappingOf({});
  const r = await writeDoc(f.api, new Resolver(f.api, mapping), mapping, doc("margo-brandt"));
  assert.equal(r.how, "marker");
  assert.equal(r.pageId, P("c"));
  assert.equal(mapping.pages["margo-brandt"], P("c"));
  assert.ok(!f.touched.has(AUDIT_PAGE));
  assert.ok(f.log.every((l) => l.includes(P("c")) || l.startsWith("archive h") || l.startsWith("archive m")));
  assert.equal(f.pages[P("b")].children.length, 1); // decision log untouched
  assert.equal(f.pages[CAST_SHEET_PAGE_ID].children.length, 4); // Cast Sheet body untouched
});

test("with no mapping and no marker the page is created under the Cast Sheet and recorded", async () => {
  const f = fakeNotion({ [CAST_SHEET_PAGE_ID]: { parent: "root", title: "Cast Sheet", children: [] } });
  const mapping = mappingOf({});
  const r = await writeDoc(f.api, new Resolver(f.api, mapping), mapping, doc("albert-thorne"));
  assert.equal(r.how, "create");
  assert.equal(f.log[0], `create ${CAST_SHEET_PAGE_ID} albert-thorne — dossier (mirror)`);
  assert.equal(mapping.pages["albert-thorne"], r.pageId);
  // A second run finds the page through the mapping and does not create another one.
  const again = await writeDoc(f.api, new Resolver(f.api, mapping), mapping, doc("albert-thorne"));
  assert.equal(again.how, "mapping");
  assert.equal(f.log.filter((l) => l.startsWith("create")).length, 1);
});

test("a mapped page outside the Cast Sheet is refused before any write", async () => {
  const f = fakeNotion({ [P("d")]: { parent: P("e"), title: "Elsewhere", children: [{ id: "k", type: "paragraph", text: "keep" }] } });
  const mapping = mappingOf({ "mach-eigen": P("d") });
  await assert.rejects(writeDoc(f.api, new Resolver(f.api, mapping), mapping, doc("mach-eigen")), /not a direct child of the Cast Sheet/);
  assert.deepEqual(f.log, []);
});

test("two pages carrying the same marker is an error, not a guess", async () => {
  const f = fakeNotion({
    [CAST_SHEET_PAGE_ID]: { parent: "root", title: "Cast Sheet", children: sheetChildren(P("1"), P("2")) },
    [P("1")]: { parent: CAST_SHEET_PAGE_ID, title: "one", children: [{ id: "a", type: "paragraph", text: "cast_slug: mach-eigen" }] },
    [P("2")]: { parent: CAST_SHEET_PAGE_ID, title: "two", children: [{ id: "b", type: "paragraph", text: "cast_slug: mach-eigen" }] },
  });
  const mapping = mappingOf({});
  await assert.rejects(writeDoc(f.api, new Resolver(f.api, mapping), mapping, doc("mach-eigen")), /2 pages under the Cast Sheet/);
  assert.deepEqual(f.log, []);
});

test("a mapped page that is gone falls back to the marker, with a warning", async () => {
  const f = fakeNotion({
    [CAST_SHEET_PAGE_ID]: { parent: "root", title: "Cast Sheet", children: sheetChildren(P("9")) },
    [P("9")]: { parent: CAST_SHEET_PAGE_ID, title: "x", children: [{ id: "m", type: "paragraph", text: "cast_slug: mach-eigen" }] },
  });
  const mapping = mappingOf({ "mach-eigen": P("8") });
  const resolver = new Resolver(f.api, mapping);
  const r = await writeDoc(f.api, resolver, mapping, doc("mach-eigen"));
  assert.equal(r.how, "marker");
  assert.equal(mapping.pages["mach-eigen"], P("9"));
  assert.match(resolver.warnings[0], /not found/);
});

test("the mapping file refuses protected pages", () => {
  const root = mkdtempSync(join(tmpdir(), "tf-mirror-"));
  mkdirSync(join(root, "cast/_shared"), { recursive: true });
  const write = (pages: Record<string, string>) =>
    writeFileSync(join(root, "cast/_shared/notion-pages.json"), JSON.stringify({ parent_page_id: CAST_SHEET_PAGE_ID, pages }));
  write({ "mach-eigen": AUDIT_PAGE });
  assert.throws(() => loadMapping(root), /protected page/);
  write({ "mach-eigen": CAST_SHEET_PAGE_ID });
  assert.throws(() => loadMapping(root), /protected page/);
  write({ "mach-eigen": "not-an-id" });
  assert.throws(() => loadMapping(root), /malformed/);
  write({ "mach-eigen": "40b89a0c-1680-8196-a69e-c46501aa61bf" });
  assert.equal(Object.keys(loadMapping(root).pages).length, 1);
});
