/**
 * Panel email environment (TH-31). One place reads it; it fails fast and
 * never prints a value, only variable names.
 *
 * Hand-written instead of zod: zod is not a dependency of this repo and one
 * check does not justify adding it (recorded in the PR).
 *
 * Modes:
 *  - live:    every variable is required.
 *  - DRY_RUN=1: RESEND_API_KEY is not required (Resend is never constructed).
 *  - TF_MOCK=1: ANTHROPIC_API_KEY is not required (canned compose). Allowed
 *               only together with DRY_RUN=1, so a canned email can never go out.
 */
import { assertProjectOfRecord, SupabaseProjectError } from "../lib/supabase";

export const EMAIL_ENV_NAMES = [
  "RESEND_API_KEY",
  "PANEL_RECIPIENT_EMAIL",
  "PANEL_REPLY_TO",
  "PANEL_CRON_SECRET",
  "ANTHROPIC_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;
export type EmailEnvName = (typeof EMAIL_ENV_NAMES)[number];

export interface EmailEnv {
  dryRun: boolean;
  mockCompose: boolean;
  resendApiKey: string | null;
  recipient: string;
  replyTo: string;
  cronSecret: string;
  supabaseUrl: string;
}

export class EmailEnvError extends Error {
  constructor(
    readonly missing: string[],
    readonly invalid: string[],
  ) {
    const parts = [
      missing.length ? `missing: ${missing.join(", ")}` : "",
      invalid.length ? `invalid: ${invalid.join(", ")}` : "",
    ].filter(Boolean);
    super(`panel email env: ${parts.join("; ")}`);
  }
}

type Env = Record<string, string | undefined>;

export const isDryRun = (env: Env = process.env) => env.DRY_RUN === "1";
export const isMockCompose = (env: Env = process.env) => env.TF_MOCK === "1";

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
export const MIN_CRON_SECRET_LENGTH = 16;

/** Validates and returns the env. Throws EmailEnvError naming variables only. */
export function readEmailEnv(env: Env = process.env): EmailEnv {
  const dryRun = isDryRun(env);
  const mockCompose = isMockCompose(env);
  const need = (n: EmailEnvName) => {
    if (n === "RESEND_API_KEY" && dryRun) return false;
    if (n === "ANTHROPIC_API_KEY" && mockCompose) return false;
    return true;
  };
  const value = (n: string) => (env[n] ?? "").trim();
  const missing = EMAIL_ENV_NAMES.filter((n) => need(n) && !value(n));
  const invalid: string[] = [];

  if (mockCompose && !dryRun) invalid.push("TF_MOCK (canned compose needs DRY_RUN=1)");
  for (const n of ["PANEL_RECIPIENT_EMAIL", "PANEL_REPLY_TO"] as const) {
    if (value(n) && !EMAIL_RE.test(value(n))) invalid.push(`${n} (not an email address)`);
  }
  if (value("PANEL_CRON_SECRET") && value("PANEL_CRON_SECRET").length < MIN_CRON_SECRET_LENGTH) {
    invalid.push(`PANEL_CRON_SECRET (shorter than ${MIN_CRON_SECRET_LENGTH} characters)`);
  }
  if (value("NEXT_PUBLIC_SUPABASE_URL")) {
    try {
      assertProjectOfRecord(value("NEXT_PUBLIC_SUPABASE_URL"));
    } catch (err) {
      if (!(err instanceof SupabaseProjectError)) throw err;
      invalid.push(`NEXT_PUBLIC_SUPABASE_URL (${err.message})`);
    }
  }
  if (missing.length || invalid.length) throw new EmailEnvError(missing, invalid);

  return {
    dryRun,
    mockCompose,
    resendApiKey: dryRun ? null : value("RESEND_API_KEY"),
    recipient: value("PANEL_RECIPIENT_EMAIL"),
    replyTo: value("PANEL_REPLY_TO"),
    cronSecret: value("PANEL_CRON_SECRET"),
    supabaseUrl: value("NEXT_PUBLIC_SUPABASE_URL"),
  };
}
