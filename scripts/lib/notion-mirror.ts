// Cast to Notion mirror: page content, page resolution and the update-in-place write (Linear TH-28).
// The repo is the source of record; each Notion page is a read-only mirror (TF-DEC-40).
// Network calls go through the small NotionApi interface so tests run offline with a fake.

import { readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  markdownToBlocks, splitFrontMatter, paragraph, heading, divider, tableBlock, textBlock, richText, writeBlocks,
  plainText, body, type Block,
} from "./notion-blocks.ts";

// ---------- settings Myke may change ----------

/** Title of each panelist page. `{display_name}` is persona.json display_name. */
export const TITLE_TEMPLATE = "{display_name} — dossier (mirror)";
/** Title of the cast standard and shared cast page (mapping key `_standard`). */
export const STANDARD_TITLE = "Cast dossier standard and shared cast (mirror)";
/** "ThoughtForge Cast Sheet v1": every mirror page is a direct child of this page. */
export const CAST_SHEET_PAGE_ID = "40a89a0c168081819dc2e84a29a6e040";
/** Pages under the Cast Sheet the mirror never reads or writes, whatever the mapping says. */
export const NEVER_TOUCH: Record<string, string> = {
  "40b89a0c168081f59977f31fd7e31f8e": "Cast audit 2026-11-01",
};
export const MAPPING_PATH = "cast/_shared/notion-pages.json";
export const STANDARD_KEY = "_standard";
export const MARKER_PREFIX = "cast_slug:";
/** How many of a child page's first blocks are read when looking for its cast_slug marker. */
export const MARKER_SCAN_BLOCKS = 25;

export const normId = (id: string) => id.replace(/-/g, "").toLowerCase();
export const titleFor = (displayName: string) => TITLE_TEMPLATE.replace("{display_name}", displayName);

// ---------- mapping file ----------

export interface Mapping { parent_page_id: string; pages: Record<string, string>; [k: string]: unknown }

export function loadMapping(root: string): Mapping {
  const p = join(root, MAPPING_PATH);
  if (!existsSync(p)) return { parent_page_id: CAST_SHEET_PAGE_ID, pages: {} };
  const m = JSON.parse(readFileSync(p, "utf8")) as Mapping;
  if (normId(m.parent_page_id) !== CAST_SHEET_PAGE_ID) throw new Error(`${MAPPING_PATH} parent_page_id is not the Cast Sheet ${CAST_SHEET_PAGE_ID}`);
  for (const [k, id] of Object.entries(m.pages)) {
    if (!/^[0-9a-f]{32}$/.test(normId(id))) throw new Error(`${MAPPING_PATH}: ${k} has a malformed page id`);
    if (NEVER_TOUCH[normId(id)] || normId(id) === CAST_SHEET_PAGE_ID) throw new Error(`${MAPPING_PATH}: ${k} points at a protected page`);
  }
  return m;
}

export function saveMapping(root: string, m: Mapping) {
  writeFileSync(join(root, MAPPING_PATH), JSON.stringify(m, null, 2) + "\n");
}

// ---------- page content ----------

export interface MirrorMeta { sha: string; timestamp: string; dirty: boolean }
export interface MirrorDoc { key: string; title: string; blocks: Block[]; sources: string[] }

/** "2026-11-02 09:41 CST" in US Central. */
export function centralTimestamp(d: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short",
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

const commitText = (meta: MirrorMeta) => `${meta.sha}${meta.dirty ? " plus uncommitted changes" : ""}`;

function headerBlocks(key: string, what: string, meta: MirrorMeta): Block[] {
  return [
    ...textBlock("quote", richText(`Mirror of ${what} at commit ${commitText(meta)}, ${meta.timestamp}. Edit in the repo, not here.`)),
    // The marker the script keys on. Gray, so it reads as page furniture rather than content.
    ...paragraph(`${MARKER_PREFIX} ${key}`, { color: "gray" }),
    divider(),
  ];
}

const readText = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const readJson = <T>(root: string, p: string): T => JSON.parse(readText(root, p)) as T;

export function panelistSlugs(root: string): string[] {
  const cast = join(root, "cast");
  return readdirSync(cast, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(cast, d.name, "persona.json")))
    .map((d) => d.name).sort();
}

