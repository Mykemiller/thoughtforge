/**
 * The ten senders (TH-31). Built from the cast loader, never from a fallback
 * file: cast/<slug>/persona.json is the source of record (TF-DEC-40), and the
 * cast is fixed at ten (TF-DEC-31).
 */
import { dossierSection, loadCast } from "../cast/loader";
import type { CastMember } from "../cast/types";
import type { EmailPanelist } from "./types";

/** Resend sends from this subdomain only; the root domain's mail stays on Fastmail. */
export const SENDING_DOMAIN = "panel.faraday-thoughtforge.com";

/** Sender order for rotation and for Signal takeaways (the TH-31 table, identical to the manifest order). */
export const EMAIL_ORDER = [
  "gilbert-faraday",
  "margo-brandt",
  "mach-eigen",
  "delia-marchetti",
  "albert-thorne",
  "hartford-caldwell",
  "rosalind-ferraro",
  "victoria-stroud",
  "ingrid-halverson",
  "constance-wright",
] as const;

/** "Dr. Ingrid Halverson" -> "ingrid.halverson"; "Hartford Caldwell" -> "hartford.caldwell". */
export function localPart(displayName: string): string {
  const tokens = displayName
    .replace(/^Dr\.\s+/, "")
    .replace(/\s*\(.*\)\s*$/, "")
    .trim()
    .split(/\s+/)
    .map((t) => t.toLowerCase().normalize("NFD").replace(/[^a-z]/g, ""))
    .filter(Boolean);
  if (tokens.length < 2) throw new Error(`email: cannot derive first.last from "${displayName}"`);
  return `${tokens[0]}.${tokens[tokens.length - 1]}`;
}

/** Quoted display name, because "Dr." contains a period, which RFC 5322 does not allow unquoted. */
export function fromHeader(name: string, address: string): string {
  return `"${name.replace(/["\\]/g, "")}" <${address}>`;
}

export function toEmailPanelist(member: CastMember): EmailPanelist {
  const p = member.persona;
  const address = `${localPart(p.display_name)}@${SENDING_DOMAIN}`;
  return {
    slug: member.slug,
    name: p.display_name,
    firstName: p.short_name,
    role: p.role,
    address,
    from: fromHeader(p.display_name, address),
    domains: p.idf_domains.map((d) => `${d.code} ${d.name}`).join(", "),
    voiceBrief: p.voice_brief,
    sampleLine: p.sample_line,
    backstory: dossierSection(member.dossier, "Backstory"),
    lifeOutsideWork: dossierSection(member.dossier, "Life outside work"),
  };
}

/** All ten, in EMAIL_ORDER. Throws if the cast and the order ever drift. */
export function loadEmailPanelists(): EmailPanelist[] {
  const bySlug = new Map(loadCast().map((m) => [m.slug, m]));
  return EMAIL_ORDER.map((slug) => {
    const m = bySlug.get(slug);
    if (!m) throw new Error(`email: ${slug} is missing from the cast`);
    return toEmailPanelist(m);
  });
}

export function signature(p: Pick<EmailPanelist, "name" | "role">): string {
  return `${p.name}, ${p.role}\nThoughtForge panel, Faraday Intelligence`;
}
