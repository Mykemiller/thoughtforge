/**
 * Hand-written TypeScript types for the cast files (TH-27).
 * Mirrors cast/_schema/persona.schema.json; the loader validates every
 * persona.json against that schema with ajv, so these types describe data
 * that has already passed the contract. No codegen dependency (TH-32).
 */

export type EvidenceTag = "FIC" | "REAL-ORG" | "REAL-EVENT" | "VOICE";
export type RelationshipKind = "follows" | "cites" | "shared_room";

export interface IdfDomain {
  code: string; // D1..D99
  name: string;
}

export interface FamilyMember {
  name: string;
  relation: string;
  note?: string;
  evidence: "FIC";
}

export interface Education {
  institution: string;
  degree: string;
  field?: string;
  year: number;
  evidence: "REAL-ORG";
}

export interface CareerEntry {
  start: number;
  end: number | null;
  employer: string;
  title: string;
  location?: string;
  summary?: string;
  evidence: "FIC" | "REAL-ORG";
}

/** One real Voice in a panelist's network, as persona.json records it. */
export interface PersonaNetworkEntry {
  person_id: string;
  name: string;
  relationship_kind: RelationshipKind;
  venue: string;
  evidence: "VOICE";
  since: number; // <= 2024
  basis?: string;
}

export interface Organization {
  name: string;
  role?: string;
  since?: number;
  evidence?: EvidenceTag;
}

export interface License {
  name: string;
  issuer: string;
  year: number;
  evidence?: EvidenceTag;
}

export interface Publication {
  title: string;
  venue: string;
  year: number;
  kind?: string;
  evidence?: { title: EvidenceTag; venue: EvidenceTag } | EvidenceTag;
}

export interface SkillRef {
  name: string;
  path: string;
  kind: "persona" | "shared";
}

export interface GdeltLens {
  archetype: string;
  asks: string[];
  guardrails: string[];
}

export interface Personal {
  hobbies: string[];
  sports: string;
  laughs: string;
  smiles: string;
  regrets: string;
  vacations: string[];
  frailties: string;
  generosity: string;
  modesty: string;
}

export interface Moment {
  date: string;
  event: string;
  venue: string;
  what: string;
  shared_with?: string[];
  evidence?: { event: EvidenceTag; attendance: EvidenceTag };
}

export interface Persona {
  slug: string;
  display_name: string;
  short_name: string;
  role: string;
  idf_domains: IdfDomain[];
  domains_as_written?: string;
  born_year: number;
  hometown: string;
  family: FamilyMember[];
  education: Education[];
  career: CareerEntry[];
  associates: string[];
  relationships: string[];
  network_status: "pending_tf_open_08" | "resolved";
  network_rule?: string;
  network: PersonaNetworkEntry[];
  organizations: Organization[];
  licenses?: License[];
  publications?: Publication[];
  skills: SkillRef[];
  gdelt_lens: GdeltLens;
  voice_brief: string;
  sample_line?: string;
  evidence_tags: EvidenceTag[];
  linear_issue?: string;
  personal: Personal;
  moments: Moment[];
}

/** One resolved entry in cast/<slug>/network.json (written by resolve-network). */
export interface NetworkEntry {
  person_id: string;
  name: string;
  canonical_name: string;
  resolution: "exact" | "alias";
  relationship_kind: RelationshipKind;
  venue: string;
  since: number;
  evidence: string;
  current_affiliation?: { employer: string; role: string; source: string };
  primary_domain_code?: string;
  domain_tags?: string[];
}

export interface Network {
  slug: string;
  rule: string;
  resolved_against: string;
  source: string;
  resolved_on: string;
  entries: NetworkEntry[];
}

/** A SKILL.md file parsed: front matter plus body. */
export interface Skill {
  name: string;
  description: string;
  kind: "persona" | "shared";
  path: string;
  body: string; // markdown after the front matter
}

/** Everything the app knows about one panelist, joined on slug with src/data/panel.ts. */
export interface CastMember {
  slug: string;
  order: number;
  persona: Persona;
  network: Network;
  dossier: string; // raw markdown
  linkedin: string; // raw markdown
  skills: Skill[]; // the panelist's own (kind: "persona"), in manifest order
  /** One-line voice brief from the dossier (identical to persona.voice_brief by the register check). */
  voiceBrief: string;
}

export interface SharedSkills {
  evidenceLadder: Skill;
  faradayRetrieval: Skill;
  gdeltResearch: Skill;
  all: Skill[];
}

export interface Cast {
  members: CastMember[];
  shared: SharedSkills;
}
