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
import { Resend } from "resend";
import { composerFor, anthropicModel, mockModel } from "./compose";
import { EmailEnvError, readEmailEnv, type EmailEnv } from "./env";
import { handleReceived, svixHeaders, verifyWebhook, WebhookError, type InboundDeps } from "./inbound";
import { loadEmailPanelists } from "./panelists";
import type { InboundMessage, ReplyDeps } from "./reply";
import { runPanelDay, type DayRunDeps } from "./day-run";
import { parseSignalBody, runSignal, SignalInputError, type Outcome, type RunDeps } from "./run";
import { DryRunSender, ResendSender } from "./send";
import { supabaseStores } from "./store";

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
  /** Inbound wiring (TH-47): the Resend fetch and the reply/digest stores. */
  buildInbound: (env: EmailEnv, run: RunDeps) => InboundDeps;
  /** TH-66: the panel day's stores and lane sources. */
  buildDay: (env: EmailEnv, run: RunDeps) => DayRunDeps;
  now: () => Date;
}

export function buildRunDeps(env: EmailEnv): RunDeps {
  const stores = supabaseStores(env.supabaseUrl);
  return {
    panelists: loadEmailPanelists(),
    compose: composerFor(env.mockCompose ? mockModel : anthropicModel),
    sender: env.dryRun ? new DryRunSender() : new ResendSender(env.resendApiKey!),
    store: stores.emails,
    digests: stores.digests,
    recipient: env.recipient,
    replyTo: env.replyTo,
    readerName: env.readerName,
    signalMode: env.signalMode,
    log: (line) => console.log(line),
  };
}

/** TH-66: the day planner's wiring. LINEAR_API_KEY goes only to the projects lane and is never logged. */
export function buildDayDeps(env: EmailEnv, run: RunDeps): DayRunDeps {
  const stores = supabaseStores(env.supabaseUrl);
  return { ...run, dayPlans: stores.dayPlans, lanes: { linearApiKey: env.linearApiKey ?? undefined, digests: stores.digests }, maxDaily: env.maxDaily };
}

/** GET /emails/receiving/{id} through the SDK: headers, text and html of a received email. */
export function resendFetcher(apiKey: string): (id: string) => Promise<InboundMessage> {
  const resend = new Resend(apiKey);
  return async (id) => {
    const { data, error } = await resend.emails.receiving.get(id);
    if (error || !data) throw new Error(`resend receiving.get: ${error?.name ?? "error"}: ${error?.message ?? "no data"}`);
    return {
      id: data.id,
      from: data.from,
      to: data.to ?? [],
      subject: data.subject ?? "",
      text: data.text,
      html: data.html,
      headers: data.headers,
      messageId: data.message_id,
      receivedAt: data.created_at,
    };
  };
}

export function buildInboundDeps(env: EmailEnv, run: RunDeps): InboundDeps {
  const stores = supabaseStores(env.supabaseUrl);
  const reply: ReplyDeps = {
    panelists: run.panelists,
    compose: run.compose,
    sender: run.sender,
    store: run.store,
    threads: stores.threads,
    inbound: stores.inbound,
    readerName: env.readerName,
    maxRepliesPerThreadPerDay: env.maxRepliesPerThreadPerDay,
    log: run.log,
  };
  const fetchEmail = env.resendApiKey
    ? resendFetcher(env.resendApiKey)
    : async () => {
        throw new Error("inbound needs RESEND_API_KEY to fetch the received email (DRY_RUN cannot read mail)");
      };
  return { fetchEmail, run, reply, digests: stores.digests, replyAllowlist: env.replyAllowlist, signalMode: env.signalMode, now: () => new Date(), log: run.log };
}

export const defaultHttpDeps: HttpDeps = {
  cronSecret: () => process.env.PANEL_CRON_SECRET?.trim() || undefined,
  env: () => readEmailEnv(),
  build: buildRunDeps,
  buildInbound: buildInboundDeps,
  buildDay: buildDayDeps,
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

/** TH-66: the weekday 07:00 and Saturday 09:00 cron run the panel day (runPanelDay). */
export async function handleCron(req: Request, deps: HttpDeps = defaultHttpDeps): Promise<Response> {
  const g = guard(req, deps);
  if (g instanceof Response) return g;
  const result = await runPanelDay(deps.now(), deps.buildDay(g.env, g.run));
  // Bodies stay out of the response; subjects and statuses are enough for the cron log.
  const slots = result.slots.map((s) => ({ ...s, body: undefined }));
  return json({ dry_run: g.env.dryRun, ...result, slots }, result.slots.some((s) => s.status === "failed") ? 502 : 200);
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

/**
 * POST /api/email/inbound: the Resend email.received webhook. Auth is the Svix signature,
 * not the cron bearer. 503 when the secret is unset, 401 on a bad signature, 200 for every
 * handled or ignored message, 500 only on a real failure (Resend retries those).
 */
export async function handleInbound(req: Request, deps: HttpDeps = defaultHttpDeps): Promise<Response> {
  let env: EmailEnv;
  try {
    env = deps.env();
  } catch (e) {
    if (e instanceof EmailEnvError) return json({ error: e.message }, 500);
    throw e;
  }
  if (!env.webhookSecret) return json({ error: "panel inbound is not configured: RESEND_WEBHOOK_SECRET is not set" }, 503);
  const raw = await req.text();
  let event;
  try {
    event = verifyWebhook(raw, svixHeaders(req.headers), env.webhookSecret, deps.now());
  } catch (e) {
    if (e instanceof WebhookError) return json({ error: e.message }, 401);
    throw e;
  }
  const run = deps.build(env);
  try {
    const result = await handleReceived(event, deps.buildInbound(env, run));
    return json({ dry_run: env.dryRun, ...result });
  } catch (e) {
    console.error(`[email:inbound] failed: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: "inbound handling failed; see logs" }, 500);
  }
}
