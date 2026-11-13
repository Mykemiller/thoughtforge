/**
 * POST /api/panel request body (FDY-345). Pure: zod only, no I/O.
 *
 * `context[].n` is the item's 1-based position and is what the join prompt numbers
 * artifacts by, so it must run 1..k with no gaps, in order.
 */
import { z } from "zod";
import { INVITABLE, LIMITS } from "../ask/roster";

export const MAX_TURNS = 12;
export const MAX_TURN_CHARS = 2000;
export const MAX_CONTEXT = 12;
export const MAX_EXCERPT_CHARS = 800;
export const MAX_JOIN_PANELISTS = 4;

const turn = z.object({ speaker: z.string().min(1).max(80), text: z.string().max(MAX_TURN_CHARS) });

const contextItem = z.object({
  n: z.number().int(),
  title: z.string().min(1).max(300),
  publisher: z.string().max(200),
  url: z.string().max(2000).nullable(),
  date: z.string().max(40).nullable(),
  label: z.enum(["verified", "sourced", "estimate", "read"]),
  excerpt: z.string().max(MAX_EXCERPT_CHARS),
});

export const panelBodySchema = z
  .object({
    mode: z.enum(["join", "convene"]),
    question: z.string().trim().min(1).max(LIMITS.questionMaxChars),
    conversation: z.array(turn).max(MAX_TURNS),
    context: z.array(contextItem).max(MAX_CONTEXT),
    panelists: z.array(z.string()).optional(),
    settings: z.object({ horizon: z.number().int().min(0).max(4), lens: z.string().max(200) }).optional(),
    source: z.literal("live_agent"),
    conversation_id: z.uuid(),
  })
  .superRefine((b, ctx) => {
    b.context.forEach((c, i) => {
      if (c.n !== i + 1) ctx.addIssue({ code: "custom", path: ["context", i, "n"], message: `n must be ${i + 1} (numbering runs 1..k with no gaps, in order)` });
    });
    if (b.mode !== "join") return;
    const p = b.panelists;
    if (!p || p.length < 1 || p.length > MAX_JOIN_PANELISTS) {
      ctx.addIssue({ code: "custom", path: ["panelists"], message: `join needs 1 to ${MAX_JOIN_PANELISTS} panelists` });
      return;
    }
    p.forEach((slug, i) => {
      if (!INVITABLE.includes(slug)) ctx.addIssue({ code: "custom", path: ["panelists", i], message: "not an invitable panelist" });
      else if (p.indexOf(slug) !== i) ctx.addIssue({ code: "custom", path: ["panelists", i], message: "duplicate panelist" });
    });
  });

export type PanelBody = z.infer<typeof panelBodySchema>;
export type ContextItem = PanelBody["context"][number];
export type Turn = PanelBody["conversation"][number];

export type ParseResult = { ok: true; body: PanelBody } | { ok: false; issues: { path: string; message: string }[] };

export function parsePanelBody(raw: unknown): ParseResult {
  const r = panelBodySchema.safeParse(raw);
  if (r.success) return { ok: true, body: r.data };
  return { ok: false, issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}
