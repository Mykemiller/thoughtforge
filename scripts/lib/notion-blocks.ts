// Small Markdown to Notion block converter for the cast mirror (Linear TH-28). Pure; no I/O.
//
// Covers what the cast files use: headings, paragraphs, bulleted and numbered lists (with
// continuation lines and nesting), tables, fenced code, block quotes and horizontal rules, plus
// inline bold, italic, strikethrough, code and links. Notion API limits handled here:
//   - 2,000 characters per rich-text item (longer text is split across items)
//   - 100 rich-text items per block (longer paragraphs and list items split into extra blocks)
//   - 100 children per append call and two levels of nesting per request (see planWrite)
//   - list nesting is capped at MAX_LIST_DEPTH; deeper items are kept at the deepest level.

export const MAX_TEXT = 2000;
export const MAX_RICH_TEXT_ITEMS = 100;
export const MAX_CHILDREN = 100;
/** Upper bound on blocks in one append request (Notion allows 1,000; stay well under). */
export const MAX_BLOCKS_PER_REQUEST = 900;
/** Bulleted or numbered nesting: top level plus two nested levels (Notion's per-request nesting limit). */
export const MAX_LIST_DEPTH = 3;

export interface Annotations { bold?: boolean; italic?: boolean; strikethrough?: boolean; code?: boolean }
export interface RichText {
  type: "text";
  text: { content: string; link?: { url: string } };
  annotations?: Annotations;
}

export type TextBlockType =
  | "paragraph" | "heading_1" | "heading_2" | "heading_3"
  | "bulleted_list_item" | "numbered_list_item" | "quote";
export type BlockType = TextBlockType | "code" | "divider" | "table" | "table_row";

export interface BlockBody {
  rich_text?: RichText[];
  color?: string;
  children?: Block[];
  language?: string;
  table_width?: number;
  has_column_header?: boolean;
  has_row_header?: boolean;
  cells?: RichText[][];
}
export type Block = { object: "block"; type: BlockType } & Partial<Record<BlockType, BlockBody>>;

export const body = (b: Block): BlockBody => b[b.type] ?? {};

// ---------- rich text ----------

/** Split one run of text into items of at most MAX_TEXT characters, keeping annotations and link. */
function textItems(content: string, ann: Annotations, url?: string): RichText[] {
  const out: RichText[] = [];
  const chars = Array.from(content); // do not split a surrogate pair
  for (let i = 0; i < chars.length; i += MAX_TEXT) {
    const item: RichText = { type: "text", text: { content: chars.slice(i, i + MAX_TEXT).join("") } };
    if (url) item.text.link = { url };
    const a = Object.fromEntries(Object.entries(ann).filter(([, v]) => v)) as Annotations;
    if (Object.keys(a).length) item.annotations = a;
    out.push(item);
  }
  return out;
}

const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/;

