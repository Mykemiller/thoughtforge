/**
 * POST /api/panel (FDY-345): the Live Agent bridge. See src/panel/handler.ts.
 * Not behind the TF_ACCESS_KEY gate: authenticated by `Authorization: Bearer <LA_PANEL_TOKEN>`; 503 until that is set.
 */
import { handlePanel } from "@/src/panel/handler";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handlePanel(req);
}
