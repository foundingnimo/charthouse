import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(packageRoot, "bin/charthouse");
const fixture = join(packageRoot, "test/fixtures/monorepo");
let sandbox;

function run(...args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: sandbox, encoding: "utf8" });
}

function ok(...args) {
  const result = run(...args);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function git(...args) {
  const result = spawnSync("git", ["-c", "user.email=charthouse@test.local", "-c", "user.name=Charthouse Test", "-c", "commit.gpgsign=false", ...args], { cwd: sandbox, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function readLog() {
  return JSON.parse(readFileSync(join(sandbox, ".charthouse/tool-gaps.json"), "utf8"));
}

function record(voyage, reporter, checked = "dependency-graph", overrides = {}) {
  const values = {
    key: "dependency-cycle-detection",
    need: "Find cycles between mapped repository units.",
    fallback: "system-utility",
    summary: "Analyzed the exported dependency edges.",
    input: "Map dependency edges",
    output: "Ordered dependency cycles",
    ...overrides
  };
  return run(
    "tool", "gap", "record",
    "--key", values.key,
    "--need", values.need,
    "--checked", checked,
    "--fallback", values.fallback,
    "--summary", values.summary,
    "--input", values.input,
    "--output", values.output,
    "--voyage", voyage,
    "--reporter", reporter,
    "--root", sandbox,
    "--json"
  );
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "charthouse-tool-gaps-"));
  cpSync(fixture, sandbox, { recursive: true });
  git("init", "--quiet");
  git("add", "-A");
  git("commit", "--quiet", "-m", "fixture");
  git("branch", "canonical");
  ok("init", "--canonical-ref", "canonical", "--root", sandbox);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

test("init creates an empty Tool Gap Log", () => {
  assert.equal(existsSync(join(sandbox, ".charthouse/tool-gaps.json")), true);
  assert.deepEqual(readLog(), { schema_version: 1, next_id: 1, gaps: [] });
  assert.deepEqual(JSON.parse(ok("tool", "gaps", "--root", sandbox, "--json").stdout), []);
});

test("recurring reports become a candidate without retry inflation", () => {
  let result = record("V-0012", "charthouse-structure-mapper");
  assert.equal(result.status, 0, result.stderr);
  let payload = JSON.parse(result.stdout);
  assert.equal(payload.outcome, "created");
  assert.equal(payload.gap.id, "TG-0001");
  assert.equal(payload.gap.status, "observed");

  result = record("V-0012", "charthouse-structure-mapper");
  assert.equal(result.status, 0, result.stderr);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.recorded, false);
  assert.equal(payload.outcome, "duplicate");
  assert.equal(payload.gap.occurrences, 1);

  assert.equal(record("V-0012", "charthouse-capability-mapper").status, 0);
  result = record("V-0017", "charthouse-structure-mapper");
  assert.equal(result.status, 0, result.stderr);
  payload = JSON.parse(result.stdout);
  assert.equal(payload.outcome, "promoted");
  assert.equal(payload.gap.status, "candidate");
  assert.equal(payload.gap.occurrences, 3);
  assert.deepEqual(payload.gap.voyages, ["V-0012", "V-0017"]);

  const candidates = JSON.parse(ok("tool", "gap", "list", "--status", "candidate", "--root", sandbox, "--json").stdout);
  assert.deepEqual(candidates.map((gap) => gap.id), ["TG-0001"]);
  const status = JSON.parse(ok("status", "--root", sandbox, "--json").stdout);
  assert.equal(status.tool_gaps.candidates, 1);
  const next = ok("next", "--root", sandbox).stdout;
  assert.match(next, /\[tool candidate\] TG-0001/);
  assert.match(next, /charthouse tool gap list --status candidate/);
});

test("an Expedition records Tool Gaps without satisfying the Voyage promotion threshold", () => {
  const result = run(
    "tool", "gap", "record",
    "--key", "repository-symbol-query",
    "--need", "Query symbols without a temporary script.",
    "--checked", "dependency-graph",
    "--checked", "documentation-index,none",
    "--fallback", "temporary-script",
    "--summary", "Parsed the repository with a temporary helper.",
    "--input", "Repository files",
    "--output", "Symbol relationships",
    "--expedition", "E-0001",
    "--reporter", "charthouse-structure-mapper",
    "--root", sandbox,
    "--json"
  );
  assert.equal(result.status, 0, result.stderr);
  const gap = JSON.parse(result.stdout).gap;
  assert.deepEqual(gap.existing_tools_checked, ["dependency-graph", "documentation-index"]);
  assert.deepEqual(gap.expeditions, ["E-0001"]);
  assert.deepEqual(gap.voyages, []);
  assert.equal(gap.status, "observed");

  for (const reporter of ["charthouse-capability-mapper", "charthouse-documentation-mapper"]) {
    const repeated = run(
      "tool", "gap", "record",
      "--key", "repository-symbol-query",
      "--need", "Query symbols without a temporary script.",
      "--checked", "dependency-graph",
      "--fallback", "temporary-script",
      "--summary", "Parsed the repository with a temporary helper.",
      "--input", "Repository files",
      "--output", "Symbol relationships",
      "--expedition", "E-0001",
      "--reporter", reporter,
      "--root", sandbox,
      "--json"
    );
    assert.equal(repeated.status, 0, repeated.stderr);
  }
  assert.equal(readLog().gaps[0].occurrences, 3);
  assert.equal(readLog().gaps[0].status, "observed");
});

test("Tool Gap recording requires exactly one Voyage or Expedition context", () => {
  const base = [
    "tool", "gap", "record",
    "--key", "repository-symbol-query",
    "--need", "Query symbols without a temporary script.",
    "--checked", "none",
    "--fallback", "manual",
    "--summary", "Inspected the repository manually.",
    "--input", "Repository files",
    "--output", "Symbol relationships"
  ];
  const missing = run(...base, "--root", sandbox);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /exactly one of --voyage or --expedition/);
  const ambiguous = run(...base, "--voyage", "V-0001", "--expedition", "E-0001", "--root", sandbox);
  assert.equal(ambiguous.status, 1);
  assert.match(ambiguous.stderr, /exactly one of --voyage or --expedition/);
  const unknown = run(...base, "--expedition", "E-0099", "--root", sandbox);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown Expedition: E-0099/);
  const malformed = run(...base, "--expedition", "expedition-one", "--root", sandbox);
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /E-0001 form/);
  assert.deepEqual(readLog().gaps, []);
});

