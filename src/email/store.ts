/**
 * Send log and idempotency (TH-31): public.tf_email_messages,
 * unique (kind, send_date, panelist_slug) for every kind but 'reply' (TH-47: a panelist
 * may answer several times a day; replies are idempotent on the inbound email instead).
 *
 * Flow per email: has() (skip before paying for a compose) -> compose ->
 * reserve() (insert; a unique conflict means someone else got there) -> send ->
 * markSent() (resend_id, message_id). A failed send releases the reservation
 * so the next run can try again. A crash between send and markSent leaves the
 * row in place, so the email is never sent twice (at most once).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertProjectOfRecord, getServiceClient } from "../lib/supabase";
import type { DigestRow, EmailKey, EmailRow, InboundRow } from "./types";

export const EMAIL_TABLE = "tf_email_messages";

export interface EmailStore {
  has(key: EmailKey): Promise<boolean>;
  /** Inserts the row. Returns null when a row with this key already exists. */
  reserve(row: EmailRow): Promise<{ id: string } | null>;
  markSent(id: string, sent: { resend_id: string; message_id: string }): Promise<void>;
  release(id: string): Promise<void>;
}

/** Unique-violation code from Postgres, surfaced by PostgREST. */
const UNIQUE_VIOLATION = "23505";

/** Minimal slice of supabase-js the store uses, so tests can pass a mock. */
export type EmailDb = Pick<SupabaseClient, "from">;

export class SupabaseEmailStore implements EmailStore {
  constructor(private readonly db: EmailDb) {}

  async has(key: EmailKey): Promise<boolean> {
    const q = this.db.from(EMAIL_TABLE).select("id").eq("kind", key.kind).eq("send_date", key.send_date).eq("panelist_slug", key.panelist_slug);
    // TH-66: slot narrows the check when given. Without it the column is never named, so the
    // Signal and reply paths keep working on a database where the TH-66 migration is not applied yet.
    const { data, error } = await (key.slot ? q.eq("slot", key.slot) : q).limit(1);
    if (error) throw new Error(`${EMAIL_TABLE} read failed: ${error.message}`);
    return Array.isArray(data) && data.length > 0;
  }

  async reserve(row: EmailRow): Promise<{ id: string } | null> {
    const { data, error } = await this.db.from(EMAIL_TABLE).insert(row).select("id").single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return null;
      throw new Error(`${EMAIL_TABLE} insert failed: ${error.message}`);
    }
    return { id: (data as { id: string }).id };
  }

  async markSent(id: string, sent: { resend_id: string; message_id: string }): Promise<void> {
    const { error } = await this.db.from(EMAIL_TABLE).update(sent).eq("id", id);
    if (error) throw new Error(`${EMAIL_TABLE} update failed: ${error.message}`);
  }

  async release(id: string): Promise<void> {
    const { error } = await this.db.from(EMAIL_TABLE).delete().eq("id", id);
    if (error) throw new Error(`${EMAIL_TABLE} delete failed: ${error.message}`);
  }
}

/** The production send log. Asserts the project of record before any read or write (decoy guard). */
export function supabaseEmailStore(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): SupabaseEmailStore {
  assertProjectOfRecord(url);
  return new SupabaseEmailStore(getServiceClient());
}

/** In-memory store with the same unique key: tests and the local dry-run CLI. */
export class MemoryEmailStore implements EmailStore {
  readonly rows = new Map<string, EmailRow & { id: string; created_at: string }>();
  private seq = 0;
  /** Monotonic timestamps so thread order is stable in tests. */
  private clock = Date.parse("2026-11-05T13:00:00Z");
  static keyOf(k: EmailKey) {
    return `${k.kind}|${k.send_date}|${k.panelist_slug}|${k.slot ?? ""}`;
  }
  /** Same as the Supabase store: slot narrows the match only when given. */
  async has(key: EmailKey) {
    return [...this.rows.values()].some((r) => (key.slot ? MemoryEmailStore.keyOf(r) === MemoryEmailStore.keyOf(key) : r.kind === key.kind && r.send_date === key.send_date && r.panelist_slug === key.panelist_slug));
  }
  async reserve(row: EmailRow) {
    // The unique index is exact on (kind, send_date, panelist_slug, coalesce(slot, '')).
    if (row.kind !== "reply" && [...this.rows.values()].some((r) => MemoryEmailStore.keyOf(r) === MemoryEmailStore.keyOf(row))) return null;
    const id = `mem-${++this.seq}`;
    this.clock += 1000;
    this.rows.set(id, { ...row, id, created_at: new Date(this.clock).toISOString() });
    return { id };
  }
  async markSent(id: string, sent: { resend_id: string; message_id: string }) {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...sent });
  }
  async release(id: string) {
    this.rows.delete(id);
  }
  list() {
    return [...this.rows.values()];
  }
}

