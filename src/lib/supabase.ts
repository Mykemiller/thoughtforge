/**
 * Supabase access for ThoughtForge (TH-32 §0, §4.2, §5).
 *
 * The project of record is ycadmmngkdhvpcsrcuaq. The decoy project
 * xgbpmlkanxewtfizloay returns zero rows silently, so every code path that
 * reads or writes Supabase goes through assertProjectOfRecord() first.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const PROJECT_REF = "ycadmmngkdhvpcsrcuaq";
export const DECOY_PROJECT_REF = "xgbpmlkanxewtfizloay";

export class SupabaseProjectError extends Error {}

/** Throws unless the URL names the project of record. Call before any client is built. */
export function assertProjectOfRecord(url: string | undefined): string {
  if (!url) throw new SupabaseProjectError("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (url.includes(DECOY_PROJECT_REF)) throw new SupabaseProjectError(`refusing the decoy Supabase project ${DECOY_PROJECT_REF}`);
  if (!url.includes(PROJECT_REF)) throw new SupabaseProjectError(`NEXT_PUBLIC_SUPABASE_URL does not name the project of record ${PROJECT_REF}`);
  return url;
}

/** True when both the URL and the service-role key are present (does not validate them). */
export function hasServiceEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let serviceClient: SupabaseClient | null = null;

/** Server-side only. Service role: reads the Faraday library, writes tf_* tables. */
export function getServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient;
  const url = assertProjectOfRecord(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new SupabaseProjectError("SUPABASE_SERVICE_ROLE_KEY is not set");
  serviceClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return serviceClient;
}
