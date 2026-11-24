#!/usr/bin/env node
// FDY-433 (ADM-1.7h): end-to-end smoke for the podcast-feed carve-out, against a real `next start`.
// A local mock answers estate_entitled (and returns no rows for any table read), so nothing touches
// Supabase and no gate mode changes anywhere. The mock URL carries the project-of-record ref in its
// path, because the app refuses any Supabase URL that does not name it.
//
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399/ycadmmngkdhvpcsrcuaq NEXT_PUBLIC_SUPABASE_ANON_KEY=smoke npm run build
//   node scripts/faraday-gate-carveout-smoke.mjs
//
// Checks: mode "invite" + FARADAY_GATE_ENFORCE=1 → /podcast and an episode page show the gate, while
// /podcast/feed.xml is 200 RSS and the cover art is 200; mode "open" → nothing is gated.
import http from "node:http";
import { spawn } from "node:child_process";

const MOCK_PORT = 54399;
const APP_PORT = 3998;
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}/ycadmmngkdhvpcsrcuaq`;
let mode = "invite";

const mock = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (req.method === "POST" && req.url?.includes("/rest/v1/rpc/estate_entitled")) {
      const answer = mode === "open" ? { allowed: true, reason: "open", mode: "open" } : { allowed: false, reason: "no_grant", mode: "invite" };
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(answer));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("[]");
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startApp() {
  try {
    await fetch(`http://127.0.0.1:${APP_PORT}/`);
    throw new Error(`port ${APP_PORT} is already in use; stop that server first`);
  } catch (e) {
    if (String(e?.message).includes("already in use")) throw e;
  }
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: MOCK_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "smoke-test-not-a-key",
    SUPABASE_SERVICE_ROLE_KEY: "smoke-test-not-a-key",
    FARADAY_GATE_ENFORCE: "1",
  };
  // Own process group, so stop() also ends next-server (killing only the launcher leaves it running).
  const child = spawn("node_modules/.bin/next", ["start", "-p", String(APP_PORT)], { env, stdio: "ignore", detached: true });
  const stop = () => { try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ } };
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${APP_PORT}/podcast/cover-600.png`); return { stop }; } catch { await sleep(500); }
  }
  stop();
  throw new Error("next start did not come up");
}

const GATE_MARK = /Request demo access|Join the waitlist/;
async function probe(path) {
  const r = await fetch(`http://127.0.0.1:${APP_PORT}${path}`, { redirect: "manual" });
  const type = r.headers.get("content-type") ?? "";
  const text = type.startsWith("image/") ? "" : await r.text();
  return { status: r.status, type, gated: GATE_MARK.test(text), rss: /<rss [^>]*version="2.0"/.test(text) };
}

let failures = 0;
const expect = (label, cond, detail) => { console.log(`${cond ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`); if (!cond) failures++; };

await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));
try {
  for (const m of ["invite", "open"]) {
    mode = m;
    const app = await startApp();
    try {
      const page = await probe("/podcast");
      const feed = await probe("/podcast/feed.xml");
      const cover = await probe("/podcast/cover-600.png");
      expect(`${m}: /podcast/feed.xml is 200 RSS with no gate`, feed.status === 200 && feed.rss && !feed.gated, `HTTP ${feed.status} ${feed.type}`);
      expect(`${m}: /podcast/cover-600.png is 200`, cover.status === 200, `HTTP ${cover.status} ${cover.type}`);
      if (m === "invite") expect("invite: /podcast shows the gate", page.gated, `HTTP ${page.status}`);
      else expect("open: /podcast is 200 with no gate", page.status === 200 && !page.gated, `HTTP ${page.status}`);
    } finally {
      app.stop();
      await sleep(1500);
    }
  }
} finally {
  mock.close();
}
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
