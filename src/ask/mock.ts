/**
 * TF_MOCK=1 replay (TH-32 §7): streams the canned session in
 * src/cast/__fixtures__/mock-session.json with small delays so /ask is
 * demonstrable without any key.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sessionToEvents, type AskEvent, type PanelSession } from "./sse";
import { PANEL_ORDER } from "./roster";

export const isMock = () => process.env.TF_MOCK === "1";

export function loadMockSession(): PanelSession {
  return JSON.parse(readFileSync(join(process.cwd(), "src", "cast", "__fixtures__", "mock-session.json"), "utf8")) as PanelSession;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runMock(question: string, emit: (ev: AskEvent) => void, delayMs = 12): Promise<PanelSession> {
  const fixture = loadMockSession();
  const session: PanelSession = { ...fixture, question, session_id: crypto.randomUUID() };
  for (const ev of sessionToEvents(session, [...PANEL_ORDER])) {
    emit(ev);
    if (ev.type === "panelist_delta" || ev.type === "ruling_delta") await sleep(delayMs);
    if (ev.type === "factcheck") await sleep(delayMs * 20);
  }
  return session;
}
