/**
 * POST /api/email/inbound (TH-47): Resend's email.received webhook for
 * panel.faraday-thoughtforge.com. Verified by Svix signature against
 * RESEND_WEBHOOK_SECRET. Classifies the mail (Signal Digest, reply to a
 * panelist, Gmail forwarding confirmation, or ignored) and acts.
 * Logic in src/email/inbound.ts and src/email/reply.ts.
 */
import { handleInbound } from "@/src/email/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export function POST(req: Request): Promise<Response> {
  return handleInbound(req);
}
