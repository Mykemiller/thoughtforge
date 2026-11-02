// Decoy guard for scripts (TH-32 §0). Mirrors src/lib/supabase.ts for the NodeNext side.
export const PROJECT_REF = "ycadmmngkdhvpcsrcuaq";
export const DECOY_PROJECT_REF = "xgbpmlkanxewtfizloay";

export function assertProjectOfRecord(url: string | undefined): string {
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (url.includes(DECOY_PROJECT_REF)) throw new Error(`refusing the decoy Supabase project ${DECOY_PROJECT_REF}`);
  if (!url.includes(PROJECT_REF)) throw new Error(`NEXT_PUBLIC_SUPABASE_URL does not name the project of record ${PROJECT_REF}`);
  return url;
}

export function requireServiceEnv(): { url: string; key: string } {
  const url = assertProjectOfRecord(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (run `vercel env pull .env.local` or export it)");
  return { url, key };
}
