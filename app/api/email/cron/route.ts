/**
 * GET /api/email/cron (TH-31): weekday panel email. Vercel cron calls it per
 * vercel.json; guarded by Authorization: Bearer PANEL_CRON_SECRET.
 * Logic and guard live in src/email/http.ts.
 */
import { handleCron } from "@/src/email/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET(req: Request): Promise<Response> {
  return handleCron(req);
}
