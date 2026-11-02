// Mirror the cast to Notion: one read-only page per panelist under "ThoughtForge Cast Sheet v1",
// plus the cast standard and shared cast page (Linear TH-28, TF-DEC-40).
//
//   npm run mirror:cast -- --slug mach-eigen --dry-run   print the block tree; no token, no network
//   npm run mirror:cast -- --all --dry-run               every panelist plus _standard, summary per page
//   npm run mirror:cast -- --slug mach-eigen             write one page
//   npm run mirror:cast -- --all                         write all eleven pages
//
// Options: --full (dry run: print every block), --blocks <n> (dry run: print the first n blocks),
// --json (dry run: print the block JSON instead of the tree), --allow-dirty (live run from a tree
// with uncommitted cast changes; the header then says so).
//
// Live runs read NOTION_TOKEN from the environment or .env.local. Pages are found by
// cast/_shared/notion-pages.json first, then by their hidden "cast_slug:" line, and only then
// created. The script writes only those pages: never the Cast Sheet body, the decision log or
// any page in NEVER_TOUCH (lib/notion-mirror.ts). Run it by hand after a cast PR merges.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { BlockObjectRequest } from "@notionhq/client";
import { renderTree, typeCounts, countBlocks, writeBlocks } from "./lib/notion-blocks.ts";
import {
  panelistDoc, standardDoc, panelistSlugs, centralTimestamp, loadMapping, saveMapping, writeDoc, normId,
  Resolver, STANDARD_KEY, MAPPING_PATH, CAST_SHEET_PAGE_ID,
  type MirrorDoc, type MirrorMeta, type NotionApi, type ChildInfo,
} from "./lib/notion-mirror.ts";

const ROOT = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
}
function die(msg: string): never {
  console.error(`mirror:cast ABORT: ${msg}`);
  process.exit(1);
}

function loadEnvLocal() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// Piping into head or grep closes stdout early; that is not an error.
process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); throw e; });

const git = (...a: string[]) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();

// ---------- the real Notion adapter ----------

const MIN_INTERVAL_MS = 350; // Notion's documented average is three requests a second.

async function notionAdapter(token: string): Promise<NotionApi> {
  // Loaded only for live runs, so a dry run needs neither the token nor the client. The package is
  // CommonJS, so its exports arrive on the default import under NodeNext.
  const { Client } = (await import("@notionhq/client")).default;
  const client = new Client({ auth: token });
  let last = 0;
  const pace = async () => {
    const wait = last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  };
  const textOf = (b: Record<string, unknown>): string => {
    const t = b.type as string;
    const inner = b[t] as { rich_text?: { plain_text: string }[]; title?: string } | undefined;
    if (t === "child_page") return inner?.title ?? "";
    return (inner?.rich_text ?? []).map((r) => r.plain_text).join("");
  };
  return {
    async getPage(id) {
      await pace();
      try {
        const p = (await client.pages.retrieve({ page_id: id })) as unknown as {
          id: string; in_trash?: boolean; archived?: boolean; parent: { type: string; page_id?: string };
          properties?: Record<string, { type: string; title?: { plain_text: string }[] }>;
        };
        const titleProp = Object.values(p.properties ?? {}).find((v) => v.type === "title");
        return {
          id: normId(p.id),
          parentPageId: p.parent.type === "page_id" && p.parent.page_id ? normId(p.parent.page_id) : null,
          inTrash: Boolean(p.in_trash ?? p.archived),
          title: (titleProp?.title ?? []).map((t) => t.plain_text).join(""),
        };
      } catch (e) {
        if ((e as { code?: string }).code === "object_not_found") return null;
        throw e;
      }
    },
    async listChildren(id, limit) {
      const out: ChildInfo[] = [];
      let cursor: string | undefined;
      do {
        await pace();
        const res = await client.blocks.children.list({ block_id: id, start_cursor: cursor, page_size: Math.min(100, limit ?? 100) });
        for (const b of res.results as unknown as Record<string, unknown>[]) out.push({ id: normId(b.id as string), type: b.type as string, text: textOf(b) });
        cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
      } while (cursor && (limit === undefined || out.length < limit));
      return limit === undefined ? out : out.slice(0, limit);
    },
    async append(parentId, children) {
      await pace();
      const res = await client.blocks.children.append({ block_id: parentId, children: children as unknown as BlockObjectRequest[] });
      return res.results.map((r) => normId(r.id));
    },
    async archiveBlock(id) {
      await pace();
      await client.blocks.delete({ block_id: id });
    },
    async createPage(parentPageId, title) {
      await pace();
      const p = await client.pages.create({ parent: { page_id: parentPageId }, properties: { title: { title: [{ text: { content: title } }] } } });
      return normId(p.id);
    },
    async setTitle(pageId, title) {
      await pace();
      await client.pages.update({ page_id: pageId, properties: { title: { title: [{ text: { content: title } }] } } });
    },
  };
}

