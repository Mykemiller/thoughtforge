/**
 * Regenerates fixtures/panel/{join,convene}.sse (FDY-345). Drives the real /api/panel handler end to end with a scripted
 * stand-in for the model (src/panel/testkit.ts), so the files carry the exact wire format of a live run without a key or
 * a network call. Run: `npx tsx scripts/make-panel-fixtures.ts`. The fixtures are part of the issue's contract:
 * live-agent copies these two files as its test fixtures (LA-7b).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handlePanel } from "../src/panel/handler.ts";
import { CONVERSATION_ID, TOKEN, fakeConveneDeps, fakeJoinClient, sampleBody } from "../src/panel/testkit.ts";

const FIXED_SESSION = "5d1f7a52-3c0e-4b8a-9a64-2f0e6b7d1c90";
process.env.LA_PANEL_TOKEN = TOKEN;
process.env.ANTHROPIC_API_KEY = "fixture-not-a-key";
delete process.env.TF_MOCK;

async function record(body: object, deps: Parameters<typeof handlePanel>[1]): Promise<string> {
  const res = await handlePanel(
    new Request("http://localhost/api/panel", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) }),
    deps,
  );
  if (res.status !== 200) throw new Error(`fixture run answered ${res.status}`);
  const text = await res.text();
  return text.replace(/"session_id":"[0-9a-f-]{36}"/g, `"session_id":"${FIXED_SESSION}"`);
}

const dir = join(process.cwd(), "fixtures", "panel");
mkdirSync(dir, { recursive: true });
const join_ = await record(sampleBody(), { joinClient: () => fakeJoinClient().client });
writeFileSync(join(dir, "join.sse"), join_);
const saved = { sessions: [] as unknown[], tagsSeen: [] as (string[] | undefined)[] };
const convene = await record(sampleBody({ mode: "convene", panelists: undefined, conversation_id: CONVERSATION_ID }), { live: fakeConveneDeps(saved) });
writeFileSync(join(dir, "convene.sse"), convene);
console.log(`wrote join.sse (${join_.length} bytes) and convene.sse (${convene.length} bytes)`);