interface NetworkEntry { name: string; relationship_kind: string; venue: string }
interface SkillRef { name: string; path: string; kind: string }

function skillDescription(root: string, path: string): string {
  if (!existsSync(join(root, path))) return "";
  const { frontMatter } = splitFrontMatter(readText(root, path));
  if (!frontMatter) return "";
  try {
    const fm = parse(frontMatter) as { description?: unknown } | null;
    if (typeof fm?.description === "string") return fm.description.trim();
  } catch {
    // Some skill files carry an unquoted colon in description; read the line as written.
  }
  return frontMatter.match(/^description:\s*(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, "") ?? "";
}

export function panelistDoc(root: string, slug: string, meta: MirrorMeta): MirrorDoc {
  const dir = `cast/${slug}`;
  const persona = readJson<{ display_name: string; network?: NetworkEntry[]; skills?: SkillRef[] }>(root, `${dir}/persona.json`);
  const netFile = existsSync(join(root, dir, "network.json")) ? `${dir}/network.json` : null;
  const network = netFile ? readJson<{ entries: NetworkEntry[] }>(root, netFile).entries : persona.network ?? [];
  const skills = persona.skills ?? [];
  const sources = [`${dir}/dossier.md`, `${dir}/linkedin.md`, netFile ?? `${dir}/persona.json`, ...skills.map((s) => s.path)];

  const blocks: Block[] = [
    ...headerBlocks(slug, `cast/${slug}/`, meta),
    ...heading(1, "Dossier"),
    ...paragraph(`From \`${dir}/dossier.md\`.`, { color: "gray" }),
    ...markdownToBlocks(readText(root, `${dir}/dossier.md`), { headingOffset: 1 }),
    divider(),
    ...heading(1, "LinkedIn-style bio"),
    ...paragraph(`From \`${dir}/linkedin.md\`. In-app only; never posted to LinkedIn (TF-DEC-43).`, { color: "gray" }),
    ...markdownToBlocks(readText(root, `${dir}/linkedin.md`), { headingOffset: 1 }),
    divider(),
    ...heading(1, "Network"),
    ...paragraph(`From \`${netFile ?? `${dir}/persona.json`}\`. ${network.length} real-Voice entries.`, { color: "gray" }),
    ...(network.length
      ? [tableBlock([["Name", "Relationship kind", "Venue"], ...network.map((n) => [n.name, n.relationship_kind, n.venue])])]
      : paragraph("No network entries yet.")),
    divider(),
    ...heading(1, "Skills"),
    ...paragraph(`From the \`skills[]\` manifest in \`${dir}/persona.json\`.`, { color: "gray" }),
    ...skills.flatMap((s) => {
      const desc = skillDescription(root, s.path);
      return textBlock("bulleted_list_item", richText(`**${s.name}** (${s.kind})${desc ? `: ${desc}` : ""} \`${s.path}\``));
    }),
  ];
  return { key: slug, title: titleFor(persona.display_name), blocks, sources };
}

interface Associate { id: string; name: string; role: string; firm: string; knows: string[] }
interface Relationship { id: string; participants: string[]; where: string; years: string; what: string }

export function standardDoc(root: string, meta: MirrorMeta): MirrorDoc {
  const sharedSkills = readdirSync(join(root, "cast/_shared/skills"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, "cast/_shared/skills", d.name, "SKILL.md")))
    .map((d) => `cast/_shared/skills/${d.name}/SKILL.md`).sort();
  const associates = readJson<Associate[]>(root, "cast/_shared/associates.json");
  const relationships = readJson<Relationship[]>(root, "cast/_shared/relationships.json");
  const fromFile = (p: string) => paragraph(`From \`${p}\`.`, { color: "gray" });
  const md = (p: string) => markdownToBlocks(splitFrontMatter(readText(root, p)).body, { headingOffset: 1 });

  const blocks: Block[] = [
    ...headerBlocks(STANDARD_KEY, "docs/cast-standard.md and cast/_shared/", meta),
    ...heading(1, "Cast dossier standard"),
    ...fromFile("docs/cast-standard.md"),
    ...md("docs/cast-standard.md"),
    divider(),
    ...heading(1, "Shared skills"),
    ...fromFile("cast/_shared/skills/README.md"),
    ...md("cast/_shared/skills/README.md"),
    ...sharedSkills.flatMap((p) => [divider(), ...fromFile(p), ...md(p)]),
    divider(),
    ...heading(1, "Merged cast timeline"),
    ...fromFile("cast/_shared/timeline.md"),
    ...md("cast/_shared/timeline.md"),
    divider(),
    ...heading(1, "Fictional associates"),
    ...fromFile("cast/_shared/associates.json"),
    tableBlock([["Id", "Name", "Role", "Firm", "Knows"], ...associates.map((a) => [a.id, a.name, a.role, a.firm, a.knows.join(", ")])]),
    divider(),
    ...heading(1, "Shared history between panelists"),
    ...fromFile("cast/_shared/relationships.json"),
    tableBlock([["Id", "Panelists", "Where", "Years", "What"], ...relationships.map((r) => [r.id, r.participants.join(", "), r.where, r.years, r.what])]),
  ];
  return {
    key: STANDARD_KEY, title: STANDARD_TITLE, blocks,
    sources: ["docs/cast-standard.md", "cast/_shared/skills/README.md", ...sharedSkills, "cast/_shared/timeline.md", "cast/_shared/associates.json", "cast/_shared/relationships.json"],
  };
}

