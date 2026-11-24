// FDY-447 / FDY-443: the site top bar is the vendored Faraday masthead (no teal header, no "TF" roundel), the
// ThoughtForge nav lives in the AppBar with the same targets, and the sub-app pull-down offers ThoughtForge Panel
// and Panel Podcast. Rendered with React 19 outside the Next router (usePathname is null there, so "/").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteChrome, TF_APP_NAME, currentNavHref } from "./SiteChrome";
import { SUB_APPS, SubAppSwitcher, subAppFor } from "./SubAppSwitcher";

const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<link[^>]*>/g, "");

test("top bar is the shared Faraday masthead with ThoughtForge Panel in the context slot", () => {
  const html = renderToStaticMarkup(createElement(SiteChrome));
  assert.match(html, /<header class="fm" role="banner" data-fm="1\.0\.0">/);
  assert.match(html, /<span class="fm-app">ThoughtForge Panel<\/span>/);
  assert.match(html, /<a class="fm-skip" href="#main">Skip to content<\/a>/);
  assert.equal(TF_APP_NAME, "ThoughtForge Panel");
  const v = visible(html);
  assert.equal(/>TF</.test(v), false, "no TF roundel in the top bar");
  assert.equal(/1f3f46|3fa7a8|bg-primary/i.test(html), false, "no teal in the top bar");
  assert.equal(v.includes("Sign in"), false, "no site-wide sign-in control (the gate has its own)");
});

test("AppBar carries Home, Panel, Ask the panel, 1:1, Podcast with the old targets, after the sub-app pull-down", () => {
  const html = renderToStaticMarkup(createElement(SiteChrome));
  assert.match(html, /<nav class="fm-appbar" aria-label="ThoughtForge Panel">/);
  const nav = html.slice(html.indexOf('<nav class="fm-appbar"'));
  const links = [...nav.matchAll(/<a([^>]*class="fm-applink"[^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1].match(/href="([^"]+)"/)![1],
    text: m[2].replace(/<span class="tf-short"[^>]*>[^<]*<\/span>/g, "").replace(/<[^>]+>/g, ""),
  }));
  assert.deepEqual(links, [
    { href: "/", text: "Home" }, { href: "/panel", text: "Panel" }, { href: "/ask", text: "Ask the panel" },
    { href: "/interview", text: "1:1" }, { href: "/podcast", text: "Podcast" },
  ]);
  assert.ok(nav.indexOf("tf-subapp") < nav.indexOf('class="fm-applink"'), "pull-down leads the row");
  assert.match(nav, /<span class="tf-long">Ask the panel<\/span>/);
});

test("current nav item by path", () => {
  assert.equal(currentNavHref("/"), "/");
  assert.equal(currentNavHref("/panel"), "/panel");
  assert.equal(currentNavHref("/panel/mach-eigen"), "/panel");
  assert.equal(currentNavHref("/podcast/ep-1"), "/podcast");
  assert.equal(currentNavHref("/panelists"), null);
});

test("sub-app pull-down: two entries, closed by default, button controls the panel", () => {
  assert.deepEqual(SUB_APPS.map((s) => [s.label, s.href]), [["ThoughtForge Panel", "/"], ["Panel Podcast", "/podcast"]]);
  for (const [pathname, current] of [["/", "ThoughtForge Panel"], ["/ask", "ThoughtForge Panel"], ["/podcast", "Panel Podcast"], ["/podcast/abc", "Panel Podcast"]] as const) {
    const html = renderToStaticMarkup(createElement(SubAppSwitcher, { pathname }));
    assert.match(html, /<button type="button" class="tf-subapp-btn" aria-expanded="false" aria-controls="([^"]+)"/);
    const id = html.match(/aria-controls="([^"]+)"/)![1];
    assert.ok(html.includes(`id="${id}" hidden=""`), "panel is hidden until opened");
    assert.ok(html.includes(`current: </span>${current}`), `${pathname} shows ${current}`);
    assert.match(html, new RegExp(`aria-current="page" href="${current === "Panel Podcast" ? "/podcast" : "/"}"`));
    assert.equal((html.match(/class="tf-subapp-item"/g) || []).length, 2);
  }
  assert.equal(subAppFor("/podcasting"), "panel");
});

test("the AppBar dropdown workaround and the gate's chrome hand-off are in globals.css", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
  assert.match(css, /\.tf-appbar \.fm-appbar-in \{ overflow: visible;/, "local overflow workaround (removable with masthead 1.1.0, FDY-460)");
  assert.match(css, /prefers-reduced-motion: no-preference[\s\S]*tf-subapp/);
  assert.match(css, /body:has\(#fg-main\) :is\(\.tf-mast, \.tf-appbar\) \{ display: none; \}/);
  for (const hex of ["#1C3424", "#C4922A", "#EEE6DA"]) assert.ok(css.includes(hex), `brand token ${hex}`);
});
