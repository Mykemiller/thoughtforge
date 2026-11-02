/**
 * POST /api/email/signal (TH-31): one takeaway per panelist on a Faraday
 * Signal edition, all in one thread. Body: { subject, text, edition_date? }.
 * Guarded by Authorization: Bearer PANEL_CRON_SECRET. Logic in src/email/http.ts.
 */
import { handleSignal } from "@/src/email/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export function POST(req: Request): Promise<Response> {
  return handleSignal(req);
}
