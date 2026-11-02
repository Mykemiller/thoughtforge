/**
 * Pure helpers that turn cast files into bio-page content (TH-12, TH-29).
 * No I/O here; everything takes already-loaded strings or persona objects.
 */
import type { CastMember, CareerEntry, Education, PersonaNetworkEntry, RelationshipKind } from "./types";

/** The "## About" paragraph(s) of linkedin.md, as plain text. */
export function aboutFromLinkedin(md: string): string {
  const m = md.match(/^## About\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
  return (m?.[1] ?? "").trim();
}

/** Human label for a network relationship kind, as the bio page shows it. */
export function relationshipLabel(kind: RelationshipKind): string {
  return kind === "follows" ? "follows" : kind === "cites" ? "cites" : "shared a room with";
}

export const formatSpan = (c: CareerEntry) => `${c.start}–${c.end ?? "present"}`;

export const formatDegree = (e: Education) => [e.degree, e.field].filter(Boolean).join(", ");

/** Career newest first, as a résumé reads. */
export function experience(member: CastMember): CareerEntry[] {
  return [...member.persona.career].sort((a, b) => (b.end ?? 9999) - (a.end ?? 9999) || b.start - a.start);
}

export function education(member: CastMember): Education[] {
  return [...member.persona.education].sort((a, b) => b.year - a.year);
}

export interface VoiceRow {
  name: string;
  kind: string;
  venue: string;
  since: number;
}

/** Voices exactly as network.json records them; order kept. */
export function voices(member: CastMember): VoiceRow[] {
  const entries: PersonaNetworkEntry[] | undefined = member.network.entries?.length ? undefined : member.persona.network;
  const rows = member.network.entries?.length ? member.network.entries : entries ?? [];
  return rows.map((e) => ({ name: e.name, kind: relationshipLabel(e.relationship_kind), venue: e.venue, since: e.since }));
}

export interface LifeRow {
  label: string;
  value: string;
}

/** The "Life outside work" rows in the order the page shows them. */
export function lifeOutsideWork(member: CastMember): LifeRow[] {
  const p = member.persona.personal;
  const first = member.persona.short_name;
  return [
    { label: "Hobbies", value: p.hobbies.join(" ") },
    { label: "Sports", value: p.sports },
    { label: "Favorite places", value: p.vacations.join("; ") },
    { label: `What makes ${first} laugh`, value: p.laughs },
    { label: `What makes ${first} smile`, value: p.smiles },
    { label: "A regret", value: p.regrets },
    { label: "Frailties", value: p.frailties },
    { label: "Generosity", value: p.generosity },
    { label: "Modesty", value: p.modesty },
  ].filter((r) => r.value);
}
