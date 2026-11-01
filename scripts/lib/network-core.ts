// Pure resolution logic for cast networks (Linear TH-15). No I/O here, so the
// same code runs against live Supabase or an offline snapshot.

export const PROJECT_REF = "ycadmmngkdhvpcsrcuaq";
export const DECOY_REF = "xgbpmlkanxewtfizloay";
export const KINDS = ["follows", "cites", "shared_room"] as const;
export const FORBIDDEN_KINDS = ["friend", "mentor", "endorsed", "worked_for"];
export const LATEST_SINCE = 2024; // TF-OPEN-08: connections date from before 2025

export type Kind = (typeof KINDS)[number];

export interface DraftEntry {
  name: string;
  relationship_kind: string;
  venue: string;
  since: number;
  evidence: string;
  expected_person_id?: string;
}

export interface Draft {
  slug: string;
  entries: DraftEntry[];
}

export interface PersonRow {
  person_id: string;
  canonical_name: string;
  aliases: string[] | null;
  primary_domain_code: string | null;
}
export interface AffiliationRow {
  person_id: string;
  employer_name: string | null;
  role_title: string | null;
  is_current: boolean;
  valid_from: string | null;
}
export interface DomainTagRow {
  person_id: string;
  subdomain_code: string;
  is_primary: boolean;
}
export interface OccupancyRow {
  person_id: string;
  office_name: string;
  role_title: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

/** What the resolver needs from the people spine. Live and snapshot sources both implement it. */
export interface PeopleSource {
  byCanonicalName(name: string): Promise<PersonRow[]>;
  byAlias(name: string): Promise<PersonRow[]>;
  currentAffiliations(ids: string[]): Promise<AffiliationRow[]>;
  domainTags(ids: string[]): Promise<DomainTagRow[]>;
  currentOffices(ids: string[]): Promise<OccupancyRow[]>;
}

export interface ResolvedEntry {
  person_id: string;
  name: string;
  canonical_name: string;
  resolution: "exact" | "alias";
  relationship_kind: Kind;
  venue: string;
  since: number;
  evidence: string;
  current_affiliation: { employer: string | null; role: string | null; source: "office_occupancies" | "person_affiliations" } | null;
  primary_domain_code: string | null;
  domain_tags: string[];
}

export interface UnresolvedEntry {
  name: string;
  resolution: "unresolved";
  reason: string;
  candidates?: { person_id: string; canonical_name: string }[];
  draft: DraftEntry;
}

export interface Resolution {
  slug: string;
  resolved: ResolvedEntry[];
  unresolved: UnresolvedEntry[];
}

const norm = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ");

function validateDraft(e: DraftEntry): string | null {
  if (!e || typeof e.name !== "string" || !norm(e.name)) return "missing name";
  if (FORBIDDEN_KINDS.includes(e.relationship_kind)) return `forbidden relationship_kind "${e.relationship_kind}"`;
  if (!(KINDS as readonly string[]).includes(e.relationship_kind)) return `unknown relationship_kind "${e.relationship_kind}"`;
  if (!e.venue || !norm(String(e.venue))) return "venue is required";
  if (!Number.isInteger(e.since) || e.since > LATEST_SINCE) return `since must be a year before 2025 (got ${e.since})`;
  return null;
}

function pickAffiliation(offices: OccupancyRow[], affs: AffiliationRow[]): ResolvedEntry["current_affiliation"] {
  // Officeholders resolve through office_occupancies first (DEC-IDF-07), so a seat change
  // shows up without editing the panelist's network.
  if (offices.length) {
    const o = [...offices].sort((a, b) => (b.valid_from ?? "").localeCompare(a.valid_from ?? ""))[0];
    return { employer: o.office_name, role: o.role_title, source: "office_occupancies" };
  }
  if (!affs.length) return null;
  const a = [...affs].sort((x, y) => (y.valid_from ?? "").localeCompare(x.valid_from ?? ""))[0];
  return { employer: a.employer_name, role: a.role_title, source: "person_affiliations" };
}

export async function resolveDraft(draft: Draft, src: PeopleSource): Promise<Resolution> {
  const resolved: ResolvedEntry[] = [];
  const unresolved: UnresolvedEntry[] = [];
  const seen = new Set<string>();

  for (const e of draft.entries ?? []) {
    const bad = validateDraft(e);
    if (bad) {
      unresolved.push({ name: e?.name ?? "", resolution: "unresolved", reason: bad, draft: e });
      continue;
    }
    const name = norm(e.name);
    let how: "exact" | "alias" = "exact";
    let rows = await src.byCanonicalName(name);
    if (!rows.length) {
      how = "alias";
      rows = await src.byAlias(name);
    }
    if (rows.length === 0) {
      unresolved.push({ name, resolution: "unresolved", reason: "no match on canonical_name or aliases", draft: e });
      continue;
    }
    if (rows.length > 1) {
      unresolved.push({
        name, resolution: "unresolved", reason: "ambiguous: more than one person matches",
        candidates: rows.map((r) => ({ person_id: r.person_id, canonical_name: r.canonical_name })), draft: e,
      });
      continue;
    }
    const p = rows[0];
    if (e.expected_person_id && e.expected_person_id !== p.person_id) {
      unresolved.push({
        name, resolution: "unresolved", reason: `person_id mismatch: draft expects ${e.expected_person_id}`,
        candidates: [{ person_id: p.person_id, canonical_name: p.canonical_name }], draft: e,
      });
      continue;
    }
    if (seen.has(p.person_id)) {
      unresolved.push({ name, resolution: "unresolved", reason: "duplicate: this person is already in the network", draft: e });
      continue;
    }
    seen.add(p.person_id);
    const [affs, tags, offices] = await Promise.all([
      src.currentAffiliations([p.person_id]),
      src.domainTags([p.person_id]),
      src.currentOffices([p.person_id]),
    ]);
    const tagCodes = [...tags]
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.subdomain_code.localeCompare(b.subdomain_code, "en", { numeric: true }))
      .map((t) => t.subdomain_code);
    resolved.push({
      person_id: p.person_id,
      name,
      canonical_name: p.canonical_name,
      resolution: how,
      relationship_kind: e.relationship_kind as Kind,
      venue: norm(e.venue),
      since: e.since,
      evidence: e.evidence ?? "",
      current_affiliation: pickAffiliation(offices, affs),
      primary_domain_code: p.primary_domain_code,
      domain_tags: [...new Set(tagCodes)],
    });
  }
  return { slug: draft.slug, resolved, unresolved };
}

