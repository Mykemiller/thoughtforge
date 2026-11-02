/**
 * Publisher tiering for retrieved artifacts (TH-32 §4.2). An artifact whose
 * domain belongs to a government, regulator, utility, ISO/RTO or standards body
 * is `primary` and may support a [VRF] tag; everything else is `secondary`.
 * Panel rulings are `panel` and are only ever [SRC].
 */
export type ArtifactSource = "primary" | "secondary" | "panel";

const PRIMARY_SUFFIXES = [".gov", ".mil", ".gov.uk", ".gc.ca", ".europa.eu"];
const PRIMARY_HOSTS = [
  // ISOs and RTOs
  "pjm.com", "ercot.com", "caiso.com", "misoenergy.org", "spp.org", "nyiso.com", "iso-ne.com", "ieso.ca", "aeso.ca",
  // standards bodies
  "ieee.org", "nfpa.org", "ashrae.org", "iso.org", "iec.ch", "ansi.org", "opencompute.org", "tiaonline.org", "ul.com", "uptimeinstitute.com", "thegreengrid.org", "nerc.com", "nema.org", "bicsi.org",
  // utilities and public power
  "dominionenergy.com", "duke-energy.com", "oncor.com", "aep.com", "southerncompany.com", "georgiapower.com", "xcelenergy.com", "pge.com", "sce.com", "sdge.com", "entergy.com", "nexteraenergy.com", "fpl.com", "pacificorp.com", "ameren.com", "evergy.com", "nvenergy.com", "aps.com", "srpnet.com", "tva.com", "bpa.gov", "comed.com", "exeloncorp.com", "pseg.com", "firstenergycorp.com", "centerpointenergy.com", "cpsenergy.com", "austinenergy.com", "ladwp.com", "smud.org", "pnm.com", "idahopower.com", "portlandgeneral.com", "pacificpower.net", "puget.com", "hydroquebec.com", "bchydro.com",
];

export function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isPrimaryHost(host: string | null): boolean {
  if (!host) return false;
  if (PRIMARY_SUFFIXES.some((s) => host.endsWith(s))) return true;
  return PRIMARY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function tierForUrl(url: string | null | undefined): Exclude<ArtifactSource, "panel"> {
  return isPrimaryHost(hostnameOf(url)) ? "primary" : "secondary";
}
