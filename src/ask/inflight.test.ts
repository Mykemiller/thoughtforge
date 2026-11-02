import { test } from "node:test";
import assert from "node:assert/strict";
import { acquire, release, inflightCount } from "./inflight";

test("one in-flight request per key", () => {
  assert.equal(acquire("a"), true);
  assert.equal(acquire("a"), false);
  assert.equal(acquire("b"), true);
  assert.equal(inflightCount(), 2);
  release("a");
  assert.equal(acquire("a"), true);
  release("a");
  release("b");
  assert.equal(inflightCount(), 0);
});
