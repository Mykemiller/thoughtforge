/**
 * Panel email types (TH-31, Week 1: outbound only).
 * Week 2 adds threading (in_reply_to, thread_key are stored from day one);
 * Week 3 adds inbound. Nothing here reads mail.
 */

export const EMAIL_KINDS = ["briefing", "cold-open", "signal-takeaway"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** One panelist as the mailer sees them, built from the cast loader (src/cast/loader.ts). */
export interface EmailPanelist {
  slug: string;
  /** persona.display_name, e.g. "Dr. Ingrid Halverson". Used as the From display name and in the signature. */
  name: string;
  /** persona.short_name, e.g. "Hart". Used in subjects ("Morning note from Hart: ..."). */
  firstName: string;
  role: string;
  /** first.last@panel.faraday-thoughtforge.com */
  address: string;
  /** RFC 5322 From header: "\"<name>\" <address>". */
  from: string;
  /** IDF domains joined for the prompt, e.g. "D2 Power Architecture, D10 Construction". */
  domains: string;
  voiceBrief: string;
  sampleLine?: string;
  backstory: string;
  lifeOutsideWork: string;
}

export interface SignalInput {
  subject: string;
  text: string;
}

export interface ComposeContext {
  /** Send date in US Central, YYYY-MM-DD. */
  date: string;
  /** Required for kind "signal-takeaway". */
  signal?: SignalInput;
}

export interface ComposeInput {
  panelist: EmailPanelist;
  kind: EmailKind;
  context: ComposeContext;
}

export interface ComposedEmail {
  subject: string;
  /** Plain text, signature included. */
  body: string;
}

export type Composer = (input: ComposeInput) => Promise<ComposedEmail>;

/** One row of public.tf_email_messages (supabase/migrations/20261102_tf_email_messages.sql). */
export interface EmailRow {
  kind: EmailKind;
  send_date: string;
  panelist_slug: string;
  subject: string;
  body: string;
  resend_id: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  thread_key: string | null;
}

export interface EmailKey {
  kind: EmailKind;
  send_date: string;
  panelist_slug: string;
}
