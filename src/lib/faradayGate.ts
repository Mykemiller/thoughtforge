/**
 * Faraday beta access gate for ThoughtForge (FDY-414, ADM-1.7).
 *
 * A thin, ThoughtForge-owned wrapper around the vendored package in lib/faraday-gate/ (never edit that copy).
 * It is an ADDITIONAL layer on top of the magic-word wall in proxy.ts (TF_ACCESS_KEY / tf_access), which is
 * untouched and still answers first.
 *
 *  - Access key: "thoughtforge" (estate_entitled(p_email, 'thoughtforge')), seeded mode 'open', so nothing
 *    changes on merge: open mode passes through without looking up any identity.
 *  - Identity: ThoughtForge has no email sign-in of its own, so the only identity source is the gate's own
 *    Supabase Auth email one-time code, held in the httpOnly `fgate_at` cookie (distinct from `tf_access`).
 *  - Config: the existing env names NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 *    NEXT_PUBLIC_SUPABASE_ANON_KEY. The URL must name the project of record (the decoy project is refused).
 *  - Pre-migration safety: until estate_entitled exists, the mode probe fails (reason 'error'). That must not
 *    close ThoughtForge, so a probe error (or missing config) PASSES THROUGH unless FARADAY_GATE_ENFORCE === "1",
 *    in which case it fails closed. Any error AFTER a successful probe (e.g. the per-email check) fails closed,
 *    as the package intends.
 */
import { gateView, type GateCopy, type GateView } from "../../lib/faraday-gate/core";
import { appMode, type GateServerConfig } from "../../lib/faraday-gate/server/check";
import { guardRoute } from "../../lib/faraday-gate/server/guard";
import rawCopy from "../../lib/faraday-gate/gate-copy/thoughtforge.json";
import { assertProjectOfRecord } from "./supabase";

export const TF_GATE_APP = "thoughtforge";
export const TF_GATE_APP_NAME = "ThoughtForge Panel";
/** ThoughtForge has no legal pages of its own; the gate links to the Faraday master Terms and Privacy. */
export const TF_GATE_TERMS_URL = "https://www.faraday-intelligence.ai/terms";
export const TF_GATE_PRIVACY_URL = "https://www.faraday-intelligence.ai/privacy";

/**
 * FDY-433 (ADM-1.7h): paths that stay public in EVERY gate mode, because podcast apps cannot sign in.
 * The feed is a route handler (app/podcast/feed.xml/route.ts), which no layout wraps, so the gate in
 * app/podcast/layout.tsx never runs for it; the cover art is a static file in public/podcast/; the
 * episode audio the feed's <enclosure> tags point at is served from storage (audio_url), not this app.
 * src/lib/faradayGateCarveout.test.ts fails if any of these moves behind the gate or the magic-word wall.
 */
export const TF_GATE_PUBLIC_PATHS = ["/podcast/feed.xml", "/podcast/cover-600.png", "/podcast/cover-3000.png"] as const;

type Env = Record<string, string | undefined>;

/** The approved-or-draft gate copy for ThoughtForge (draft renders neutral text; see core.displayCopy). */
export const TF_GATE_COPY: GateCopy = {
  access_key: rawCopy.access_key,
  status: rawCopy.status === "approved" ? "approved" : "draft",
  app_name: rawCopy.app_name,
  story: rawCopy.story,
  what_you_get: rawCopy.what_you_get,
};

/** True only for the exact string "1". */
export function gateEnforced(env: Env = process.env): boolean {
  return env.FARADAY_GATE_ENFORCE === "1";
}

/** Gate config from ThoughtForge's existing env names; null when missing or not the project of record. */
export function gateConfigFromEnv(env: Env = process.env, fetchImpl?: typeof fetch): GateServerConfig | null {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  try {
    assertProjectOfRecord(supabaseUrl);
  } catch {
    return null;
  }
  const cfg: GateServerConfig = { supabaseUrl, serviceKey, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined };
  if (fetchImpl) cfg.fetchImpl = fetchImpl;
  return cfg;
}

export type TfGateDecision =
  | { pass: true; why: "open" | "allowed" | "probe_error_passthrough"; email: string | null }
  | { pass: false; why: "probe_error_enforced" | "denied"; view: GateView; email: string | null };

/**
 * Decide whether this request may see a ThoughtForge product surface.
 * `cookieHeader` is the raw Cookie header (only `fgate_at` is read from it).
 */
export async function tfGateDecision(
  opts: { cookieHeader?: string | null },
  deps: { env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<TfGateDecision> {
  const env = deps.env ?? process.env;
  const enforce = gateEnforced(env);
  const cfg = gateConfigFromEnv(env, deps.fetchImpl);

  if (!cfg) {
    return enforce
      ? { pass: false, why: "probe_error_enforced", view: "unavailable", email: null }
      : { pass: true, why: "probe_error_passthrough", email: null };
  }

  const probe = await appMode(TF_GATE_APP, cfg);
  if (probe.reason === "error") {
    return enforce
      ? { pass: false, why: "probe_error_enforced", view: gateView(probe, false), email: null }
      : { pass: true, why: "probe_error_passthrough", email: null };
  }

  // The probe succeeded: from here the package decides, and every failure is a denial.
  // guardRoute re-probes; a non-error probe is cached for 60 s, so this is not a second network call.
  const g = await guardRoute({ app: TF_GATE_APP, appEmail: null, cookieHeader: opts.cookieHeader ?? null }, cfg);
  if (g.pass) return { pass: true, why: g.identitySource === "none" ? "open" : "allowed", email: g.email };
  return { pass: false, why: "denied", view: g.view, email: g.email };
}

/** For route handlers behind the gate: null to continue, or a 403 JSON response. */
export async function tfGateApiDenial(
  req: Request,
  deps: { env?: Env; fetchImpl?: typeof fetch } = {},
): Promise<Response | null> {
  const d = await tfGateDecision({ cookieHeader: req.headers.get("cookie") }, deps);
  if (d.pass) return null;
  return Response.json(
    { error: d.view === "unavailable" ? "ThoughtForge Panel is unavailable right now." : "ThoughtForge Panel is in a private beta." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

