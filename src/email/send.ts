/**
 * Senders (TH-31). Plain text only: no HTML, no images, no tracking.
 *
 * ResendSender is the only code that talks to Resend, and it is constructed
 * only when DRY_RUN is not "1". DryRunSender writes the would-be email to
 * stdout with the recipient and Reply-To shown as variable names, never values.
 */
import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { SENDING_DOMAIN } from "./panelists";

export interface OutboundEmail {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  /** Our own Message-ID, set as a header and stored for Week 2 threading. */
  messageId: string;
  /** Sent as Resend's Idempotency-Key: kind/send_date/panelist_slug. */
  idempotencyKey: string;
}

export interface SendResult {
  resendId: string;
  /** The Message-ID the email carries. Resend's send API returns only its id, so this is the one we set. */
  messageId: string;
}

export interface Sender {
  send(email: OutboundEmail): Promise<SendResult>;
}

export const makeMessageId = () => `<${randomUUID()}@${SENDING_DOMAIN}>`;

export class ResendSender implements Sender {
  private readonly resend: Resend;
  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }
  async send(email: OutboundEmail): Promise<SendResult> {
    const { data, error } = await this.resend.emails.send(
      {
        from: email.from,
        to: email.to,
        replyTo: email.replyTo,
        subject: email.subject,
        text: email.text,
        headers: { "Message-ID": email.messageId },
      },
      { idempotencyKey: email.idempotencyKey },
    );
    if (error || !data) throw new Error(`resend: ${error?.name ?? "error"}: ${error?.message ?? "no data returned"}`);
    return { resendId: data.id, messageId: email.messageId };
  }
}

export const DRY_RUN_ID = "dry-run";

export function formatDryRun(email: OutboundEmail): string {
  return [
    "----- DRY_RUN: not sent -----",
    `From: ${email.from}`,
    "To: $PANEL_RECIPIENT_EMAIL",
    "Reply-To: $PANEL_REPLY_TO",
    `Subject: ${email.subject}`,
    `Message-ID: ${email.messageId}`,
    "",
    email.text,
    "----- end -----",
    "",
  ].join("\n");
}

export class DryRunSender implements Sender {
  readonly sent: OutboundEmail[] = [];
  constructor(private readonly write: (s: string) => void = (s) => void process.stdout.write(s)) {}
  async send(email: OutboundEmail): Promise<SendResult> {
    this.sent.push(email);
    this.write(formatDryRun(email));
    return { resendId: DRY_RUN_ID, messageId: email.messageId };
  }
}
