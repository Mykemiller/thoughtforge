import { test } from "node:test";
import assert from "node:assert/strict";
import { tierForUrl, hostnameOf } from "./primary";

test("primary tier: government, ISO, utility and standards domains; secondary otherwise", () => {
  assert.equal(tierForUrl("https://www.ferc.gov/news/x"), "primary");
  assert.equal(tierForUrl("https://puc.texas.gov/agency/x"), "primary");
  assert.equal(tierForUrl("https://www.pjm.com/planning"), "primary");
  assert.equal(tierForUrl("https://standards.ieee.org/x"), "primary");
  assert.equal(tierForUrl("https://www.dominionenergy.com/x"), "primary");
  assert.equal(tierForUrl("https://www.datacenterdynamics.com/x"), "secondary");
  assert.equal(tierForUrl("not a url"), "secondary");
  assert.equal(tierForUrl(null), "secondary");
  assert.equal(hostnameOf("https://WWW.Example.com/a"), "example.com");
});
