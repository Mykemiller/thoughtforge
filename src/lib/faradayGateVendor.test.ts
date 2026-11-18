// FDY-414: the vendored lib/faraday-gate/ must stay byte-identical to the canonical package
// (Mykemiller/faraday-workbench/packages/faraday-gate/). MANIFEST.sha256 pins every vendored file; never edit
// a vendored file — change the canonical package, bump VERSION, re-vendor, regenerate the manifest.
// Also renders GatePage under React 19 in every view and checks the no-price / draft-copy rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GatePage from "../../lib/faraday-gate/ui/GatePage";
import type { GateView } from "../../lib/faraday-gate/core";
import { TF_GATE_APP, TF_GATE_APP_NAME, TF_GATE_COPY } from "./faradayGate";

const VENDOR = path.join(process.cwd(), "lib", "faraday-gate");
const CANONICAL = path.join(process.cwd(), "..", "faraday-workbench", "packages", "faraday-gate");

function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join("/")];
  });
}
const sha256 = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

function manifest(): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of fs.readFileSync(path.join(VENDOR, "MANIFEST.sha256"), "utf8").split("\n")) {
    const hit = line.match(/^([0-9a-f]{64})\s+\.\/(.+)$/);
    if (hit) m.set(hit[2], hit[1]);
  }
  return m;
}

test("vendored faraday-gate matches MANIFEST.sha256 byte for byte, with no extra or missing files", () => {
  const m = manifest();
  const present = listFiles(VENDOR).filter((f) => f !== "MANIFEST.sha256").sort();
  assert.deepEqual(present, [...m.keys()].sort(), "file set matches the manifest");
  for (const [rel, hash] of m) assert.equal(sha256(path.join(VENDOR, rel)), hash, `${rel} drifted from the manifest`);
  for (const required of ["core.ts", "VERSION", "README.md", "ui/GatePage.tsx", "ui/gate.html", "gate-copy/thoughtforge.json",
    "server/check.ts", "server/guard.ts", "server/handlers.ts", "server/identity.ts", "server/request.ts"]) {
    assert.ok(m.has(required), `${required} is vendored`);
  }
});

test("vendored files are identical to the canonical package when it is checked out beside this repo",
  { skip: !fs.existsSync(CANONICAL) && "canonical faraday-workbench checkout not present" }, () => {
    for (const rel of manifest().keys()) {
      assert.ok(fs.readFileSync(path.join(VENDOR, rel)).equals(fs.readFileSync(path.join(CANONICAL, rel))), `${rel} differs from canonical`);
    }
  });

test("GatePage renders under React 19 in every view with no price, and draft copy never shows", () => {
  assert.equal(TF_GATE_COPY.status, "draft", "ThoughtForge copy is still draft (approval is Myke's call)");
  const views: GateView[] = ["request", "expired", "waitlist", "unavailable"];
  for (const view of views) {
    for (const email of [null, "someone@example.com"]) {
      const html = renderToStaticMarkup(createElement(GatePage, { app: TF_GATE_APP, appName: TF_GATE_APP_NAME, copy: TF_GATE_COPY, view, email }));
      const visible = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<link[^>]*>/g, "");
      assert.equal(visible.includes("$"), false, `$ in ${view}`);
      assert.equal(/USD|€|£|per month|\/mo\b|tokens?\b/i.test(visible), false, `price-like text in ${view}`);
      assert.ok(visible.includes("monthly subscription"), "commercial line present");
      assert.ok(visible.includes("ThoughtForge Panel"), "app name present");
      assert.equal(visible.includes(TF_GATE_COPY.story), false, "draft story never renders");
      if (view !== "unavailable") assert.ok(visible.includes("ThoughtForge Panel is in a private beta"), "neutral draft text");
      // The neutral draft story itself says "Request demo access", so check the button markup, not the phrase.
      if (view === "waitlist") assert.equal(visible.includes(">Request demo access</button>"), false, "no demo button in waitlist mode");
      if (view === "request") assert.ok(visible.includes(">Request demo access</button>") && visible.includes(">Join the waitlist</button>"));
      if (email) assert.ok(visible.includes(email));
      else assert.ok(visible.includes("Sign in"));
    }
  }
  const approved = renderToStaticMarkup(createElement(GatePage, {
    app: TF_GATE_APP, appName: TF_GATE_APP_NAME, copy: { ...TF_GATE_COPY, status: "approved" as const }, view: "request",
    termsUrl: "https://www.faraday-intelligence.ai/terms", privacyUrl: "https://www.faraday-intelligence.ai/privacy",
  }));
  assert.ok(approved.includes("evidence ladder"), "approved copy renders");
  assert.ok(approved.includes('href="https://www.faraday-intelligence.ai/terms"'));
});
