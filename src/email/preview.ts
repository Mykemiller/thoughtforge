/**
 * npm run email:preview -- --kind briefing --slug delia-marchetti [--date YYYY-MM-DD] [--file digest.txt]
 * npm run email:preview -- --kind signal-takeaway --all [--file path.txt --signal-subject "..." --edition YYYY-MM-DD]
 * npm run email:preview -- --kind signal-takeaway --mode roundtable --file fixtures/digests/sample.txt
 * npm run email:preview -- --kind reply --slug margo-brandt --file fixtures/replies/sample.txt
 *
 * --file is the Signal text for briefing (as the latest digest in front of the chair), for
 * signal-takeaway and roundtable, or the reader's message for a reply. (--signal-file still works.)
 * Prints composed emails to the terminal. Never sends, never writes a row.
 * Composes live when ANTHROPIC_API_KEY is set; TF_MOCK=1 gives a canned compose;
 * with neither it prints the envelope and says plainly that nothing was composed (exit 2).
 */
import { readFileSync } from "node:fs";
import { composeEmail, anthropicModel, mockModel, subjectFor } from "./compose";
import { isMockCompose } from "./env";
import { loadEmailPanelists } from "./panelists";
import { centralDate, chairFor } from "./rotation";
import { assembleRoundtable } from "./run";
import { SAMPLE_SIGNAL } from "./sample-signal";
import { formatDryRun, makeMessageId } from "./send";
import { EMAIL_KINDS, SIGNAL_MODES, type EmailKind, type SignalInput, type SignalMode, type ThreadMessage } from "./types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<number> {
  const kind = (arg("kind") ?? "briefing") as EmailKind;
  if (!EMAIL_KINDS.includes(kind)) {
    console.error(`--kind must be one of ${EMAIL_KINDS.join(", ")}`);
    return 1;
  }
  const panelists = loadEmailPanelists();
  const slug = arg("slug");
  // Roundtable is always all ten unless one slug is named.
  const chosen = flag("all") || (arg("mode") === "roundtable" && !slug) ? panelists : panelists.filter((p) => p.slug === slug);
  if (!chosen.length) {
    console.error(`--slug must be one of ${panelists.map((p) => p.slug).join(", ")} (or pass --all)`);
    return 1;
  }
  const date = arg("date") ?? centralDate(new Date());
  const file = arg("file") ?? arg("signal-file");
  const mode = (arg("mode") ?? "thread") as SignalMode;
  if (!SIGNAL_MODES.includes(mode)) {
    console.error(`--mode must be one of ${SIGNAL_MODES.join(", ")}`);
    return 1;
  }
  const fileSignal = (): SignalInput => ({ subject: arg("signal-subject") ?? "Faraday Signal", text: readFileSync(file!, "utf8"), editionDate: arg("edition") ?? date });
  const signal: SignalInput | undefined =
    kind === "signal-takeaway" || kind === "roundtable-opener" ? (file ? fileSignal() : { ...SAMPLE_SIGNAL, editionDate: date }) : kind === "briefing" && file ? fileSignal() : undefined;
  const thread: ThreadMessage[] | undefined =
    kind !== "reply"
      ? undefined
      : [
          { author: chosen[0].name, side: "panelist", date, text: "(the panelist's earlier note; a preview has no thread on file)" },
          { author: "Myke", side: "reader", date, text: file ? readFileSync(file, "utf8") : "A preview question: what would you check first, and why that before anything else?" },
        ];
  const replySubject = kind === "reply" ? (arg("signal-subject") ?? `Morning note from ${chosen[0].firstName}: preview`) : undefined;
  const context = { date, signal, thread, replySubject };

  const mock = isMockCompose();
  const live = Boolean(process.env.ANTHROPIC_API_KEY) && !mock;
  if (!mock && !live) {
    for (const p of chosen) {
      console.log(`From: ${p.from}\nReply-To: ${p.replyTo}\nSubject (format): ${subjectFor(kind, p, context, "<5 to 8 word hook>")}`);
    }
    console.log(
      "\nNOT COMPOSED: ANTHROPIC_API_KEY is not set, so no model was called. Re-run with TF_MOCK=1 for a canned compose, or with the key set for a real one.",
    );
    return 2;
  }
  const model = mock ? mockModel : anthropicModel;
  const print = (from: string, replyTo: string, subject: string, text: string) =>
    process.stdout.write(formatDryRun({ from, to: "", replyTo, subject, text, messageId: makeMessageId(), idempotencyKey: "" }).replace("DRY_RUN: not sent", "PREVIEW: not sent, not stored"));

  if (kind === "signal-takeaway" && mode === "roundtable") {
    // One email from the chair with every chosen takeaway under its name (TF-DEC-82).
    const chair = panelists.find((p) => p.slug === chairFor(date, panelists.map((x) => x.slug)))!;
    console.log(`[email:preview] roundtable for ${date}, chair ${chair.slug}, ${chosen.length} takeaway(s), compose: ${mock ? "TF_MOCK canned (no model call)" : "live model"}\n`);
    try {
      const sections = [];
      for (const p of chosen) sections.push({ panelist: p, body: (await composeEmail({ panelist: p, kind: "signal-takeaway", context }, model)).body });
      const opener = await composeEmail({ panelist: chair, kind: "roundtable-opener", context }, model);
      print(chair.from, "$PANEL_REPLY_TO", opener.subject, assembleRoundtable(opener.body, sections, chair));
      return 0;
    } catch (e) {
      console.error(`[email:preview] roundtable: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }

  console.log(`[email:preview] ${kind} for ${chosen.length} panelist(s), ${date}, compose: ${mock ? "TF_MOCK canned (no model call)" : "live model"}\n`);
  let failed = 0;
  for (const p of chosen) {
    try {
      const email = await composeEmail({ panelist: p, kind, context }, model);
      print(p.from, p.replyTo, email.subject, email.body);
    } catch (e) {
      failed++;
      console.error(`[email:preview] ${p.slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code));
