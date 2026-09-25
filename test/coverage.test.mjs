import assert from "node:assert/strict";
import { test } from "node:test";
import { navigatorCoverage } from "../scripts/lib/coverage.mjs";

const capability = (id, primary, extra = {}) => ({ id, name: id, purpose: "Own a real capability with enough words.", primary_paths: primary, evidence: [], confidence: 0.8, approved: true, ...extra });
const file = (path, owner, role = "source") => ({ path, owner, role });

test("coverage counts only files that a scanned unit or no unit owns", () => {
  const map = {
    units: [
      { id: "unit-app", root: "app", scope: "included" },
      { id: "unit-vendor", root: "vendor/lib", scope: "stub" }
    ],
    files: [
      file("app/index.js", "unit-app"),
      file("vendor/lib/package.json", "unit-vendor"),
      file("tools/release.js", null)
    ],
    capabilities: [capability("cap-app", ["app/**"], { evidence: ["app/index.js"] })]
  };
  const coverage = navigatorCoverage(map);
  // A stub unit has no capability by design, so its manifest is not a gap.
  assert.deepEqual(coverage.uncovered, ["tools/release.js"]);
  assert.equal(coverage.maintained, 2);
});

test("coverage is not measured before the first approval", () => {
  assert.equal(navigatorCoverage({ units: [], files: [file("a.js", null)], capabilities: [capability("cap-a", ["**"], { approved: false })] }), null);
});
