/**
 * Send log and idempotency (TH-31): public.tf_email_messages,
 * unique (kind, send_date, panelist_slug).
 *
 * Flow per email: has() (skip before paying for a compose) -> compose ->
 * reserve() (insert; a unique conflict means someone else got there) -> send ->
 * markSent() (resend_id, message_id). A failed send releases the reservation
 * so the next run can try again. A crash between send and markSent leaves the
 * row in place, so the email is never sent twice (at most once).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertProjectOfRecord, getServiceClient } from "../lib/supabase";
import type { EmailKey, EmailRow } from "./types";

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
    const { data, error } = await this.db
      .from(EMAIL_TABLE)
      .select("id")
      .eq("kind", key.kind)
      .eq("send_date", key.send_date)
      .eq("panelist_slug", key.panelist_slug)
      .limit(1);
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

/** The production store. Asserts the project of record before any read or write (decoy guard). */
export function supabaseEmailStore(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): SupabaseEmailStore {
  assertProjectOfRecord(url);
  return new SupabaseEmailStore(getServiceClient());
}

/** In-memory store with the same unique key: tests and the local dry-run CLI. */
export class MemoryEmailStore implements EmailStore {
  readonly rows = new Map<string, EmailRow & { id: string }>();
  private seq = 0;
  static keyOf(k: EmailKey) {
    return `${k.kind}|${k.send_date}|${k.panelist_slug}`;
  }
  async has(key: EmailKey) {
    return [...this.rows.values()].some((r) => MemoryEmailStore.keyOf(r) === MemoryEmailStore.keyOf(key));
  }
  async reserve(row: EmailRow) {
    if (await this.has(row)) return null;
    const id = `mem-${++this.seq}`;
    this.rows.set(id, { ...row, id });
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
