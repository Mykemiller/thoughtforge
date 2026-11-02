/**
 * npm run email:dry-run -- [--date YYYY-MM-DD] [--signal] [--fast]
 *
 * Local rehearsal of the cron (and, with --signal, the Signal endpoint) with
 * DryRunSender and an in-memory store: it runs each job twice to show that the
 * second run inserts nothing. Never calls Resend and never touches Supabase.
 * Compose: TF_MOCK=1 for canned text, otherwise ANTHROPIC_API_KEY is required.
 * With --date, "now" is 13:00 UTC on that date (the cron's own time).
 */
import { anthropicModel, composerFor, mockModel } from "./compose";
import { isMockCompose } from "./env";
import { loadEmailPanelists } from "./panelists";
import { runDaily, runSignal, type RunDeps } from "./run";
import { SAMPLE_SIGNAL } from "./sample-signal";
import { DryRunSender } from "./send";
import { MemoryEmailStore } from "./store";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<number> {
  const mock = isMockCompose();
  if (!mock && !process.env.ANTHROPIC_API_KEY) {
    console.error("NOT RUN: ANTHROPIC_API_KEY is not set. Re-run with TF_MOCK=1 for a canned compose.");
    return 2;
  }
  const date = arg("date");
  const now = date ? new Date(`${date}T13:00:00Z`) : new Date();
  const store = new MemoryEmailStore();
  const deps: RunDeps = {
    panelists: loadEmailPanelists(),
    compose: composerFor(mock ? mockModel : anthropicModel),
    sender: new DryRunSender(),
    store,
    recipient: "$PANEL_RECIPIENT_EMAIL",
    replyTo: "$PANEL_REPLY_TO",
    sleep: flag("fast") ? async () => {} : undefined,
  };
  const summary = (label: string, outcomes: { kind: string; slug: string; status: string }[]) =>
    console.log(`[email:dry-run] ${label}: ${outcomes.map((o) => `${o.kind}/${o.slug}=${o.status}`).join(", ") || "nothing to do"}; rows now ${store.list().length}`);

  if (flag("signal")) {
    const first = await runSignal({ ...SAMPLE_SIGNAL, edition_date: date }, now, deps);
    summary(`signal run 1 (${first.edition_date})`, first.outcomes);
    const subjects = new Set(store.list().map((r) => r.subject));
    console.log(`[email:dry-run] distinct subjects: ${subjects.size} (${[...subjects].join(" | ")}); distinct From: ${new Set(deps.panelists.map((p) => p.address)).size}`);
    const second = await runSignal({ ...SAMPLE_SIGNAL, edition_date: date }, now, deps);
    summary("signal run 2", second.outcomes);
  } else {
    const first = await runDaily(now, deps);
    summary(`cron run 1 (${first.date}, weekday ${first.weekday}${first.skipped ? `, skipped: ${first.skipped}` : ""})`, first.outcomes);
    const second = await runDaily(now, deps);
    summary("cron run 2", second.outcomes);
  }
  for (const r of store.list()) console.log(`[email:dry-run] row: ${r.kind} ${r.send_date} ${r.panelist_slug} resend_id=${r.resend_id} thread_key=${r.thread_key ?? "null"}`);
  return 0;
}

main().then((code) => process.exit(code));
