import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSupportedNode, MINIMUM_NODE_MAJOR, nodeMajor } from "../scripts/lib/runtime.mjs";

test("Charthouse requires the oldest supported Node.js LTS major", () => {
  assert.equal(MINIMUM_NODE_MAJOR, 22);
  assert.equal(nodeMajor("22.0.0"), 22);
  assert.equal(nodeMajor("not-a-version"), null);
  assert.throws(
    () => assertSupportedNode("20.20.0"),
    /requires Node\.js 22 or newer; found 20\.20\.0/
  );
  assert.doesNotThrow(() => assertSupportedNode("22.0.0"));
  assert.doesNotThrow(() => assertSupportedNode("24.0.0"));
});
