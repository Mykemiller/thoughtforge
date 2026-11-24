/**
 * FDY-297 (ADM-2.4) — the panel email settings as data. SERVER-ONLY (reads the Faraday service-role key).
 *
 * PANEL_SIGNAL_MODE and the reply caps are read from the Faraday config store (app TF, v_effective_config)
 * through ../config/resolver. A value set in the Workbench console wins within 60 s, with no redeploy. If the
 * read fails, the key is unknown, the value is out of range, or nobody has set a value, the validated env value
 * from readEmailEnv() stays: fail closed. Secrets (RESEND_*, PANEL_CRON_SECRET, ANTHROPIC_API_KEY,
 * SUPABASE_SERVICE_ROLE_KEY, LINEAR_API_KEY) are never settings and are never read or logged here.
 */
import { createResolver, resolveSettings, type Resolver } from "../config/resolver";
import type { EmailEnv } from "./env";
import { SIGNAL_MODES } from "./types";

export const PANEL_APP_CODE = "TF";

export const PANEL_SETTING_SPECS = (env: EmailEnv) => ({
  signalMode: { key: "panel_signal_mode", type: "enum" as const, options: SIGNAL_MODES, env: (): string => env.signalMode },
  maxRepliesPerThreadPerDay: { key: "panel_reply_max_per_thread_per_day", type: "integer" as const, min: 1, max: 100, env: () => env.maxRepliesPerThreadPerDay },
  maxDaily: { key: "panel_max_daily", type: "integer" as const, min: 1, max: 10, env: () => env.maxDaily },
});

const resolver = createResolver();

/** The env with the panel settings overlaid. Never throws. */
export async function applyPanelSettings(env: EmailEnv, r: Pick<Resolver, "resolve"> = resolver): Promise<EmailEnv> {
  const got = await resolveSettings(r, PANEL_APP_CODE, PANEL_SETTING_SPECS(env));
  return {
    ...env,
    signalMode: got.values.signalMode as EmailEnv["signalMode"],
    maxRepliesPerThreadPerDay: got.values.maxRepliesPerThreadPerDay,
    maxDaily: got.values.maxDaily,
  };
}