// ---------- Notion side ----------

export interface PageInfo { id: string; parentPageId: string | null; inTrash: boolean; title: string }
export interface ChildInfo { id: string; type: string; text: string }

export interface NotionApi {
  /** null when the page does not exist or the integration cannot see it. */
  getPage(id: string): Promise<PageInfo | null>;
  /** Children of a block or page in order; at most `limit` when given. */
  listChildren(id: string, limit?: number): Promise<ChildInfo[]>;
  /** Append children; returns the created top-level block ids in order. */
  append(parentId: string, children: Block[]): Promise<string[]>;
  /** Move a block to the trash (Notion's "delete block"). */
  archiveBlock(id: string): Promise<void>;
  createPage(parentPageId: string, title: string): Promise<string>;
  setTitle(pageId: string, title: string): Promise<void>;
}

export type Resolution =
  | { how: "mapping"; pageId: string }
  | { how: "marker"; pageId: string }
  | { how: "create" };

export const isProtected = (id: string) => normId(id) === CAST_SHEET_PAGE_ID || normId(id) in NEVER_TOUCH;

export function markerSlug(text: string): string | null {
  const m = text.trim().match(new RegExp(`^${MARKER_PREFIX}\\s*(\\S+)`));
  return m ? m[1] : null;
}

/** Finds pages by mapping first, then by cast_slug marker, else says to create. One per run. */
export class Resolver {
  private markers: Map<string, string[]> | null = null;
  readonly warnings: string[] = [];
  constructor(private api: NotionApi, private mapping: Mapping) {}

  private async markerIndex(): Promise<Map<string, string[]>> {
    if (this.markers) return this.markers;
    const index = new Map<string, string[]>();
    for (const child of await this.api.listChildren(CAST_SHEET_PAGE_ID)) {
      if (child.type !== "child_page" || isProtected(child.id)) continue;
      for (const b of await this.api.listChildren(child.id, MARKER_SCAN_BLOCKS)) {
        const slug = b.type === "paragraph" ? markerSlug(b.text) : null;
        if (slug) { index.set(slug, [...(index.get(slug) ?? []), normId(child.id)]); break; }
      }
    }
    this.markers = index;
    return index;
  }