// ---------- TH-66: tf_email_day_plans ----------

export const DAY_PLAN_TABLE = "tf_email_day_plans";
/** planning: being composed or sent; scheduled: every slot is with Resend (a re-run does nothing); partial: some slot failed (a re-run retries it). */
export type DayPlanStatus = "planning" | "scheduled" | "partial";

export interface DayPlanRow {
  send_date: string;
  plan: unknown;
  status: DayPlanStatus;
}

export interface DayPlanStore {
  get(sendDate: string): Promise<DayPlanRow | null>;
  /** Insert or replace on send_date. */
  save(row: DayPlanRow): Promise<void>;
}

export class SupabaseDayPlanStore implements DayPlanStore {
  constructor(private readonly db: EmailDb) {}
  async get(sendDate: string): Promise<DayPlanRow | null> {
    const { data, error } = await this.db.from(DAY_PLAN_TABLE).select("send_date, plan, status").eq("send_date", sendDate).limit(1);
    if (error) throw new Error(`${DAY_PLAN_TABLE} read failed: ${error.message}`);
    return (data?.[0] as DayPlanRow | undefined) ?? null;
  }
  async save(row: DayPlanRow): Promise<void> {
    const { error } = await this.db.from(DAY_PLAN_TABLE).upsert(row, { onConflict: "send_date" });
    if (error) throw new Error(`${DAY_PLAN_TABLE} upsert failed: ${error.message}`);
  }
}

export class MemoryDayPlanStore implements DayPlanStore {
  readonly rows = new Map<string, DayPlanRow>();
  async get(sendDate: string) {
    const r = this.rows.get(sendDate);
    return r ? structuredClone(r) : null;
  }
  async save(row: DayPlanRow) {
    this.rows.set(row.send_date, structuredClone(row));
  }
}

// ---------- TH-47: thread lookups on tf_email_messages ----------

export interface StoredEmail extends EmailRow {
  id: string;
  created_at?: string;
}

export interface ThreadStore {
  /** The outbound row that carries this Message-ID, if any. */
  findByMessageId(messageId: string): Promise<StoredEmail | null>;
  /** Every outbound row in the thread, oldest first. */
  threadMessages(threadKey: string): Promise<StoredEmail[]>;
  setThreadKey(id: string, threadKey: string): Promise<void>;
  /** Outbound replies in this thread dated today (US Central date), for the loop guard. */
  countReplies(threadKey: string, sendDate: string): Promise<number>;
}

