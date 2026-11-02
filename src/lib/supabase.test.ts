import { test } from "node:test";
import assert from "node:assert/strict";
import { assertProjectOfRecord, SupabaseProjectError } from "./supabase";

test("decoy guard: throws on the decoy, on a foreign URL, and on no URL", () => {
  assert.throws(() => assertProjectOfRecord("https://xgbpmlkanxewtfizloay.supabase.co"), SupabaseProjectError);
  assert.throws(() => assertProjectOfRecord("https://xgbpmlkanxewtfizloay.supabase.co"), /decoy/);
  assert.throws(() => assertProjectOfRecord("https://example.supabase.co"), /project of record/);
  assert.throws(() => assertProjectOfRecord(undefined), /not set/);
  assert.equal(assertProjectOfRecord("https://ycadmmngkdhvpcsrcuaq.supabase.co"), "https://ycadmmngkdhvpcsrcuaq.supabase.co");
});
