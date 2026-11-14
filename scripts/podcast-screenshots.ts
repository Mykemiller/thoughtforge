// Playwright screenshots of the Podcast Library (Linear TH-39): /podcast, one episode, and the home card,
// at desktop (1280) and mobile (390) widths, from the TF_MOCK=1 fixtures. No database.
//
//   TF_MOCK=1 npm run build && npm run podcast:screenshots
//
// Writes PNGs to docs/podcast/screenshots/ and fails if any page scrolls horizontally at 360-1024px.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const OUT = "docs/podcast/screenshots";
const PORT = 3993;
mkdirSync(OUT, { recursive: true });

/** npx spawns next-server as a grandchild: kill the whole process group, or a stale server keeps the port. */
function stop(child: ChildProcess) {
  try { if (child.pid) process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); }
}

async function startNext(): Promise<ChildProcess> {
  try { await fetch(`http://localhost:${PORT}/`); throw new Error(`port ${PORT} is already serving; stop the old next-server first`); } catch (e) { if ((e as Error).message.startsWith("port")) throw e; }
  const child = spawn("npx", ["next", "start", "-p", String(PORT)], { env: { ...process.env, TF_MOCK: "1", NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  child.stderr?.on("data", (d) => process.stderr.write(`[next] ${d}`));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://localhost:${PORT}/podcast`)).ok) return child; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  stop(child);
  throw new Error("next start did not come up");
}

const executablePath = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const server = await startNext();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
let failed = false;
try {
  const shots = [
    { name: "podcast", path: "/podcast" },
    { name: "episode", path: "/podcast/PP-20261107-01" },
    { name: "home-card", path: "/" },
  ];
  for (const vp of [{ tag: "desktop", width: 1280, height: 900 }, { tag: "mobile", width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const s of shots) {
      await page.goto(`http://localhost:${PORT}${s.path}`, { waitUntil: "networkidle" });
      const styled = await page.evaluate(() => getComputedStyle(document.querySelector("header")!).position === "sticky");
      if (!styled) throw new Error(`${s.path}: stylesheet did not load (stale server?)`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) { failed = true; console.error(`${s.path} @${vp.tag}: horizontal overflow ${overflow}px`); }
      if (s.name === "home-card") {
        await page.locator("#latest-episode-heading").scrollIntoViewIfNeeded();
        await page.locator('section[aria-labelledby="latest-episode-heading"]').screenshot({ path: `${OUT}/${s.name}-${vp.tag}.png` });
      } else {
        await page.screenshot({ path: `${OUT}/${s.name}-${vp.tag}.png`, fullPage: s.name === "podcast" });
      }
      console.log(`wrote ${OUT}/${s.name}-${vp.tag}.png`);
    }
    // the sticky player with speed control, from the episode page
    if (vp.tag === "desktop") {
      await page.goto(`http://localhost:${PORT}/podcast/PP-20261107-01`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Play episode/ }).click();
      await page.getByRole("button", { name: "1.25x" }).click();
      await page.locator('section[aria-label="Podcast player"]').screenshot({ path: `${OUT}/player-desktop.png` });
      console.log(`wrote ${OUT}/player-desktop.png`);
    }
    await ctx.close();
  }
  // horizontal-scroll sweep across phone, landscape-phone and tablet widths (no screenshots)
  const sweep = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const sp = await sweep.newPage();
  for (const width of [360, 375, 640, 667, 768, 1024]) {
    await sp.setViewportSize({ width, height: 800 });
    for (const s of shots) {
      await sp.goto(`http://localhost:${PORT}${s.path}`, { waitUntil: "load" });
      const overflow = await sp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) { failed = true; console.error(`${s.path} @${width}px: horizontal overflow ${overflow}px`); }
    }
  }
  console.log("overflow sweep 360-1024 done");
  await sweep.close();
} finally {
  await browser.close();
  stop(server);
}
if (failed) process.exit(1);