  async resolve(key: string): Promise<Resolution> {
    const mapped = this.mapping.pages[key];
    if (mapped) {
      const page = await this.api.getPage(mapped);
      if (page && !page.inTrash) {
        if (normId(page.parentPageId ?? "") !== CAST_SHEET_PAGE_ID) throw new Error(`${key}: mapped page ${normId(mapped)} is not a direct child of the Cast Sheet; refusing to write`);
        return { how: "mapping", pageId: normId(mapped) };
      }
      this.warnings.push(`${key}: mapped page ${normId(mapped)} ${page ? "is in the trash" : "was not found or is not shared with the integration"}; looking for its cast_slug marker`);
    }
    const hits = (await this.markerIndex()).get(key) ?? [];
    if (hits.length > 1) throw new Error(`${key}: ${hits.length} pages under the Cast Sheet carry "${MARKER_PREFIX} ${key}" (${hits.join(", ")}); remove the extras or map one in ${MAPPING_PATH}`);
    if (hits.length === 1) return { how: "marker", pageId: hits[0] };
    return { how: "create" };
  }
}

export interface WriteResult { key: string; pageId: string; how: Resolution["how"]; archived: number; kept: number; appendCalls: number; renamed: boolean }

/** Block types that are pages or databases in their own right: never archived by the mirror. */
const KEEP_TYPES = new Set(["child_page", "child_database"]);

/**
 * Write one mirror page. Existing page: rename if needed, archive its own top-level blocks
 * (never sub-pages or databases), then append the new blocks. No page yet: create it under the
 * Cast Sheet and record its id in the mapping (the caller saves the file).
 */
export async function writeDoc(api: NotionApi, resolver: Resolver, mapping: Mapping, doc: MirrorDoc): Promise<WriteResult> {
  const r = await resolver.resolve(doc.key);
  const append = (parentId: string, children: Block[]) => api.append(parentId, children);
  if (r.how === "create") {
    const pageId = normId(await api.createPage(CAST_SHEET_PAGE_ID, doc.title));
    if (isProtected(pageId)) throw new Error(`created page ${pageId} is protected`); // cannot happen; belt and braces
    mapping.pages[doc.key] = pageId;
    const appendCalls = await writeBlocks(append, pageId, doc.blocks);
    return { key: doc.key, pageId, how: "create", archived: 0, kept: 0, appendCalls, renamed: false };
  }
  const pageId = r.pageId;
  if (isProtected(pageId)) throw new Error(`${doc.key}: refusing to write protected page ${pageId}`);
  const page = await api.getPage(pageId);
  if (!page || normId(page.parentPageId ?? "") !== CAST_SHEET_PAGE_ID) throw new Error(`${doc.key}: page ${pageId} is not a direct child of the Cast Sheet; refusing to write`);
  const renamed = page.title !== doc.title;
  if (renamed) await api.setTitle(pageId, doc.title);
  let archived = 0;
  let kept = 0;
  for (const child of await api.listChildren(pageId)) {
    if (KEEP_TYPES.has(child.type)) { kept++; continue; }
    await api.archiveBlock(child.id);
    archived++;
  }
  const appendCalls = await writeBlocks(append, pageId, doc.blocks);
  if (r.how === "marker") mapping.pages[doc.key] = pageId;
  return { key: doc.key, pageId, how: r.how, archived, kept, appendCalls, renamed };
}

/** The marker text of a block list, for tests and the dry run. */
export const markerOf = (blocks: Block[]): string | null => {
  for (const b of blocks) if (b.type === "paragraph") { const s = markerSlug(plainText(body(b).rich_text)); if (s) return s; }
  return null;
};