// ---------- main ----------

async function main() {
  const dry = flag("dry-run");
  const all = flag("all");
  const slug = arg("slug");
  if (all === Boolean(slug)) die("pass exactly one of --slug <slug> or --all");

  const slugs = panelistSlugs(ROOT);
  const keys = all ? [...slugs, STANDARD_KEY] : [slug as string];
  for (const k of keys) if (k !== STANDARD_KEY && !slugs.includes(k)) die(`unknown slug ${k} (known: ${[...slugs, STANDARD_KEY].join(", ")})`);

  const sha = git("rev-parse", "--short", "HEAD");
  const dirty = git("status", "--porcelain", "--", "cast", "docs/cast-standard.md") !== "";
  if (dirty && !dry && !flag("allow-dirty")) die("cast/ or docs/cast-standard.md has uncommitted changes; commit them first or pass --allow-dirty");
  const meta: MirrorMeta = { sha, timestamp: centralTimestamp(new Date()), dirty };
  const mapping = loadMapping(ROOT);
  const docs: MirrorDoc[] = keys.map((k) => (k === STANDARD_KEY ? standardDoc(ROOT, meta) : panelistDoc(ROOT, k, meta)));

  if (dry) {
    const max = flag("full") ? Infinity : Number(arg("blocks") ?? (all ? 12 : Infinity));
    console.log(`mirror:cast dry run at commit ${sha}${dirty ? " (uncommitted cast changes)" : ""}, ${meta.timestamp}. No Notion calls.`);
    console.log(`Parent: ThoughtForge Cast Sheet v1 (${CAST_SHEET_PAGE_ID}). Mapping: ${MAPPING_PATH}.`);
    for (const d of docs) {
      // Plan the writes against a recorder so the dry run reports the real batching.
      let fake = 0;
      const calls = await writeBlocks(async (_p, children) => children.map(() => `dry-${fake++}`), "dry-page", d.blocks);
      const mapped = mapping.pages[d.key];
      console.log(`\n=== ${d.key}: "${d.title}"`);
      console.log(mapped
        ? `target: page ${normId(mapped)} from the mapping (live run checks its parent, renames it if needed, archives its top-level blocks, then appends)`
        : `target: not in the mapping; live run looks for "cast_slug: ${d.key}" under the Cast Sheet, else creates the page`);
      const counts = Object.entries(typeCounts(d.blocks)).map(([t, n]) => `${t} ${n}`).join(", ");
      console.log(`blocks: ${d.blocks.length} top-level, ${countBlocks(d.blocks)} in all (${counts}); ${calls} append call${calls === 1 ? "" : "s"}`);
      console.log(`sources: ${d.sources.join(", ")}`);
      if (flag("json")) { console.log(JSON.stringify(d.blocks, null, 2)); continue; }
      const lines = renderTree(d.blocks, max);
      for (const l of lines) console.log(`  ${l}`);
      if (lines.length < countBlocks(d.blocks)) console.log(`  … ${countBlocks(d.blocks) - lines.length} more blocks (--full prints all)`);
    }
    return;
  }

  loadEnvLocal();
  const token = process.env.NOTION_TOKEN;
  if (!token) die("NOTION_TOKEN is not set (put it in .env.local or the environment; see the TH-28 PR for setup)");
  const api = await notionAdapter(token);
  const resolver = new Resolver(api, mapping);
  const before = JSON.stringify(mapping.pages);
  let failed = 0;
  for (const d of docs) {
    try {
      const r = await writeDoc(api, resolver, mapping, d);
      console.log(`${d.key}: ${r.how === "create" ? "created" : "updated"} page ${r.pageId} via ${r.how}; archived ${r.archived} old blocks${r.kept ? `, kept ${r.kept} sub-pages` : ""}; ${r.appendCalls} append calls${r.renamed ? `; renamed to "${d.title}"` : ""}`);
    } catch (e) {
      failed++;
      console.error(`${d.key}: FAILED ${(e as Error).message}`);
    }
  }
  for (const w of resolver.warnings) console.warn(`warning: ${w}`);
  if (JSON.stringify(mapping.pages) !== before) {
    saveMapping(ROOT, mapping);
    console.log(`Updated ${MAPPING_PATH} with new page ids; commit it.`);
  }
  if (failed) die(`${failed} of ${docs.length} pages failed`);
}

main().catch((e) => die((e as Error).message));
