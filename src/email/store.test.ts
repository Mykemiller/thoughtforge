import { test } from "node:test";
import assert from "node:assert/strict";
import { EMAIL_TABLE, SupabaseEmailStore, supabaseEmailStore, type EmailDb } from "./store";
import type { EmailRow } from "./types";

/** A chainable fake of the supabase-js query builder that records every call. */
function fakeDb(results: { select?: unknown; insert?: unknown; update?: unknown; delete?: unknown }) {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  const db = {
    from(table: string) {
      let op = "";
      const builder: Record<string, unknown> = {};
      const rec = (name: string) => (...args: unknown[]) => {
        calls.push({ table, op: name, args });
        if (["select", "insert", "update", "delete"].includes(name) && !op) op = name;
        return builder;
      };
      for (const m of ["select", "insert", "update", "delete", "eq", "limit", "single"]) builder[m] = rec(m);
      builder.then = (resolve: (v: unknown) => void) => resolve((results as Record<string, unknown>)[op]);
      return builder;
    },
  };
  return { db: db as unknown as EmailDb, calls };
}

const row: EmailRow = {
  kind: "briefing",
  send_date: "2026-11-03",
  panelist_slug: "gilbert-faraday",
  subject: "s",
  body: "b",
  resend_id: null,
  message_id: "<m@x>",
  in_reply_to: null,
  thread_key: null,
};

test("has() filters on kind, send_date and panelist_slug of tf_email_messages", async () => {
  const { db, calls } = fakeDb({ select: { data: [{ id: "1" }], error: null } });
  assert.equal(await new SupabaseEmailStore(db).has(row), true);
  assert.ok(calls.every((c) => c.table === EMAIL_TABLE));
  const eqs = calls.filter((c) => c.op === "eq").map((c) => c.args);
  assert.deepEqual(eqs, [["kind", "briefing"], ["send_date", "2026-11-03"], ["panelist_slug", "gilbert-faraday"]]);
  const none = fakeDb({ select: { data: [], error: null } });
  assert.equal(await new SupabaseEmailStore(none.db).has(row), false);
});

test("reserve(): a unique violation means already sent (null); other errors throw", async () => {
  const ok = fakeDb({ insert: { data: { id: "abc" }, error: null } });
  assert.deepEqual(await new SupabaseEmailStore(ok.db).reserve(row), { id: "abc" });
  assert.deepEqual(ok.calls.find((c) => c.op === "insert")!.args[0], row);
  const dup = fakeDb({ insert: { data: null, error: { code: "23505", message: "duplicate key" } } });
  assert.equal(await new SupabaseEmailStore(dup.db).reserve(row), null);
  const bad = fakeDb({ insert: { data: null, error: { code: "42P01", message: "relation does not exist" } } });
  await assert.rejects(new SupabaseEmailStore(bad.db).reserve(row), /insert failed: relation does not exist/);
});

test("markSent() updates resend_id and message_id by id; release() deletes by id", async () => {
  const u = fakeDb({ update: { error: null } });
  await new SupabaseEmailStore(u.db).markSent("abc", { resend_id: "re_1", message_id: "<m@x>" });
  assert.deepEqual(u.calls.find((c) => c.op === "update")!.args[0], { resend_id: "re_1", message_id: "<m@x>" });
  assert.deepEqual(u.calls.find((c) => c.op === "eq")!.args, ["id", "abc"]);
  const d = fakeDb({ delete: { error: null } });
  await new SupabaseEmailStore(d.db).release("abc");
  assert.ok(d.calls.some((c) => c.op === "delete"));
});

test("decoy guard: the production store refuses anything but the project of record", () => {
  assert.throws(() => supabaseEmailStore("https://xgbpmlkanxewtfizloay.supabase.co"), /decoy/);
  assert.throws(() => supabaseEmailStore("https://example.supabase.co"), /project of record/);
  assert.throws(() => supabaseEmailStore(undefined), /not set/);
});