/** Inline Markdown to rich text. Links keep their URL only when it is http(s). */
export function richText(md: string, ann: Annotations = {}): RichText[] {
  const out: RichText[] = [];
  let rest = md;
  while (rest.length) {
    const m = rest.match(INLINE);
    if (!m || m.index === undefined) { out.push(...textItems(rest, ann)); break; }
    if (m.index > 0) out.push(...textItems(rest.slice(0, m.index), ann));
    const [, code, b1, b2, strike, linkText, url, i1, i2] = m;
    if (code !== undefined) out.push(...textItems(code, { ...ann, code: true }));
    else if (b1 !== undefined || b2 !== undefined) out.push(...richText(b1 ?? b2, { ...ann, bold: true }));
    else if (strike !== undefined) out.push(...richText(strike, { ...ann, strikethrough: true }));
    else if (linkText !== undefined) {
      if (/^https?:\/\//.test(url)) out.push(...textItems(linkText, ann, url));
      else out.push(...richText(linkText, ann));
    } else out.push(...richText(i1 ?? i2, { ...ann, italic: true }));
    rest = rest.slice(m.index + m[0].length);
  }
  return mergeAdjacent(out);
}

/** Join neighbouring items with identical annotations and link, then re-split at MAX_TEXT. */
function mergeAdjacent(items: RichText[]): RichText[] {
  const key = (r: RichText) => JSON.stringify([r.annotations ?? {}, r.text.link?.url ?? null]);
  const merged: RichText[] = [];
  for (const r of items) {
    const last = merged[merged.length - 1];
    if (last && key(last) === key(r)) last.text.content += r.text.content;
    else merged.push({ ...r, text: { ...r.text } });
  }
  return merged.flatMap((r) => (Array.from(r.text.content).length > MAX_TEXT ? textItems(r.text.content, r.annotations ?? {}, r.text.link?.url) : [r]));
}

export const plainText = (items: RichText[] | undefined): string => (items ?? []).map((r) => r.text.content).join("");

// ---------- block constructors ----------

export function textBlock(type: TextBlockType, rich: RichText[], extra: Partial<BlockBody> = {}): Block[] {
  // A block holds at most MAX_RICH_TEXT_ITEMS items; overflow continues in another block of the same type.
  const chunks: RichText[][] = [];
  for (let i = 0; i < Math.max(rich.length, 1); i += MAX_RICH_TEXT_ITEMS) chunks.push(rich.slice(i, i + MAX_RICH_TEXT_ITEMS));
  if (type.startsWith("heading_") && chunks.length > 1) {
    // Headings do not repeat: fold the overflow into one plain item (still split at MAX_TEXT).
    const head = rich.slice(0, MAX_RICH_TEXT_ITEMS - 1);
    const tail = textItems(plainText(rich.slice(MAX_RICH_TEXT_ITEMS - 1)), {}).slice(0, 1);
    return [{ object: "block", type, [type]: { rich_text: [...head, ...tail], ...extra } }];
  }
  const noKids: Partial<BlockBody> = { ...extra };
  delete noKids.children; // continuation blocks never repeat the children
  return chunks.map((c, i) => ({ object: "block", type, [type]: { rich_text: c, ...(i === 0 ? extra : noKids) } }));
}

export const paragraph = (md: string, extra: Partial<BlockBody> = {}) => textBlock("paragraph", richText(md), extra);
export const heading = (level: 1 | 2 | 3, md: string) => textBlock(`heading_${level}`, richText(md));
export const divider = (): Block => ({ object: "block", type: "divider", divider: {} });

const CODE_LANGUAGES = new Set(["bash", "shell", "json", "yaml", "typescript", "javascript", "markdown", "sql", "python", "diff", "html", "css"]);
export function codeBlock(code: string, lang: string): Block {
  const l = lang.toLowerCase();
  const language = l === "sh" ? "shell" : l === "ts" ? "typescript" : l === "js" ? "javascript" : l === "md" ? "markdown" : l === "yml" ? "yaml" : CODE_LANGUAGES.has(l) ? l : "plain text";
  // Code text is split at MAX_TEXT like any rich text; a block keeps at most MAX_RICH_TEXT_ITEMS items.
  const items = textItems(code, {}).slice(0, MAX_RICH_TEXT_ITEMS);
  return { object: "block", type: "code", code: { rich_text: items, language } };
}

/** Fit a table cell into the rich-text item cap. */
function cell(md: string): RichText[] {
  const r = richText(md.trim());
  return r.length <= MAX_RICH_TEXT_ITEMS ? r : [...r.slice(0, MAX_RICH_TEXT_ITEMS - 1), ...textItems(plainText(r.slice(MAX_RICH_TEXT_ITEMS - 1)), {}).slice(0, 1)];
}

/** A Notion table block. The first row is the column header. Rows are padded to the widest row. */
export function tableBlock(rows: string[][], hasHeader = true): Block {
  const width = Math.max(1, ...rows.map((r) => r.length));
  return {
    object: "block", type: "table",
    table: {
      table_width: width, has_column_header: hasHeader, has_row_header: false,
      children: rows.map((r) => ({ object: "block", type: "table_row", table_row: { cells: Array.from({ length: width }, (_, i) => cell(r[i] ?? "")) } })),
    },
  };
}

// ---------- Markdown ----------

export interface MarkdownOptions {
  /** Added to each heading level (# with offset 1 becomes heading_2). Levels past 3 become heading_3. */
  headingOffset?: number;
}

/** Split `---\n<yaml>\n---\n<body>` front matter off a Markdown file. */
export function splitFrontMatter(md: string): { frontMatter: string | null; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { frontMatter: m[1], body: m[2] } : { frontMatter: null, body: md };
}

const splitRow = (line: string): string[] => {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
};
const isTableSep = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;

interface ListItem { depth: number; type: "bulleted_list_item" | "numbered_list_item"; lines: string[] }

/** Join source lines the way Markdown does: a trailing double space or backslash is a hard break. */
function joinLines(lines: string[]): string {
  let out = "";
  lines.forEach((l, i) => {
    const hard = / {2,}$/.test(l) || /\\$/.test(l);
    const text = l.replace(/\\$/, "").trim();
    out += text + (i < lines.length - 1 ? (hard ? "\n" : " ") : "");
  });
  return out;
}

function listBlocks(items: ListItem[]): Block[] {
  const roots: Block[] = [];
  const stack: Block[] = []; // stack[d] is the last block at depth d
  for (const it of items) {
    const depth = Math.min(it.depth, MAX_LIST_DEPTH - 1, stack.length);
    const [first, ...more] = textBlock(it.type, richText(joinLines(it.lines)));
    const siblings = depth === 0 ? roots : (body(stack[depth - 1]).children ??= []);
    siblings.push(first, ...more);
    stack.length = depth;
    stack.push(more.length ? more[more.length - 1] : first);
  }
  return roots;
}

/** Convert a Markdown document to Notion blocks. */
export function markdownToBlocks(md: string, opts: MarkdownOptions = {}): Block[] {
  const offset = opts.headingOffset ?? 0;
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: ListItem[] = [];
  const flushPara = () => { if (para.length) out.push(...paragraph(joinLines(para))); para = []; };
  const flushQuote = () => { if (quote.length) out.push(...textBlock("quote", richText(joinLines(quote)))); quote = []; };
  const flushList = () => { if (list.length) out.push(...listBlocks(list)); list = []; };
  const flushAll = () => { flushPara(); flushQuote(); flushList(); };
  let listIndentUnit = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(FENCE);
    if (fence) {
      flushAll();
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && !new RegExp(`^\\s*${fence[1]}\\s*$`).test(lines[j])) code.push(lines[j++]);
      out.push(codeBlock(code.join("\n"), fence[2] ?? ""));
      i = j;
      continue;
    }
    if (!line.trim()) { flushAll(); continue; }
    const h = line.match(HEADING);
    if (h) {
      flushAll();
      out.push(...heading(Math.min(3, h[1].length + offset) as 1 | 2 | 3, h[2]));
      continue;
    }
    if (RULE.test(line) && !list.length) { flushAll(); out.push(divider()); continue; }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushAll();
      const rows = [splitRow(line)];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) rows.push(splitRow(lines[j++]));
      out.push(tableBlock(rows));
      i = j - 1;
      continue;
    }
    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
    const li = line.match(LIST);
    if (li) {
      flushPara(); flushQuote();
      const indent = li[1].replace(/\t/g, "    ").length;
      if (indent > 0 && !listIndentUnit) listIndentUnit = indent;
      const depth = indent === 0 ? 0 : Math.round(indent / (listIndentUnit || 2));
      list.push({ depth, type: /\d/.test(li[2]) ? "numbered_list_item" : "bulleted_list_item", lines: [li[3]] });
      continue;
    }
    if (list.length) {
      // Continuation line. A sub-numbered line such as "3a. ..." starts on its own line.
      const cur = list[list.length - 1].lines;
      if (/^\s*\d+[a-z][.)]\s/.test(line)) cur[cur.length - 1] = cur[cur.length - 1].replace(/\s*$/, "  ");
      cur.push(line);
      continue;
    }
    if (quote.length) flushQuote();
    para.push(line);
  }
  flushAll();
  return out;
}

