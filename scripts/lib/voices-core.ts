// Voice and avatar plan for the panel (Linear TH-4). Pure helpers, no network.
// The plan pairs each panelist's HeyGen avatar look (src/data/panel.ts) with the
// voice in cast/_shared/voices.yaml. Nothing here spends credits.

export interface VoiceEntry {
  voice_id: string;
  voice_name: string;
  gender: "male" | "female";
  why: string;
  intro: string;
}
export interface VoicesFile {
  engine: string;
  status: "proposed" | "confirmed" | "rendered";
  panelists: Record<string, VoiceEntry>;
}
export interface PanelRow {
  slug: string;
  name: string;
  heygenGroupId: string;
  chosenLookId?: string;
}
export interface PlanRow {
  slug: string;
  name: string;
  avatar_look_id: string;
  voice_id: string;
  voice_name: string;
  engine: string;
  script: string;
  est_seconds: number;
}

/** Read panel members from panel.ts source text without importing it (one member per line). */
export function parsePanelSource(src: string): PanelRow[] {
  const rows: PanelRow[] = [];
  for (const line of src.split("\n")) {
    const slug = line.match(/slug:\s*"([^"]+)"/)?.[1];
    const group = line.match(/heygenGroupId:\s*"([0-9a-f]+)"/)?.[1];
    if (!slug || !group) continue;
    rows.push({
      slug,
      name: line.match(/name:\s*"([^"]+)"/)?.[1] ?? slug,
      heygenGroupId: group,
      chosenLookId: line.match(/chosenLookId:\s*"([0-9a-f]+)"/)?.[1],
    });
  }
  return rows;
}

// Real names that must never appear in a spoken line (TF-DEC-13). Archetype list lives in the audit snapshot.
export function validateVoices(v: VoicesFile, panel: PanelRow[], forbidden: string[] = []): string[] {
  const errs: string[] = [];
  if (!["proposed", "confirmed", "rendered"].includes(v.status)) errs.push(`unknown status "${v.status}"`);
  const slugs = new Set(panel.map((p) => p.slug));
  for (const p of panel) if (!v.panelists?.[p.slug]) errs.push(`${p.slug}: no voice`);
  const seen = new Map<string, string>();
  for (const [slug, e] of Object.entries(v.panelists ?? {})) {
    if (!slugs.has(slug)) errs.push(`${slug}: not a panelist`);
    if (!/^[0-9a-f]{32}$/.test(e.voice_id ?? "")) errs.push(`${slug}: voice_id is not a 32-hex id`);
    if (seen.has(e.voice_id)) errs.push(`${slug}: voice also used by ${seen.get(e.voice_id)}`);
    seen.set(e.voice_id, slug);
    if (!["male", "female"].includes(e.gender)) errs.push(`${slug}: gender must be male or female`);
    if (!e.intro?.trim()) errs.push(`${slug}: intro is empty`);
    for (const f of forbidden) if (e.intro?.includes(f)) errs.push(`${slug}: intro names "${f}"`);
  }
  return errs;
}

/** About 150 spoken words per minute. */
export const estSeconds = (text: string) => Math.ceil((text.trim().split(/\s+/).length / 150) * 60);

export function buildPlan(v: VoicesFile, panel: PanelRow[]): PlanRow[] {
  return panel.map((p) => {
    const e = v.panelists[p.slug];
    return {
      slug: p.slug,
      name: p.name,
      avatar_look_id: p.chosenLookId ?? p.heygenGroupId,
      voice_id: e.voice_id,
      voice_name: e.voice_name,
      engine: v.engine,
      script: e.intro,
      est_seconds: estSeconds(e.intro),
    };
  });
}
