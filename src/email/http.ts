/**
 * HTTP handlers behind app/api/email/cron and app/api/email/signal (TH-31).
 * Route files stay thin; these take injectable dependencies so the guard and
 * the flow are tested without Next, Resend or Supabase.
 *
 * Guard: Authorization: Bearer <PANEL_CRON_SECRET>, compared in constant time.
 * Vercel cron only attaches a bearer when the project has CRON_SECRET, so
 * CRON_SECRET must be set to the same value as PANEL_CRON_SECRET (README).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { composerFor, anthropicModel, mockModel } from "./compose";
import { EmailEnvError, readEmailEnv, type EmailEnv } from "./env";
import { loadEmailPanelists } from "./panelists";
import { parseSignalBody, runDaily, runSignal, SignalInputError, type Outcome, type RunDeps } from "./run";
import { DryRunSender, ResendSender } from "./send";
import { supabaseEmailStore } from "./store";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** True when the header is exactly "Bearer <secret>". Constant time over the digests. */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const m = header.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  return timingSafeEqual(sha(m[1].trim()), sha(secret));
}

export interface HttpDeps {
  /** Raw secret lookup for the guard (checked before the rest of the env). */
  cronSecret: () => string | undefined;
  env: () => EmailEnv;
  build: (env: EmailEnv) => RunDeps;
  now: () => Date;
}

export function buildRunDeps(env: EmailEnv): RunDeps {
  return {
    panelists: loadEmailPanelists(),
    compose: composerFor(env.mockCompose ? mockModel : anthropicModel),
    sender: env.dryRun ? new DryRunSender() : new ResendSender(env.resendApiKey!),
    store: supabaseEmailStore(env.supabaseUrl),
    recipient: env.recipient,
    replyTo: env.replyTo,
    log: (line) => console.log(line),
  };
}

export const defaultHttpDeps: HttpDeps = {
  cronSecret: () => process.env.PANEL_CRON_SECRET?.trim() || undefined,
  env: () => readEmailEnv(),
  build: buildRunDeps,
  now: () => new Date(),
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Auth, then env. Returns a Response to send back, or the deps to run with. */
function guard(req: Request, deps: HttpDeps): Response | { env: EmailEnv; run: RunDeps } {
  const secret = deps.cronSecret();
  if (!secret) return json({ error: "panel email is not configured: PANEL_CRON_SECRET is not set" }, 503);
  if (!bearerMatches(req.headers.get("authorization"), secret)) return json({ error: "unauthorized" }, 401);
  let env: EmailEnv;
  try {
    env = deps.env();
  } catch (e) {
    if (e instanceof EmailEnvError) return json({ error: e.message }, 500);
    throw e;
  }
  return { env, run: deps.build(env) };
}

const statusFor = (outcomes: Outcome[]) => (outcomes.some((o) => o.status === "failed") ? 502 : 200);

export async function handleCron(req: Request, deps: HttpDeps = defaultHttpDeps): Promise<Response> {
  const g = guard(req, deps);
  if (g instanceof Response) return g;
  const result = await runDaily(deps.now(), g.run);
  return json({ dry_run: g.env.dryRun, ...result }, statusFor(result.outcomes));
}

export async function handleSignal(req: Request, deps: HttpDeps = defaultHttpDeps): Promise<Response> {
  const g = guard(req, deps);
  if (g instanceof Response) return g;
  let input: ReturnType<typeof parseSignalBody>;
  try {
    input = parseSignalBody(await req.json());
  } catch (e) {
    if (e instanceof SignalInputError) return json({ error: e.message }, 400);
    return json({ error: "body must be JSON: { subject, text, edition_date? }" }, 400);
  }
  const result = await runSignal(input, deps.now(), g.run);
  return json({ dry_run: g.env.dryRun, ...result }, statusFor(result.outcomes));
}