// ---------- write planning ----------

export const countBlocks = (blocks: Block[]): number => blocks.reduce((n, b) => n + 1 + countBlocks(body(b).children ?? []), 0);
const depthOf = (b: Block): number => 1 + Math.max(0, ...(body(b).children ?? []).map(depthOf));

function withChildren(b: Block, children: Block[] | undefined): Block {
  const copy: Block = { object: "block", type: b.type, [b.type]: { ...body(b) } };
  if (children && children.length) body(copy).children = children;
  else delete body(copy).children;
  return copy;
}

/**
 * Split one block into what can go in a single append request and the children that must be
 * appended to it afterwards. A request carries at most two levels of nesting and at most
 * MAX_CHILDREN children per array. A table always carries its first rows (Notion requires them).
 */
export function splitForRequest(b: Block): { inline: Block; later: Block[] } {
  const kids = body(b).children ?? [];
  if (!kids.length) return { inline: b, later: [] };
  if (b.type === "table") return { inline: withChildren(b, kids.slice(0, MAX_CHILDREN)), later: kids.slice(MAX_CHILDREN) };
  const fits = kids.length <= MAX_CHILDREN && depthOf(b) <= 3 && kids.every((k) => (body(k).children ?? []).length <= MAX_CHILDREN);
  return fits ? { inline: b, later: [] } : { inline: withChildren(b, undefined), later: kids };
}

