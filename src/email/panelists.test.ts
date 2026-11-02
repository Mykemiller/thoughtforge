import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCast } from "../cast/loader";
import { EMAIL_ORDER, fromHeader, loadEmailPanelists, localPart, SENDING_DOMAIN, signature } from "./panelists";

test("email order matches the cast manifest order (TF-DEC-31)", () => {
  assert.deepEqual([...EMAIL_ORDER], loadCast().map((m) => m.slug));
});

test("ten distinct From addresses on the panel subdomain, first.last, Dr. and short names handled", () => {
  const ps = loadEmailPanelists();
  assert.equal(ps.length, 10);
  assert.equal(new Set(ps.map((p) => p.address)).size, 10);
  for (const p of ps) {
    assert.match(p.address, new RegExp(`^[a-z]+\\.[a-z]+@${SENDING_DOMAIN.replace(/\./g, "\\.")}$`));
    assert.equal(p.from, `"${p.name}" <${p.address}>`);
    assert.ok(p.voiceBrief.length > 20 && p.backstory.length > 20, `${p.slug} voice or backstory empty`);
  }
  const by = new Map(ps.map((p) => [p.slug, p]));
  assert.equal(by.get("ingrid-halverson")!.address, `ingrid.halverson@${SENDING_DOMAIN}`);
  assert.equal(by.get("hartford-caldwell")!.address, `hartford.caldwell@${SENDING_DOMAIN}`);
  assert.equal(by.get("hartford-caldwell")!.firstName, "Hart");
  assert.equal(by.get("rosalind-ferraro")!.firstName, "Rose");
  assert.equal(by.get("victoria-stroud")!.firstName, "Vick");
  assert.equal(by.get("ingrid-halverson")!.from, `"Dr. Ingrid Halverson" <ingrid.halverson@${SENDING_DOMAIN}>`);
  // Never the root domain (its mail is on Fastmail).
  for (const p of ps) assert.ok(!p.address.endsWith("@faraday-thoughtforge.com"));
});

test("local part and From header helpers", () => {
  assert.equal(localPart("Dr. Ingrid Halverson"), "ingrid.halverson");
  assert.equal(localPart("Hartford Caldwell (Hart)"), "hartford.caldwell");
  assert.throws(() => localPart("Cher"), /first\.last/);
  assert.equal(fromHeader('A "B" C', "x@y.z"), '"A B C" <x@y.z>');
});

test("signature is two lines: name and role, then the panel line", () => {
  assert.equal(signature({ name: "Mach Eigen", role: "Chief Engineer" }), "Mach Eigen, Chief Engineer\nThoughtForge panel, Faraday Intelligence");
});
