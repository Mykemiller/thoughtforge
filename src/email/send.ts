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
  /** Our own Message-ID, set as a header and stored for threading. */
  messageId: string;
  /** Threading headers for replies (TH-47): the Message-ID being answered and the chain so far. */
  inReplyTo?: string;
  references?: string[];
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

/** Message-ID always; In-Reply-To and References only on replies, so mail clients thread them. */
export function threadingHeaders(email: Pick<OutboundEmail, "messageId" | "inReplyTo" | "references">): Record<string, string> {
  const h: Record<string, string> = { "Message-ID": email.messageId };
  if (email.inReplyTo) h["In-Reply-To"] = email.inReplyTo;
  if (email.references?.length) h["References"] = email.references.join(" ");
  return h;
}

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
        headers: threadingHeaders(email),
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
    `Reply-To: ${email.replyTo.endsWith("@faraday-thoughtforge.com") ? email.replyTo : "$PANEL_REPLY_TO"}`,
    `Subject: ${email.subject}`,
    `Message-ID: ${email.messageId}`,
    ...(email.inReplyTo ? [`In-Reply-To: ${email.inReplyTo}`] : []),
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
