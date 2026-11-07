/**
 * GET /api/health (TH-46): one request that proves the Supabase URL, service key
 * and project of record, and that the Anthropic key is set. Gated like /ask
 * (proxy.ts). Reports ok/error and present/missing only; never a key or URL.
 * A head-only count on tf_sessions: PostgREST has no `select 1`, and this still
 * exercises URL + key + RLS bypass. It deliberately skips the library-size guard
 * because its purpose is to report the connection state.
 */
import { NextResponse } from "next/server";
import { getServiceClient } from "@/src/lib/supabase";
import { describeError } from "@/src/lib/errors";
import { hasAnthropicKey } from "@/src/ask/orchestrate";
import { buildHealth } from "@/src/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let note: string | null = null;
  try {
    const { error } = await getServiceClient().from("tf_sessions").select("*", { count: "exact", head: true });
    if (error) note = describeError(error);
  } catch (err) {
    note = describeError(err);
  }
  const { status, body } = buildHealth(note, hasAnthropicKey());
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