export class SupabaseThreadStore implements ThreadStore {
  constructor(private readonly db: EmailDb) {}
  async findByMessageId(messageId: string): Promise<StoredEmail | null> {
    const { data, error } = await this.db.from(EMAIL_TABLE).select("*").eq("message_id", messageId).limit(1);
    if (error) throw new Error(`${EMAIL_TABLE} read failed: ${error.message}`);
    return (data?.[0] as StoredEmail | undefined) ?? null;
  }
  async threadMessages(threadKey: string): Promise<StoredEmail[]> {
    const { data, error } = await this.db.from(EMAIL_TABLE).select("*").eq("thread_key", threadKey).order("created_at", { ascending: true });
    if (error) throw new Error(`${EMAIL_TABLE} read failed: ${error.message}`);
    return (data ?? []) as StoredEmail[];
  }
  async setThreadKey(id: string, threadKey: string): Promise<void> {
    const { error } = await this.db.from(EMAIL_TABLE).update({ thread_key: threadKey }).eq("id", id);
    if (error) throw new Error(`${EMAIL_TABLE} update failed: ${error.message}`);
  }
  async countReplies(threadKey: string, sendDate: string): Promise<number> {
    const { count, error } = await this.db
      .from(EMAIL_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("thread_key", threadKey)
      .eq("kind", "reply")
      .eq("send_date", sendDate);
    if (error) throw new Error(`${EMAIL_TABLE} count failed: ${error.message}`);
    return count ?? 0;
  }
}

// ---------- TH-47: tf_email_inbound ----------

export const INBOUND_TABLE = "tf_email_inbound";

export interface StoredInbound extends InboundRow {
  id: string;
  received_at?: string;
}

export interface InboundStore {
  /** True when this Resend email id was already handled (webhook re-delivery). */
  seen(resendEmailId: string): Promise<boolean>;
  insert(row: InboundRow): Promise<{ id: string }>;
  /** Inbound (reader) messages in a thread, oldest first. */
  threadMessages(threadKey: string): Promise<StoredInbound[]>;
}

export class SupabaseInboundStore implements InboundStore {
  constructor(private readonly db: EmailDb) {}
  async seen(resendEmailId: string): Promise<boolean> {
    const { data, error } = await this.db.from(INBOUND_TABLE).select("id").eq("resend_email_id", resendEmailId).limit(1);
    if (error) throw new Error(`${INBOUND_TABLE} read failed: ${error.message}`);
    return Array.isArray(data) && data.length > 0;
  }
  async insert(row: InboundRow): Promise<{ id: string }> {
    const { data, error } = await this.db.from(INBOUND_TABLE).insert(row).select("id").single();
    if (error) throw new Error(`${INBOUND_TABLE} insert failed: ${error.message}`);
    return { id: (data as { id: string }).id };
  }
  async threadMessages(threadKey: string): Promise<StoredInbound[]> {
    const { data, error } = await this.db.from(INBOUND_TABLE).select("*").eq("thread_key", threadKey).order("received_at", { ascending: true });
    if (error) throw new Error(`${INBOUND_TABLE} read failed: ${error.message}`);
    return (data ?? []) as StoredInbound[];
  }
}

// ---------- TH-47: tf_signal_digests ----------

export const DIGEST_TABLE = "tf_signal_digests";

export interface DigestStore {
  /** Insert or replace on digest_date. */
  upsert(row: DigestRow): Promise<void>;
  /** The newest digest, if any, for the briefing's context. */
  latest(): Promise<DigestRow | null>;
}

export class SupabaseDigestStore implements DigestStore {
  constructor(private readonly db: EmailDb) {}
  async upsert(row: DigestRow): Promise<void> {
    const { error } = await this.db.from(DIGEST_TABLE).upsert(row, { onConflict: "digest_date" });
    if (error) throw new Error(`${DIGEST_TABLE} upsert failed: ${error.message}`);
  }
  async latest(): Promise<DigestRow | null> {
    const { data, error } = await this.db.from(DIGEST_TABLE).select("*").order("digest_date", { ascending: false }).limit(1);
    if (error) throw new Error(`${DIGEST_TABLE} read failed: ${error.message}`);
    return (data?.[0] as DigestRow | undefined) ?? null;
  }
}

/** All four production stores over one service client. Asserts the project of record first (decoy guard). */
export function supabaseStores(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  assertProjectOfRecord(url);
  const db = getServiceClient();
  return {
    emails: new SupabaseEmailStore(db),
    threads: new SupabaseThreadStore(db),
    inbound: new SupabaseInboundStore(db),
    digests: new SupabaseDigestStore(db),
    dayPlans: new SupabaseDayPlanStore(db),
  };
}

// ---------- in-memory versions (tests, dry runs) ----------

export class MemoryThreadStore implements ThreadStore {
  constructor(private readonly emails: MemoryEmailStore) {}
  private all(): StoredEmail[] {
    return this.emails.list();
  }
  async findByMessageId(messageId: string) {
    return this.all().find((r) => r.message_id === messageId) ?? null;
  }
  async threadMessages(threadKey: string) {
    return this.all().filter((r) => r.thread_key === threadKey);
  }
  async setThreadKey(id: string, threadKey: string) {
    const r = this.emails.rows.get(id);
    if (r) this.emails.rows.set(id, { ...r, thread_key: threadKey });
  }
  async countReplies(threadKey: string, sendDate: string) {
    return this.all().filter((r) => r.thread_key === threadKey && r.kind === "reply" && r.send_date === sendDate).length;
  }
}

export class MemoryInboundStore implements InboundStore {
  readonly rows: StoredInbound[] = [];
  private seq = 0;
  async seen(resendEmailId: string) {
    return this.rows.some((r) => r.resend_email_id === resendEmailId);
  }
  async insert(row: InboundRow) {
    const id = `in-${++this.seq}`;
    this.rows.push({ ...row, id });
    return { id };
  }
  async threadMessages(threadKey: string) {
    return this.rows.filter((r) => r.thread_key === threadKey);
  }
}

export class MemoryDigestStore implements DigestStore {
  readonly rows = new Map<string, DigestRow>();
  async upsert(row: DigestRow) {
    this.rows.set(row.digest_date, row);
  }
  async latest() {
    const dates = [...this.rows.keys()].sort();
    return dates.length ? this.rows.get(dates[dates.length - 1])! : null;
  }
}