/** Group blocks into append batches: at most MAX_CHILDREN top-level and MAX_BLOCKS_PER_REQUEST total each. */
export function batches(blocks: Block[]): Block[][] {
  const out: Block[][] = [];
  let cur: Block[] = [];
  let size = 0;
  for (const b of blocks) {
    const n = countBlocks([b]);
    if (cur.length && (cur.length >= MAX_CHILDREN || size + n > MAX_BLOCKS_PER_REQUEST)) { out.push(cur); cur = []; size = 0; }
    cur.push(b); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Minimal surface the writer needs: append children and get the created top-level ids back in order. */
export type AppendFn = (parentId: string, children: Block[]) => Promise<string[]>;

/** Append blocks under parentId within the API limits. Returns the number of append calls made. */
export async function writeBlocks(append: AppendFn, parentId: string, blocks: Block[]): Promise<number> {
  const split = blocks.map(splitForRequest);
  let calls = 0;
  let k = 0;
  for (const batch of batches(split.map((s) => s.inline))) {
    const ids = await append(parentId, batch);
    calls++;
    if (ids.length !== batch.length) throw new Error(`append returned ${ids.length} ids for ${batch.length} blocks under ${parentId}`);
    for (let i = 0; i < batch.length; i++, k++) {
      if (split[k].later.length) calls += await writeBlocks(append, ids[i], split[k].later);
    }
  }
  return calls;
}

// ---------- dry-run printing ----------

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One line per block, indented by depth. Stops after `max` lines when given. */
export function renderTree(blocks: Block[], max = Infinity, width = 110): string[] {
  const lines: string[] = [];
  const walk = (bs: Block[], depth: number) => {
    for (const b of bs) {
      if (lines.length >= max) return;
      const bd = body(b);
      let text = "";
      if (b.type === "table") text = `${bd.table_width} columns x ${(bd.children ?? []).length} rows${bd.has_column_header ? ", header row" : ""}`;
      else if (b.type === "table_row") text = (bd.cells ?? []).map(plainText).join(" | ");
      else if (b.type === "code") text = `[${bd.language}] ${plainText(bd.rich_text).replace(/\n/g, " ⏎ ")}`;
      else if (b.type !== "divider") text = plainText(bd.rich_text).replace(/\n/g, " ⏎ ");
      const color = bd.color && bd.color !== "default" ? ` (${bd.color})` : "";
      lines.push(clip(`${"  ".repeat(depth)}${b.type}${color}${text ? `  ${text}` : ""}`, width));
      walk(bd.children ?? [], depth + 1);
    }
  };
  walk(blocks, 0);
  return lines;
}

export function typeCounts(blocks: Block[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (bs: Block[]) => { for (const b of bs) { counts[b.type] = (counts[b.type] ?? 0) + 1; walk(body(b).children ?? []); } };
  walk(blocks);
  return counts;
}