/** Offline source over a JSON snapshot (cast/_fixtures/people-snapshot.json). */
export function snapshotSource(snap: {
  people: PersonRow[];
  person_affiliations: AffiliationRow[];
  person_domain_tags: DomainTagRow[];
  office_occupancies?: OccupancyRow[];
}): PeopleSource {
  const lc = (s: string) => norm(s).toLowerCase();
  return {
    async byCanonicalName(name) { return snap.people.filter((p) => lc(p.canonical_name) === lc(name)); },
    async byAlias(name) { return snap.people.filter((p) => (p.aliases ?? []).some((a) => norm(a) === norm(name))); },
    async currentAffiliations(ids) { return snap.person_affiliations.filter((a) => a.is_current && ids.includes(a.person_id)); },
    async domainTags(ids) { return snap.person_domain_tags.filter((t) => ids.includes(t.person_id)); },
    async currentOffices(ids) {
      const today = new Date().toISOString().slice(0, 10);
      return (snap.office_occupancies ?? []).filter((o) => ids.includes(o.person_id) && (!o.valid_to || o.valid_to >= today));
    },
  };
}

/** Project ref from a Supabase URL such as https://<ref>.supabase.co */
export function projectRefFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([a-z0-9]{20})\.supabase\.(co|in)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** True only for an anon or publishable key; a service role or secret key is refused. */
export function isAnonKey(key: string): boolean {
  if (key.startsWith("sb_publishable_")) return true;
  if (key.startsWith("sb_secret_")) return false;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return payload.role === "anon";
  } catch {
    return false;
  }
}
