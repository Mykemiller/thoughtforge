/**
 * GET /api/email/cron (TH-31, TH-66): the panel day. Vercel cron calls it at 07:00 Central
 * on weekdays and 09:00 on Saturday per vercel.json; guarded by Authorization: Bearer PANEL_CRON_SECRET.
 * maxDuration 300: the whole day (up to five emails, or ten takeaways for a roundtable) is composed in this call.
 * Logic and guard live in src/email/http.ts.
 */
import { handleCron } from "@/src/email/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export function GET(req: Request): Promise<Response> {
  return handleCron(req);
}
