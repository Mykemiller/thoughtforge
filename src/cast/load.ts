/**
 * Server-only entry for the cast loader (TH-27). Pages and route handlers
 * import from here; the "server-only" marker makes any client import a build
 * error instead of shipping the filesystem reads to the browser.
 */
import "server-only";

export { loadCast, loadCastWithShared, getMember, loadSharedSkills, dossierSection } from "./loader";
export type { Cast, CastMember, Persona, Network, NetworkEntry, Skill, SharedSkills } from "./types";
