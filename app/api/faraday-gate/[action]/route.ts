/**
 * POST /api/faraday-gate/{code,verify,request,signout} (FDY-414): the Faraday beta gate's own endpoints,
 * served by the vendored package (lib/faraday-gate/server/handlers.ts). Same-origin only.
 * Deliberately NOT behind the magic-word wall: the gate page on /podcast must reach it.
 */
import { handleGateAction } from "@/lib/faraday-gate/server/handlers";
import { TF_GATE_APP, gateConfigFromEnv } from "@/src/lib/faradayGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }): Promise<Response> {
  const { action } = await ctx.params;
  const cfg = gateConfigFromEnv();
  if (!cfg) {
    return Response.json({ error: "Sign-in is not configured on this deployment." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return handleGateAction(req, action, TF_GATE_APP, cfg);
}
