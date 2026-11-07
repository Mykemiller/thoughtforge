/**
 * Panel email types.
 * TH-31 (Week 1): outbound briefing, cold open, Signal takeaways.
 * TH-47: inbound (Signal Digest feed and replies), roundtable mode, per-panelist Reply-To,
 * and the context opener on every persona email.
 */
import type { SlotContext } from "./context/types";

export const EMAIL_KINDS = [
  "briefing",
  "cold-open",
  "signal-takeaway",
  "roundtable-opener",
  "reply",
  // TH-66: the panel day.
  "thread-reply",
  "aside",
  "news-take",
  "weekend-note",
] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Kinds a panelist writes as a note to the reader (the opener rule applies to all of them). */
export const PERSONA_KINDS: readonly EmailKind[] = ["briefing", "cold-open", "signal-takeaway", "reply", "thread-reply", "aside", "news-take", "weekend-note"];

/**
 * The slots of a panel day (TH-66). A slot is a time of day and a job; the kind it sends is
 * decided when the day is planned (signal-or-news becomes a Signal roundtable or a news-take).
 */
export const DAY_SLOTS = ["morning-note", "cold-open", "thread-reply", "aside", "signal-or-news", "weekend-note"] as const;
export type DaySlot = (typeof DAY_SLOTS)[number];

/** How the ten Signal takeaways go out (TF-DEC-82). */
export const SIGNAL_MODES = ["thread", "roundtable"] as const;
export type SignalMode = (typeof SIGNAL_MODES)[number];

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
  /** firstname@faraday-thoughtforge.com: this panelist's own Fastmail inbox, the Reply-To on their persona emails (TF-DEC-83). */
  replyTo: string;
  /** IDF domains joined for the prompt, e.g. "D2 Power Architecture, D10 Construction". */
  domains: string;
  voiceBrief: string;
  sampleLine?: string;
  backstory: string;
  lifeOutsideWork: string;
  /** The dossier's "Family" section (fictional people), for the personal lane (TH-66). */
  family?: string;
}

export interface SignalInput {
  subject: string;
  text: string;
  /** YYYY-MM-DD of the edition, when known. Named in the opener. */
  editionDate?: string;
}

/** One message in an email thread, as the panelist sees the conversation so far. */
export interface ThreadMessage {
  /** "Myke" for the reader, otherwise the panelist's display name. */
  author: string;
  /** "reader" for the person the panel writes to; "panelist" for one of the ten. */
  side: "reader" | "panelist";
  date: string;
  text: string;
}

export interface ComposeContext {
  /** Send date in US Central, YYYY-MM-DD. */
  date: string;
  /** The reader's first name, used once in the opener. */
  readerName?: string;
  /** Required for kind "signal-takeaway" and "roundtable-opener". Optional context for "briefing" (the latest digest). */
  signal?: SignalInput;
  /** Required for kind "reply": the thread so far, oldest first, ending with the reader's message. */
  thread?: ThreadMessage[];
  /** For kind "reply" and "thread-reply": the subject being answered (the reply subject is derived from it). */
  replySubject?: string;
  /** TH-66: the slice of the day's context lanes this email may draw on. */
  day?: SlotContext;
}

export interface ComposeInput {
  panelist: EmailPanelist;
  kind: EmailKind;
  context: ComposeContext;
}

export interface ComposedEmail {
  subject: string;
  /** Plain text, signature included (except roundtable-opener, which is a fragment). */
  body: string;
}

export type Composer = (input: ComposeInput) => Promise<ComposedEmail>;

/** One row of public.tf_email_messages (supabase/migrations/20261102_tf_email_messages.sql, extended by TH-47). */
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
  /** TH-66: the day slot this row was sent for; null for Signal takeaways, roundtables and replies. */
  slot?: DaySlot | null;
}

export interface EmailKey {
  kind: EmailKind;
  send_date: string;
  panelist_slug: string;
  /** TH-66: part of the unique key; absent means null. */
  slot?: DaySlot | null;
}

/** One row of public.tf_email_inbound (TH-47). */
export type InboundStatus = "accepted" | "ignored" | "gmail-confirmation" | "error";

export interface InboundRow {
  resend_email_id: string;
  from_address: string;
  subject: string;
  status: InboundStatus;
  note: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  thread_key: string | null;
  raw_text: string | null;
}

/** One row of public.tf_signal_digests (TH-47; the shape TH-36 specifies). */
export interface DigestRow {
  digest_date: string;
  subject: string;
  signal_count: number | null;
  source_message_id: string | null;
  raw_html: string | null;
  raw_text: string | null;
}
