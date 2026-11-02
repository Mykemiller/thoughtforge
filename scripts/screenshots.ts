// Headless screenshots of /ask (mock and locked) and a /panel/[slug] mobile check (TH-32 §8).
//
//   npm run build && npm run screenshots
//
// Starts `next start` twice on local ports: once with TF_MOCK=1 and no access key (open, canned
// session), once with a throwaway TF_ACCESS_KEY (locked state, then the ?key= exchange). Writes
// PNGs to docs/screenshots/. Uses Playwright's bundled Chromium (npx playwright install chromium).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });

async function startNext(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    env: { ...process.env, ...env, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (d) => process.stderr.write(`[next:${port}] ${d}`));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${port}/`);
      if (r.ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  child.kill();
  throw new Error(`next start on ${port} did not come up`);
}

const browser = await chromium.launch();
try {
  // 1. Open, mock session.
  const open = await startNext(3991, { TF_MOCK: "1", TF_ACCESS_KEY: "" });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto("http://localhost:3991/ask", { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/ask-empty.png`, fullPage: false });
    await page.fill("#question", "A 300 MW AI campus in the Midwest breaks ground next spring. Should we commit the first two halls to 800 VDC rack distribution now, or stay on 415 VAC and revisit in 2027?");
    await page.click("button[type=submit]");
    await page.waitForSelector("text=saved as a panel artifact", { timeout: 90_000 });
    await page.screenshot({ path: `${OUT}/ask-mock-session.png`, fullPage: true });
    console.log("wrote ask-empty.png, ask-mock-session.png");

    // Mobile check on a bio page: no horizontal scroll at 375px.
    const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true });
    const mp = await mobile.newPage();
    await mp.goto("http://localhost:3991/panel/mach-eigen", { waitUntil: "networkidle" });
    const widths = await mp.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    if (widths.scroll > widths.inner) throw new Error(`horizontal scroll on /panel/mach-eigen at 375px: ${widths.scroll} > ${widths.inner}`);
    await mp.screenshot({ path: `${OUT}/panel-mach-eigen-mobile.png`, fullPage: true });
    await mp.goto("http://localhost:3991/ask", { waitUntil: "networkidle" });
    const w2 = await mp.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    if (w2.scroll > w2.inner) throw new Error(`horizontal scroll on /ask at 375px: ${w2.scroll} > ${w2.inner}`);
    await mp.screenshot({ path: `${OUT}/ask-mobile.png`, fullPage: false });
    console.log(`wrote panel-mach-eigen-mobile.png, ask-mobile.png (no horizontal scroll at 375px)`);
    await mobile.close();
    await ctx.close();
  } finally {
    open.kill();
  }

  // 2. Locked, then unlocked through ?key=.
  const key = "screenshot-run-throwaway-key";
  const locked = await startNext(3992, { TF_MOCK: "1", TF_ACCESS_KEY: key });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto("http://localhost:3992/ask", { waitUntil: "networkidle" });
    await page.waitForSelector("text=The panel room is private for now.");
    await page.screenshot({ path: `${OUT}/ask-locked.png`, fullPage: false });
    const api = await page.request.post("http://localhost:3992/api/ask", { data: { question: "x" } });
    if (api.status() !== 401) throw new Error(`locked /api/ask returned ${api.status()}, expected 401`);
    // Wrong magic word: still locked, says so, and the guess is not left in the address bar.
    await page.fill("#magic-word", "not-the-word");
    await page.click("form button[type=submit]");
    await page.waitForSelector("text=That was not the word.");
    if (page.url().includes("key=")) throw new Error("a wrong ?key= was left in the address bar");
    if ((await ctx.cookies()).some((x) => x.name === "tf_access")) throw new Error("a wrong magic word set the cookie");
    await page.screenshot({ path: `${OUT}/ask-locked-denied.png`, fullPage: false });
    // Right magic word through the form.
    await page.fill("#magic-word", key);
    await page.click("form button[type=submit]");
    await page.waitForURL((u) => u.pathname === "/ask" && !u.searchParams.has("key"));
    if (page.url().includes("key=")) throw new Error("the ?key= query was not stripped on redirect");
    const cookies = await ctx.cookies();
    const c = cookies.find((x) => x.name === "tf_access");
    if (!c || !c.httpOnly || c.value.length !== 64) throw new Error("tf_access cookie not set as expected");
    await page.waitForSelector("#question");
    console.log("wrote ask-locked.png, ask-locked-denied.png; wrong word denied without a cookie; the magic-word form set an httpOnly 64-hex tf_access cookie and unlocked /ask; locked /api/ask answered 401");
    await ctx.close();
  } finally {
    locked.kill();
  }
} finally {
  await browser.close();
}