test("a Tool Gap exports, resolves, reopens, and dismisses safely", () => {
  assert.equal(record("V-0012", "charthouse-structure-mapper").status, 0);
  assert.equal(record("V-0012", "charthouse-capability-mapper").status, 0);
  assert.equal(record("V-0017", "charthouse-structure-mapper").status, 0);

  const exported = JSON.parse(ok("tool", "gap", "export", "TG-0001", "--root", sandbox, "--json").stdout);
  assert.match(exported.body, /# Toolbox candidate: dependency-cycle-detection/);
  assert.match(exported.body, /Occurrences: 3/);
  assert.equal(exported.body.includes(sandbox), false);

  let resolved = JSON.parse(ok("tool", "gap", "resolve", "TG-0001", "--tool", "dependency-graph", "--version", "1.0.0", "--root", sandbox, "--json").stdout);
  assert.equal(resolved.status, "resolved");
  assert.deepEqual(resolved.resolved_by.tool, "dependency-graph");

  let result = record("V-0020", "charthouse-duplication-mapper", "none");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Check that tool before recording the gap again/);

  result = record("V-0020", "charthouse-duplication-mapper", "dependency-graph");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).outcome, "reopened");
  assert.equal(JSON.parse(result.stdout).gap.status, "candidate");

  const dismissed = JSON.parse(ok("tool", "gap", "dismiss", "TG-0001", "--reason", "This operation is repository-specific.", "--root", sandbox, "--json").stdout);
  assert.equal(dismissed.status, "dismissed");
  const before = dismissed.occurrences;
  result = record("V-0021", "charthouse-structure-mapper");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).outcome, "dismissed");
  assert.equal(readLog().gaps[0].occurrences, before);
  assert.equal(run("tool", "gap", "export", "TG-0001", "--root", sandbox).status, 1);
});

test("Tool Gap recording rejects unsafe or invalid reports", () => {
  let result = record("V-0012", "charthouse-structure-mapper", "unknown-tool");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown registered tool/);

  result = record("V-0012", "charthouse-structure-mapper", "none", { need: "Inspect /Users/example/private.txt." });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not contain an absolute path/);

  result = record("V-0012", "charthouse-structure-mapper", "none", { fallback: "downloaded-script" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--fallback must be one of/);

  assert.equal(record("V-0012", "charthouse-structure-mapper", "none").status, 0);
  result = record("V-0017", "charthouse-capability-mapper", "none", { summary: "Used ~/private-helper.js." });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must not contain an absolute path/);
  assert.equal(readLog().gaps[0].occurrences, 1);
});

test("an existing Charthouse project creates a missing Log on first record", () => {
  rmSync(join(sandbox, ".charthouse/tool-gaps.json"));
  assert.deepEqual(JSON.parse(ok("tool", "gaps", "--root", sandbox, "--json").stdout), []);
  const result = record("V-0001", "charthouse");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(sandbox, ".charthouse/tool-gaps.json")), true);
  assert.equal(readLog().gaps[0].id, "TG-0001");
});

test("specialist agents report structured gaps without writing the Log", () => {
  const agents = readdirSync(join(packageRoot, "agents")).filter((name) => name.endsWith(".md"));
  assert.equal(agents.length, 9);
  for (const name of agents) {
    const text = readFileSync(join(packageRoot, "agents", name), "utf8");
    assert.match(text, /`tool_gap` object/);
    assert.match(text, /Do not write\s+(?:`\.charthouse\/tool-gaps\.json`|the Log)/i);
  }
});
