/**
 * personal lane (TH-66): what each panelist's v2 dossier already says in structured bullets
 * under "Life outside work" ("- Sports: ...", "- Hobbies: ...") and "Family". Dossier prose
 * is read, never changed (TF-DEC-87); the dossiers already have a structured form, so no
 * life.yaml was added.
 */
import type { EmailPanelist } from "../types";
import { teamsIn } from "./sports";
import type { PersonalLane } from "./types";

/** "- Sports: Cubs fan since birth. [FIC]" -> { sports: "Cubs fan since birth." }. Keys are lower-cased up to the colon. */
export function bullets(section: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of section.split("\n")) {
    const m = line.match(/^\s*-\s+([^:]{2,60}):\s*(.+)$/);
    if (m) out[m[1].trim().toLowerCase()] = clean(m[2]);
  }
  return out;
}

/** Evidence tags out ([FIC], [PUB]); whitespace folded. */
export const clean = (s: string) => s.replace(/\s*\[[A-Z]{2,5}\]\s*/g, " ").replace(/\s+/g, " ").trim();

export function personalLaneFor(p: Pick<EmailPanelist, "lifeOutsideWork" | "family">): PersonalLane {
  const b = bullets(p.lifeOutsideWork ?? "");
  const pick = (match: (k: string) => boolean) => Object.entries(b).find(([k]) => match(k))?.[1] ?? "";
  const family = (p.family ?? "")
    .split("\n")
    .map((l) => l.match(/^\s*-\s+(.+)$/)?.[1])
    .filter((l): l is string => Boolean(l))
    .map(clean);
  const sports = pick((k) => k.startsWith("sports"));
  return {
    sports,
    hobbies: pick((k) => k.startsWith("hobbies")),
    laughs: pick((k) => k.startsWith("what makes") && k.includes("laugh")),
    places: pick((k) => k.startsWith("favorite places")),
    family,
    teams: teamsIn(sports),
  };
}

export function personalLanes(panelists: readonly EmailPanelist[]): Record<string, PersonalLane> {
  return Object.fromEntries(panelists.map((p) => [p.slug, personalLaneFor(p)]));
}
