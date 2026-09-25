import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { acceptAllSurveys, approveExpeditionMap, surveyReports } from "./helpers/surveys.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(packageRoot, "bin/charthouse");
const fixture = join(packageRoot, "test/fixtures/monorepo");
let sandbox;

function rawRun(...args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: sandbox,
    encoding: "utf8"
  });
}

function run(...args) {
  const effective = args[0] === "init" && !args.includes("--canonical-ref")
    ? ["init", "--canonical-ref", "canonical", ...args.slice(1)]
    : args;
  return rawRun(...effective);
}

function git(...args) {
  return spawnSync("git", args, { cwd: sandbox, encoding: "utf8" });
}

function readMap() {
  return JSON.parse(readFileSync(join(sandbox, ".charthouse/map.json"), "utf8"));
}

function editConfig(change) {
  const path = join(sandbox, ".charthouse/config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  change(config);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

function approveAllCapabilities() {
  approveExpeditionMap(sandbox, run);
  const result = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(result.status, 0, result.stderr);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "charthouse-test-"));
  cpSync(fixture, sandbox, { recursive: true });
  assert.equal(git("init", "--quiet").status, 0);
  assert.equal(git("add", "-A").status, 0);
  assert.equal(git("-c", "user.name=Charthouse Test", "-c", "user.email=charthouse@test.local", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture").status, 0);
  assert.equal(git("branch", "canonical").status, 0);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

test("Toolbox discovery works before repository initialization", () => {
  const listed = run("tool", "list", "--root", sandbox, "--json");
  assert.equal(listed.status, 0, listed.stderr);
  const tools = JSON.parse(listed.stdout);
  assert.deepEqual(tools.map((tool) => tool.name), [
    "repository-files",
    "dependency-graph",
    "documentation-index",
    "duplicate-analysis",
    "survey-report-validate"
  ]);
  assert.ok(tools.every((tool) => tool.runtime === "node"));
  assert.ok(tools.every((tool) => tool.permissions.repository_read && !tool.permissions.repository_write && !tool.permissions.network));
  for (const name of ["documentation-index", "survey-report-validate"]) {
    assert.deepEqual(tools.find((tool) => tool.name === name).permissions.subprocesses, ["git"]);
  }
  assert.ok(tools.filter((tool) => !["documentation-index", "survey-report-validate"].includes(tool.name)).every((tool) => tool.permissions.subprocesses.length === 0));

  const described = run("tool", "describe", "repository-files", "--root", sandbox, "--json");
  assert.equal(described.status, 0, described.stderr);
  assert.equal(JSON.parse(described.stdout).input_schema.properties.limit.maximum, 1000);

  const surveyValidator = JSON.parse(run("tool", "describe", "survey-report-validate", "--root", sandbox, "--json").stdout);
  assert.deepEqual(surveyValidator.input_schema.required, ["role", "file"]);
  assert.equal(surveyValidator.contract.schema, "schemas/survey-report.schema.json");
  assert.deepEqual(surveyValidator.contract.roles, ["structure", "capability", "documentation", "duplication"]);

  assert.equal(run("tool", "list", "unexpected", "--root", sandbox).status, 1);
  assert.equal(run("tool", "run", "repository-files", "--root", sandbox).status, 1);
  assert.equal(run("tool", "run", "survey-report-validate", "--role", "capability", "--root", sandbox).status, 1);
});

test("init requires the user-selected exact canonical branch", () => {
  const unpinned = rawRun("init", "--root", sandbox);
  assert.equal(unpinned.status, 1);
  assert.match(unpinned.stderr, /requires git\.canonical_ref to name one exact local or remote-tracking branch/);
  assert.match(unpinned.stderr, /Available branches:[^\n]*canonical/);
  assert.match(unpinned.stderr, /Ask the user/);
  assert.equal(existsSync(join(sandbox, ".charthouse/map.json")), false);

  const tag = git("tag", "release-point");
  assert.equal(tag.status, 0, tag.stderr);
  const wrongKind = rawRun("init", "--canonical-ref", "release-point", "--root", sandbox);
  assert.equal(wrongKind.status, 1);
  assert.match(wrongKind.stderr, /is not a branch/);

  const initialized = rawRun("init", "--canonical-ref", "canonical", "--root", sandbox, "--json");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(JSON.parse(initialized.stdout).canonical.ref, "canonical");
  assert.equal(JSON.parse(readFileSync(join(sandbox, ".charthouse/config.json"), "utf8")).git.canonical_ref, "canonical");
});

test("init starts a resumable Expedition without publishing preliminary Navigators", () => {
  const result = run("init", "--root", sandbox, "--json");
  assert.equal(result.status, 0, result.stderr);
  const initialized = JSON.parse(result.stdout);
  assert.equal(initialized.expedition.id, "E-0001");
  assert.equal(initialized.expedition.status, "surveying");
  assert.equal(existsSync(join(sandbox, ".charthouse/expeditions/E-0001.json")), true);
  assert.equal(existsSync(join(sandbox, ".charthouse/drafts/.gitignore")), true);
  assert.equal(initialized.next.some((item) => item.includes("oversized agent instruction files")), false);
  const map = JSON.parse(readFileSync(join(sandbox, ".charthouse/map.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(sandbox, ".charthouse/manifest.json"), "utf8"));
  assert.equal(map.units.length, 3);
  assert.equal(map.dependencies.length, 1);
  assert.equal(map.files.find((file) => file.path.endsWith("index.test.ts")).role, "test");
  assert.equal(map.files.find((file) => file.path.endsWith("account.json")).role, "fixture");
  assert.equal(map.files.some((file) => file.path.includes("/dist/")), false);
  const generatedBoundary = map.perimeter_regions.find((region) => region.path === "apps/web/dist");
  assert.equal(generatedBoundary.classification, "generated");
  assert.deepEqual(generatedBoundary.reasons, ["generated-policy"]);
  assert.equal(Object.keys(manifest.navigators).length, 0);
  assert.equal(manifest.schema_version, 2);
  assert.equal(existsSync(join(sandbox, ".claude/agents")), false);
  assert.equal(existsSync(join(sandbox, ".claude/rules/charthouse")), false);
  assert.equal(existsSync(join(sandbox, ".agents/skills")), false);
  const premature = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(premature.status, 1);
  assert.match(premature.stderr, /E-0001 cannot publish until each survey checkpoint is valid/);
  const status = JSON.parse(run("expedition", "status", "--root", sandbox, "--json").stdout);
  assert.deepEqual(status.next_roles, ["structure", "capability", "documentation", "duplication"]);
  assert.ok(readFileSync(join(sandbox, "docs/charthouse/charter.md"), "utf8").includes("# Charthouse Charter"));
});

test("regeneration refuses a capability that the publication rescan finds after approval", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  approveExpeditionMap(sandbox, run);
  const canonicalMap = readFileSync(join(sandbox, ".charthouse/map.json"), "utf8");
  mkdirSync(join(sandbox, "packages/new"), { recursive: true });
  writeFileSync(join(sandbox, "packages/new/package.json"), `${JSON.stringify({ name: "new", version: "1.0.0" })}\n`);
  writeFileSync(join(sandbox, "packages/new/index.js"), "export const added = true;\n");

  const regenerate = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(regenerate.status, 1);
  assert.match(regenerate.stderr, /cap-packages-new/);
  assert.equal(readFileSync(join(sandbox, ".charthouse/map.json"), "utf8"), canonicalMap);
  assert.equal(existsSync(join(sandbox, ".claude/agents")), false);
  assert.equal(JSON.parse(run("expedition", "status", "--root", sandbox, "--json").stdout).checkpoint_status, "approved");
});

test("regeneration refuses while an Expedition survey checkpoint is missing or changed", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);

  const unsurveyed = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(unsurveyed.status, 1);
  assert.match(unsurveyed.stderr, /E-0001/);
  assert.match(unsurveyed.stderr, /structure, capability, documentation, duplication/);
  assert.equal(existsSync(join(sandbox, ".claude/agents")), false);
  const pending = JSON.parse(run("expedition", "resume", "--root", sandbox, "--json").stdout);
  assert.equal(pending.checkpoint_status, "surveying");
  assert.deepEqual(pending.next_roles, ["structure", "capability", "documentation", "duplication"]);

  const expedition = acceptAllSurveys(sandbox, run);
  const duplicationReport = join(sandbox, expedition.surveys.duplication.report_path);
  writeFileSync(duplicationReport, readFileSync(duplicationReport, "utf8").replace("are reviewed", "were edited after acceptance"));
  const changed = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /duplication/);
  assert.equal(existsSync(join(sandbox, ".claude/agents")), false);
  assert.equal(JSON.parse(run("expedition", "status", "--root", sandbox, "--json").stdout).checkpoint_status, "ready-for-synthesis");
});

function expeditionJson(...args) {
  const result = run("expedition", ...args, "--root", sandbox, "--json");
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function editDraft(path, change) {
  const draft = JSON.parse(readFileSync(join(sandbox, path), "utf8"));
  change(draft);
  writeFileSync(join(sandbox, path), `${JSON.stringify(draft, null, 2)}\n`);
}

test("an Expedition stages synthesis and approvals outside canonical state until publication", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  acceptAllSurveys(sandbox, run);
  const canonicalPath = join(sandbox, ".charthouse/map.json");
  const canonical = readFileSync(canonicalPath, "utf8");
  const early = run("expedition", "stage", "E-0001", "--root", sandbox);
  assert.equal(early.status, 1);
  assert.match(early.stderr, /has not started synthesis/);

  const started = expeditionJson("synthesize", "E-0001");
  assert.equal(started.outcome, "Synthesis started");
  assert.equal(started.draft_path, ".charthouse/drafts/E-0001/synthesis/map.json");
  assert.deepEqual(JSON.parse(readFileSync(join(sandbox, started.draft_path), "utf8")), JSON.parse(canonical));
  assert.equal(started.expedition.status, "synthesizing");
  assert.equal(started.expedition.synthesis.current, true);
  assert.match(started.expedition.next[0], /expedition stage E-0001/);
  assert.equal(expeditionJson("synthesize", "E-0001").outcome, "Synthesis already started");
  const unapproved = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(unapproved.status, 1);
  assert.match(unapproved.stderr, /human-approved in the Expedition\. E-0001 is synthesizing/);

  editDraft(started.draft_path, (draft) => {
    draft.capabilities.find((item) => item.id === "cap-packages-auth").purpose = "Issue and verify session tokens.";
  });
  const staged = expeditionJson("stage", "E-0001");
  assert.deepEqual(staged.capabilities, ["cap-apps-web", "cap-fixture-root", "cap-packages-auth"]);
  assert.equal(staged.expedition.status, "awaiting-approval");
  const partial = expeditionJson("approve", "E-0001", "--capability", "cap-apps-web");
  assert.deepEqual(partial.remaining, ["cap-fixture-root", "cap-packages-auth"]);
  assert.match(partial.expedition.next[0], /1 of 3 capability boundaries are approved/);
  assert.deepEqual(JSON.parse(run("status", "--root", sandbox, "--json").stdout).expedition.synthesis, { current: true, staged_capabilities: 3, approved_capabilities: 1 });
  assert.equal(readFileSync(canonicalPath, "utf8"), canonical);

  // A draft change after staging needs a new stage. Staging keeps each approval
  // whose boundary is unchanged and drops the others.
  editDraft(started.draft_path, (draft) => {
    draft.capabilities.find((item) => item.id === "cap-fixture-root").purpose = "Own the workspace build.";
  });
  const changed = run("expedition", "approve", "E-0001", "--all", "--root", sandbox);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /changed after staging/);
  assert.deepEqual(expeditionJson("stage", "E-0001").approvals_dropped, []);
  editDraft(started.draft_path, (draft) => {
    draft.capabilities.find((item) => item.id === "cap-apps-web").purpose = "Serve the web app.";
  });
  assert.deepEqual(expeditionJson("stage", "E-0001").approvals_dropped, ["cap-apps-web"]);
  for (const args of [["--all", "--capability", "cap-apps-web"], []]) {
    const invalid = run("expedition", "approve", "E-0001", ...args, "--root", sandbox);
    assert.equal(invalid.status, 1);
  }
  const unknown = run("expedition", "approve", "E-0001", "--capability", "cap-missing", "--root", sandbox);
  assert.match(unknown.stderr, /Not in the staged draft Map: cap-missing/);

  const approved = expeditionJson("approve", "E-0001", "--all");
  assert.equal(approved.outcome, "Every capability boundary approved");
  assert.equal(approved.expedition.status, "approved");
  assert.match(approved.expedition.next[0], /navigator regenerate all/);
  assert.equal(readFileSync(canonicalPath, "utf8"), canonical);

  const published = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(published.status, 0, published.stderr);
  const map = readMap();
  assert.ok(map.capabilities.every((item) => item.approved === true && item.provenance === "human-approved"));
  assert.equal(map.capabilities.find((item) => item.id === "cap-apps-web").purpose, "Serve the web app.");
  assert.equal(expeditionJson("status").status, "published");
  const closed = run("expedition", "stage", "E-0001", "--root", sandbox);
  assert.equal(closed.status, 1);
  assert.match(closed.stderr, /E-0001 is published; it has no open synthesis/);
});

test("a staged change to findings needs a new approval before publication", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const expedition = approveExpeditionMap(sandbox, run);
  const draftPath = `${expedition.draft_root}/synthesis/map.json`;
  editDraft(draftPath, (draft) => {
    draft.anomalies.push({ id: "anomaly-late", kind: "misplaced-shared-code", severity: "minor", detail: "Added after approval.", paths: ["apps/web/src/index.ts"], evidence: [], confidence: 0.6 });
  });
  const restaged = expeditionJson("stage", "E-0001");
  // Every boundary is unchanged, so each keeps its approval, but the draft as a whole was not approved.
  assert.deepEqual(restaged.approvals_dropped, []);
  assert.equal(restaged.expedition.status, "awaiting-approval");
  assert.match(restaged.expedition.next[0], /3 of 3 capability boundaries are approved/);
  const refused = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /E-0001 is awaiting-approval/);

  assert.equal(expeditionJson("approve", "E-0001", "--all").expedition.status, "approved");
  assert.equal(run("navigator", "regenerate", "all", "--root", sandbox).status, 0);
  assert.ok(readMap().anomalies.some((item) => item.id === "anomaly-late"));
});

test("a survey that writes repository files is rejected", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const reports = surveyReports(sandbox);
  const store = (role) => {
    const path = `.charthouse/drafts/E-0001/surveys/${role}.json`;
    writeFileSync(join(sandbox, path), `${JSON.stringify(reports[role], null, 2)}\n`);
    return path;
  };
  const accept = (role, token = null) => run("expedition", "accept-report", "E-0001", "--role", role, "--file", store(role), ...(token ? ["--window", token] : []), "--root", sandbox, "--json");
  const start = (role) => expeditionJson("start-survey", "E-0001", "--role", role).window_token;

  const unstarted = accept("structure");
  assert.equal(unstarted.status, 1);
  assert.match(unstarted.stderr, /Run `charthouse expedition start-survey E-0001 --role structure`/);

  let token = start("structure");
  assert.match(token, /^[0-9a-f]{32}$/);
  const tokenless = accept("structure");
  assert.equal(tokenless.status, 1);
  assert.match(tokenless.stderr, /--window/);
  // The mapper edits a product file, for example with a formatter or an install.
  const source = join(sandbox, "packages/auth/src/token.ts");
  const original = readFileSync(source, "utf8");
  writeFileSync(source, `${original}// written by a survey\n`);
  const written = accept("structure", token);
  assert.equal(written.status, 1);
  const rejection = JSON.parse(written.stdout);
  assert.equal(rejection.accepted, false);
  const finding = rejection.validation.errors.find((error) => error.code === "repository-written");
  assert.match(finding.message, /changed while the structure survey ran: packages\/auth\/src\/token\.ts/);
  // A rejection closes the window, so the survey must run again.
  assert.match(accept("structure", token).stderr, /start-survey E-0001 --role structure/);

  writeFileSync(source, original);
  token = start("structure");
  assert.equal(JSON.parse(accept("structure", token).stdout).accepted, true);
  // Re-accepting the unchanged report needs no new window.
  assert.equal(JSON.parse(accept("structure").stdout).accepted, true);

  // Charthouse state is not a product file, so its own writes do not count.
  token = start("capability");
  writeFileSync(join(sandbox, "docs/charthouse/notes.md"), "Charthouse-managed.\n");
  assert.equal(JSON.parse(accept("capability", token).stdout).accepted, true);

  // A commit during the survey moves HEAD.
  token = start("documentation");
  assert.equal(git("-c", "user.name=Charthouse Test", "-c", "user.email=charthouse@test.local", "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "survey commit").status, 0);
  const moved = JSON.parse(accept("documentation", token).stdout);
  assert.match(moved.validation.errors.find((error) => error.code === "repository-written").message, /HEAD/);
});

test("a survey cannot reset its own window to hide a write", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const report = ".charthouse/drafts/E-0001/surveys/structure.json";
  const token = expeditionJson("start-survey", "E-0001", "--role", "structure").window_token;
  // The mapper writes a file, then opens a new window itself.
  writeFileSync(join(sandbox, "packages/auth/src/token.ts"), "export const token = 'tampered';\n");
  expeditionJson("start-survey", "E-0001", "--role", "structure");
  writeFileSync(join(sandbox, report), `${JSON.stringify(surveyReports(sandbox).structure, null, 2)}\n`);
  const result = JSON.parse(run("expedition", "accept-report", "E-0001", "--role", "structure", "--file", report, "--window", token, "--root", sandbox, "--json").stdout);
  assert.equal(result.accepted, false);
  assert.ok(result.validation.errors.some((error) => error.code === "window-changed"));
});

test("a survey window detects edits to large and already changed files", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const large = join(sandbox, "packages/auth/src/data.bin");
  writeFileSync(large, Buffer.alloc(3 * 1024 * 1024, 1));
  assert.equal(run("reconcile", "--root", sandbox).status, 0);
  const report = ".charthouse/drafts/E-0001/surveys/structure.json";
  const token = expeditionJson("start-survey", "E-0001", "--role", "structure").window_token;
  // Same size and the same modification time, new content.
  const { atime, mtime } = statSync(large);
  writeFileSync(large, Buffer.alloc(3 * 1024 * 1024, 2));
  utimesSync(large, atime, mtime);
  writeFileSync(join(sandbox, report), `${JSON.stringify(surveyReports(sandbox).structure, null, 2)}\n`);
  const result = JSON.parse(run("expedition", "accept-report", "E-0001", "--role", "structure", "--file", report, "--window", token, "--root", sandbox, "--json").stdout);
  assert.match(result.validation.errors.find((error) => error.code === "repository-written").message, /packages\/auth\/src\/data\.bin/);
});

test("re-accepting an unchanged report closes an open window", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const expedition = acceptAllSurveys(sandbox, run);
  const token = expeditionJson("start-survey", "E-0001", "--role", "capability").window_token;
  const again = expeditionJson("accept-report", "E-0001", "--role", "capability", "--file", expedition.surveys.capability.report_path, "--window", token);
  assert.equal(again.accepted, true);
  assert.deepEqual(again.expedition.running_roles, []);
  assert.equal(expeditionJson("synthesize", "E-0001").outcome, "Synthesis started");
});

test("synthesis waits while a survey window is open", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  acceptAllSurveys(sandbox, run);
  expeditionJson("start-survey", "E-0001", "--role", "capability");
  const refused = run("expedition", "synthesize", "E-0001", "--root", sandbox);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /The capability survey is running/);
  const pending = expeditionJson("resume", "E-0001");
  assert.deepEqual(pending.running_roles, ["capability"]);
});

test("accepted surveys stay valid when an edit and a reconcile change only file contents", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const expedition = acceptAllSurveys(sandbox, run);
  const source = join(sandbox, "packages/auth/src/token.ts");
  writeFileSync(source, `${readFileSync(source, "utf8")}export const edited = true;\n`);
  // The edit is pending until the Stop hook reconciles. Synthesis waits for it.
  assert.deepEqual(expeditionJson("resume", "E-0001").next_roles, []);
  const pending = run("expedition", "synthesize", "E-0001", "--root", sandbox);
  assert.equal(pending.status, 1);
  assert.match(pending.stderr, /charthouse reconcile/);
  const before = readMap().generated_at;
  assert.equal(JSON.parse(run("reconcile", "--root", sandbox, "--json").stdout).updated, true);
  assert.notEqual(readMap().generated_at, before);

  const resumed = expeditionJson("resume", "E-0001");
  assert.equal(resumed.status, "ready-for-synthesis");
  assert.deepEqual(resumed.next_roles, []);
  // Re-accepting an unchanged report stays idempotent.
  const report = expedition.surveys.structure.report_path;
  assert.equal(expeditionJson("accept-report", "E-0001", "--role", "structure", "--file", report).accepted, true);
  assert.equal(expeditionJson("synthesize", "E-0001").outcome, "Synthesis started");
});

test("a structural change or a new scan policy still makes accepted surveys stale", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  acceptAllSurveys(sandbox, run);
  mkdirSync(join(sandbox, "packages/new"), { recursive: true });
  writeFileSync(join(sandbox, "packages/new/package.json"), `${JSON.stringify({ name: "new", version: "1.0.0" })}\n`);
  assert.equal(run("map", "update", "--root", sandbox).status, 0);
  const structural = expeditionJson("resume", "E-0001");
  assert.equal(structural.status, "surveying");
  for (const role of ["structure", "capability"]) {
    assert.ok(structural.next_roles.includes(role), role);
    assert.ok(structural.surveys[role].current_errors.some((error) => error.code === "coverage-missing"), role);
  }

  acceptAllSurveys(sandbox, run);
  assert.deepEqual(expeditionJson("resume", "E-0001").next_roles, []);
  editConfig((config) => config.scan.gitignored.exclude.push("docs/private/**"));
  assert.equal(run("map", "update", "--root", sandbox).status, 0);
  const policy = expeditionJson("resume", "E-0001");
  assert.deepEqual(policy.next_roles, ["structure", "capability", "documentation", "duplication"]);
  assert.ok(policy.surveys.documentation.current_errors.some((error) => error.code === "stale-config"));
});

test("a content-only Map update after synthesis keeps the Expedition publishable", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  approveExpeditionMap(sandbox, run);
  const before = readMap().generated_at;
  const source = join(sandbox, "packages/auth/src/token.ts");
  writeFileSync(source, `${readFileSync(source, "utf8")}export const edited = true;\n`);
  assert.equal(run("map", "update", "--root", sandbox).status, 0);
  assert.notEqual(readMap().generated_at, before);

  const resumed = expeditionJson("resume", "E-0001");
  assert.equal(resumed.status, "approved");
  assert.equal(resumed.synthesis.current, true);
  assert.deepEqual(resumed.next_roles, []);
  assert.match(resumed.next[0], /navigator regenerate all/);
  const published = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(published.status, 0, published.stderr);
  assert.equal(expeditionJson("status").status, "published");
});

test("a structural change after synthesis needs a new synthesis before publication", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  approveExpeditionMap(sandbox, run);
  mkdirSync(join(sandbox, "packages/new"), { recursive: true });
  writeFileSync(join(sandbox, "packages/new/package.json"), `${JSON.stringify({ name: "new", version: "1.0.0" })}\n`);
  writeFileSync(join(sandbox, "packages/new/index.js"), "export const added = true;\n");
  assert.equal(run("map", "update", "--root", sandbox).status, 0);

  const resumed = expeditionJson("resume", "E-0001");
  assert.equal(resumed.synthesis.current, false);
  assert.deepEqual(resumed.synthesis.changed_inputs, ["Map units or capability boundaries"]);
  assert.match(resumed.next.at(-1), /expedition synthesize E-0001 --restart/);
  for (const args of [["navigator", "regenerate", "all"], ["expedition", "stage", "E-0001"]]) {
    const refused = run(...args, "--root", sandbox);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /synthesis inputs of E-0001 changed: Map units or capability boundaries/);
  }
  // The new unit changed the deterministic Map, so the reports must cover it.
  const restart = run("expedition", "synthesize", "E-0001", "--restart", "--root", sandbox);
  assert.equal(restart.status, 1);
  assert.match(restart.stderr, /valid for the current Map/);

  approveExpeditionMap(sandbox, run);
  const published = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(published.status, 0, published.stderr);
  assert.ok(readMap().capabilities.some((item) => item.id === "cap-packages-new" && item.approved === true));
});

test("a synthesis restart keeps the earlier draft for reuse", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  acceptAllSurveys(sandbox, run);
  const { draft_path: draftPath } = expeditionJson("synthesize", "E-0001");
  editDraft(draftPath, (draft) => { draft.capabilities[0].purpose = "Kept from the first draft."; });
  const restarted = expeditionJson("synthesize", "E-0001", "--restart");
  assert.equal(restarted.outcome, "Synthesis restarted");
  const previous = JSON.parse(readFileSync(join(sandbox, ".charthouse/drafts/E-0001/synthesis/previous-map.json"), "utf8"));
  assert.equal(previous.capabilities[0].purpose, "Kept from the first draft.");
  assert.deepEqual(JSON.parse(readFileSync(join(sandbox, draftPath), "utf8")), readMap());
});

function blockPublishedFile(path) {
  // A folder where a generated file must go makes the write fail midway.
  mkdirSync(join(sandbox, path, "obstacle"), { recursive: true });
  writeFileSync(join(sandbox, path, "obstacle/keep.txt"), "keep\n");
}

test("an interrupted publication finishes on the next writer without new approval", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  approveExpeditionMap(sandbox, run);
  const canonical = readFileSync(join(sandbox, ".charthouse/map.json"), "utf8");
  const blocked = ".claude/rules/charthouse/packages-auth.md";
  blockPublishedFile(blocked);

  const failed = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Publication of E-0001 stopped/);
  assert.match(failed.stderr, /navigator regenerate all/);
  // Some views were written, but the Map is written last and is unchanged.
  assert.ok(existsSync(join(sandbox, "docs/charthouse/navigators/apps-web.md")));
  assert.equal(readFileSync(join(sandbox, ".charthouse/map.json"), "utf8"), canonical);
  const pending = expeditionJson("resume", "E-0001");
  assert.equal(pending.status, "publishing");
  assert.match(pending.next[0], /Publication of E-0001 was interrupted/);
  for (const args of [["stage", "E-0001"], ["synthesize", "E-0001", "--restart"], ["approve", "E-0001", "--all"]]) {
    const refused = run("expedition", ...args, "--root", sandbox);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /E-0001 is publishing/);
  }

  rmSync(join(sandbox, blocked), { recursive: true, force: true });
  const reconciled = run("reconcile", "--root", sandbox, "--json");
  assert.equal(reconciled.status, 0, reconciled.stderr);
  const record = JSON.parse(readFileSync(join(sandbox, ".charthouse/expeditions/E-0001.json"), "utf8"));
  assert.equal(record.status, "published");
  assert.equal(record.publication.completed_at !== null, true);
  assert.ok(record.publication.written > 0);
  assert.ok(existsSync(join(sandbox, ".charthouse/drafts/E-0001/publication/receipt.json")));
  assert.ok(existsSync(join(sandbox, blocked)));
  assert.ok(readMap().capabilities.every((item) => item.approved === true));
});

test("the edit hook finishes a pending publication before it queues a path", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  approveExpeditionMap(sandbox, run);
  const blocked = ".claude/rules/charthouse/packages-auth.md";
  blockPublishedFile(blocked);
  assert.equal(run("navigator", "regenerate", "all", "--root", sandbox).status, 1);
  const target = join(sandbox, "packages/auth/src/token.ts");
  const edited = () => spawnSync(process.execPath, [bin, "hook", "changed", "--root", sandbox], {
    cwd: sandbox,
    encoding: "utf8",
    input: JSON.stringify({ tool_input: { file_path: target } })
  });

  // While the publication cannot finish, the hook reports it and queues nothing
  // that the recovery would overwrite.
  const stuck = edited();
  assert.equal(stuck.status, 1);
  assert.match(stuck.stderr, /Publication of E-0001 stopped/);

  rmSync(join(sandbox, blocked), { recursive: true, force: true });
  const queued = edited();
  assert.equal(queued.status, 0, queued.stderr);
  assert.equal(expeditionJson("status").status, "published");
  const queue = JSON.parse(readFileSync(join(sandbox, ".charthouse/changed-paths.json"), "utf8"));
  assert.deepEqual(queue.paths, ["packages/auth/src/token.ts"]);
});

test("recovery refuses a staged publication file that changed", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  approveExpeditionMap(sandbox, run);
  const blocked = ".claude/rules/charthouse/packages-auth.md";
  blockPublishedFile(blocked);
  assert.equal(run("navigator", "regenerate", "all", "--root", sandbox).status, 1);
  const staged = join(sandbox, ".charthouse/drafts/E-0001/publication/staged/.charthouse/map.json");
  writeFileSync(staged, readFileSync(staged, "utf8").replace("human-approved", "semantic"));
  rmSync(join(sandbox, blocked), { recursive: true, force: true });
  const refused = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /staged publication file changed: .*staged\/\.charthouse\/map\.json/);
  assert.equal(expeditionJson("status").status, "publishing");
});

test("publication refuses to replace the Map with a partial rescan", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  approveExpeditionMap(sandbox, run);
  const canonical = readFileSync(join(sandbox, ".charthouse/map.json"), "utf8");
  for (const path of ["README.md", "packages/auth/src/token.ts", "apps/web/src/index.ts", "apps/web/src/index.test.ts", "apps/web/fixtures/account.json"]) {
    rmSync(join(sandbox, path));
  }
  const fewer = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(fewer.status, 1);
  assert.match(fewer.stderr, /fewer than half of the 8 files/);
  assert.match(fewer.stderr, /expedition synthesize E-0001 --restart/);
  assert.equal(git("checkout", "--", ".").status, 0);

  rmSync(join(sandbox, "packages/auth"), { recursive: true });
  const lost = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(lost.status, 1);
  assert.match(lost.stderr, /lost a unit that the approved Map describes: unit-packages-auth/);
  assert.equal(readFileSync(join(sandbox, ".charthouse/map.json"), "utf8"), canonical);
  assert.equal(expeditionJson("status").status, "approved");
});

test("publication copies the approved draft documents", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const synthesis = ".charthouse/drafts/E-0001/synthesis";
  approveExpeditionMap(sandbox, run, () => {
    writeFileSync(join(sandbox, synthesis, "documentation-map.md"), "# Documentation map\n\nREADME.md is the entry point.\n");
    writeFileSync(join(sandbox, synthesis, "anomalies.md"), "# Anomalies\n\nNone found.\n");
  });
  writeFileSync(join(sandbox, synthesis, "anomalies.md"), "# Anomalies\n\nChanged after approval.\n");
  const changed = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /changed after staging/);
  writeFileSync(join(sandbox, synthesis, "anomalies.md"), "# Anomalies\n\nNone found.\n");

  const published = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(published.status, 0, published.stderr);
  assert.equal(readFileSync(join(sandbox, "docs/charthouse/documentation-map.md"), "utf8"), "# Documentation map\n\nREADME.md is the entry point.\n");
  assert.equal(readFileSync(join(sandbox, "docs/charthouse/anomalies.md"), "utf8"), "# Anomalies\n\nNone found.\n");
});

test("staging refuses a draft Map that changes units or breaks a capability", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  acceptAllSurveys(sandbox, run);
  const { draft_path: draftPath } = expeditionJson("synthesize", "E-0001");
  const pristine = readFileSync(join(sandbox, draftPath), "utf8");
  const cases = [
    [(draft) => draft.units.push({ id: "unit-invented", name: "invented", root: "invented", kind: "node", scope: "included" }), /must not add or remove repository units/],
    [(draft) => { delete draft.capabilities[0].confidence; }, /capabilities\[0\]\.confidence must be a number from 0 to 1/],
    [(draft) => draft.capabilities.push({ ...draft.capabilities[0] }), /is a duplicate/],
    [(draft) => { draft.capabilities[1].primary_paths = []; }, /capabilities\[1\]\.primary_paths must be a non-empty array/]
  ];
  for (const [change, message] of cases) {
    writeFileSync(join(sandbox, draftPath), pristine);
    editDraft(draftPath, change);
    const refused = run("expedition", "stage", "E-0001", "--root", sandbox);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, message);
  }
  writeFileSync(join(sandbox, draftPath), "{ not json");
  assert.match(run("expedition", "stage", "E-0001", "--root", sandbox).stderr, /not valid JSON/);
  assert.equal(expeditionJson("status").status, "synthesizing");
});

test("a changed survey report discards a started synthesis", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const expedition = approveExpeditionMap(sandbox, run);
  const reportPath = expedition.surveys.duplication.report_path;
  const report = join(sandbox, reportPath);
  writeFileSync(report, readFileSync(report, "utf8").replace("are reviewed", "were edited after acceptance"));
  const resumed = expeditionJson("resume", "E-0001");
  assert.equal(resumed.synthesis.current, false);
  assert.deepEqual(resumed.synthesis.changed_inputs, ["duplication report"]);
  assert.deepEqual(resumed.next_roles, ["duplication"]);

  const token = expeditionJson("start-survey", "E-0001", "--role", "duplication").window_token;
  const accepted = expeditionJson("accept-report", "E-0001", "--role", "duplication", "--file", reportPath, "--window", token);
  assert.equal(accepted.expedition.status, "ready-for-synthesis");
  assert.equal(accepted.expedition.synthesis, null);
  const record = JSON.parse(readFileSync(join(sandbox, ".charthouse/expeditions/E-0001.json"), "utf8"));
  assert.equal(record.events.at(-1).type, "synthesis-discarded");
});

test("ambiguous vendor and build directories are scanned by default", () => {
  mkdirSync(join(sandbox, "apps/web/src/vendor"), { recursive: true });
  mkdirSync(join(sandbox, "bin/build"), { recursive: true });
  writeFileSync(join(sandbox, "apps/web/src/vendor/portal.ts"), "export const portal = true;\n");
  writeFileSync(join(sandbox, "bin/build/release.sh"), "#!/bin/sh\nexit 0\n");

  const result = run("init", "--root", sandbox);
  assert.equal(result.status, 0, result.stderr);
  const map = readMap();
  assert.ok(map.files.some((file) => file.path === "apps/web/src/vendor/portal.ts"));
  assert.ok(map.files.some((file) => file.path === "bin/build/release.sh"));
  assert.equal(map.perimeter_regions.some((region) => ["apps/web/src/vendor", "bin/build"].includes(region.path)), false);
});

test("init warns about oversized agent instruction files before semantic surveys", () => {
  writeFileSync(join(sandbox, "AGENTS.md"), "A".repeat(150_001));

  const result = run("init", "--root", sandbox, "--json");
  assert.equal(result.status, 0, result.stderr);
  const initialized = JSON.parse(result.stdout);
  assert.deepEqual(initialized.instruction_file_warnings.map((warning) => warning.path), ["AGENTS.md"]);
  assert.equal(initialized.instruction_file_warnings[0].warning_threshold_bytes, 150_000);
  assert.ok(initialized.next.some((item) => item.includes("oversized agent instruction files")));

  const map = readMap();
  assert.equal(map.scan_summary.instruction_file_warnings, 1);
  assert.equal(map.instruction_file_warnings[0].size_bytes, 150_001);
  assert.match(readFileSync(join(sandbox, "docs/charthouse/map.md"), "utf8"), /Instruction context warnings/);

  const check = run("check", "--root", sandbox, "--json");
  assert.equal(check.status, 0, check.stderr);
  assert.ok(JSON.parse(check.stdout).findings.some((finding) => finding.code === "instruction-file-oversized" && finding.path === "AGENTS.md"));
});

test("instruction contracts are scoped, inherited, monitored, and included in task briefs", () => {
  mkdirSync(join(sandbox, ".github"), { recursive: true });
  mkdirSync(join(sandbox, ".cursor/rules"), { recursive: true });
  writeFileSync(join(sandbox, "AGENTS.md"), "Use the repository rules.\n");
  writeFileSync(join(sandbox, "apps/web/AGENTS.md"), "Use the repository rules.\n");
  writeFileSync(join(sandbox, "CLAUDE.md"), "Claude repository guidance.\n");
  writeFileSync(join(sandbox, "GEMINI.md"), "Gemini repository guidance.\n");
  writeFileSync(join(sandbox, ".cursorrules"), "Cursor repository guidance.\n");
  writeFileSync(join(sandbox, ".cursor/rules/frontend.mdc"), "Frontend cursor guidance.\n");
  writeFileSync(join(sandbox, ".github/copilot-instructions.md"), "Copilot repository guidance.\n");

  const initialized = run("init", "--root", sandbox, "--json");
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(JSON.parse(initialized.stdout).instruction_contracts.length, 7);
  const map = readMap();
  assert.equal(map.scan_summary.instruction_contracts, 7);
  assert.deepEqual(map.instruction_contracts.map((item) => item.path), [
    ".cursor/rules/frontend.mdc",
    ".cursorrules",
    ".github/copilot-instructions.md",
    "AGENTS.md",
    "apps/web/AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md"
  ]);
  const rootAgents = map.instruction_contracts.find((item) => item.path === "AGENTS.md");
  const webAgents = map.instruction_contracts.find((item) => item.path === "apps/web/AGENTS.md");
  assert.equal(rootAgents.scope, ".");
  assert.equal(webAgents.scope, "apps/web");
  assert.equal(webAgents.parent, rootAgents.id);
  assert.deepEqual(rootAgents.providers, ["codex"]);
  assert.equal(map.instruction_contracts.find((item) => item.path === ".cursor/rules/frontend.mdc").scope, ".");
  assert.deepEqual(map.instruction_duplicate_groups.map((item) => item.paths), [["AGENTS.md", "apps/web/AGENTS.md"]]);
  const status = JSON.parse(run("status", "--root", sandbox, "--json").stdout);
  assert.equal(status.instructions.total, 7);
  assert.deepEqual(status.instructions.providers, ["claude", "codex", "cursor", "gemini", "github-copilot"]);
  assert.equal(JSON.parse(run("doctor", "--root", sandbox, "--json").stdout).instructions.total, 7);

  const manifest = JSON.parse(readFileSync(join(sandbox, ".charthouse/manifest.json"), "utf8"));
  for (const contract of map.instruction_contracts) {
    assert.equal(manifest.documents[contract.id].kind, "instruction-contract");
    assert.equal(manifest.documents[contract.id].criticality, "binding");
    assert.deepEqual(manifest.documents[contract.id].watches, [contract.path]);
    assert.equal(manifest.documents[contract.id].ownership, "human");
  }

  const authBrief = JSON.parse(run("brief", "change auth token handling", "--root", sandbox, "--json").stdout);
  assert.ok(authBrief.instruction_contracts.some((item) => item.path === "AGENTS.md"));
  assert.equal(authBrief.instruction_contracts.some((item) => item.path === "apps/web/AGENTS.md"), false);
  const webBrief = JSON.parse(run("brief", "change web application", "--root", sandbox, "--json").stdout);
  assert.ok(webBrief.instruction_contracts.some((item) => item.path === "apps/web/AGENTS.md"));

  const clean = JSON.parse(run("check", "--root", sandbox, "--json").stdout);
  assert.ok(clean.findings.some((item) => item.code === "instruction-contract-duplicate"));
  assert.equal(clean.errors, 0);
  writeFileSync(join(sandbox, "apps/web/AGENTS.md"), "Changed web guidance.\n");
  const changed = run("check", "--root", sandbox, "--json");
  assert.equal(changed.status, 1);
  assert.ok(JSON.parse(changed.stdout).findings.some((item) => item.code === "document-suspect" && item.path === "apps/web/AGENTS.md" && item.level === "error"));
  const review = JSON.parse(run("docs", "review", "--root", sandbox, "--json").stdout);
  const instructionPacket = review.documents.find((item) => item.path === "apps/web/AGENTS.md");
  assert.equal(instructionPacket.kind, "instruction-contract");
  assert.equal(instructionPacket.ownership, "human");
  assert.equal(instructionPacket.scope, "apps/web");
  assert.equal(instructionPacket.parent, rootAgents.id);

  rmSync(join(sandbox, "apps/web/AGENTS.md"));
  assert.equal(run("reconcile", "--force", "--root", sandbox).status, 0);
  const missing = run("check", "--root", sandbox, "--json");
  assert.equal(missing.status, 1);
  assert.ok(JSON.parse(missing.stdout).findings.some((item) => item.code === "document-missing" && item.path === "apps/web/AGENTS.md" && item.level === "error"));
});

test("instruction contract patterns are configurable and legacy configs use defaults", () => {
  mkdirSync(join(sandbox, ".charthouse"));
  cpSync(join(packageRoot, "templates/config.json"), join(sandbox, ".charthouse/config.json"));
  editConfig((config) => { delete config.scan.instructions; });
  writeFileSync(join(sandbox, "AGENTS.md"), "Default contract.\n");
  assert.equal(run("init", "--root", sandbox).status, 0);
  assert.deepEqual(readMap().instruction_contracts.map((item) => item.path), ["AGENTS.md"]);

  writeFileSync(join(sandbox, "TEAM_RULES.md"), "Custom contract.\n");
  editConfig((config) => {
    config.scan.instructions = { patterns: ["TEAM_RULES.md"], size_warning_bytes: 2048 };
  });
  assert.equal(run("map", "update", "--root", sandbox).status, 0);
  const contracts = readMap().instruction_contracts;
  assert.deepEqual(contracts.map((item) => item.path), ["TEAM_RULES.md"]);
  assert.equal(contracts[0].kind, "custom");
  assert.equal(contracts[0].warning_threshold_bytes, 2048);
  const manifest = JSON.parse(readFileSync(join(sandbox, ".charthouse/manifest.json"), "utf8"));
  assert.equal(Object.values(manifest.documents).some((item) => item.kind === "instruction-contract" && item.path === "AGENTS.md"), false);
});

test("status separates Map publication from Bearing health", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const draft = JSON.parse(run("status", "--root", sandbox, "--json").stdout);
  assert.deepEqual(draft.publication, { map: "draft", bearing: "healthy", state: "draft" });
  assert.equal(draft.expedition.id, "E-0001");
  assert.equal(draft.expedition.status, "surveying");
  assert.deepEqual(draft.expedition.next_roles, ["structure", "capability", "documentation", "duplication"]);

  const mapPath = join(sandbox, ".charthouse/map.json");
  const map = readMap();
  for (const capability of map.capabilities) capability.approved = true;
  writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);

  const manifestPath = join(sandbox, ".charthouse/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.documents["doc-charter"].status = "stale";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const status = JSON.parse(run("status", "--root", sandbox, "--json").stdout);
  assert.deepEqual(status.publication, { map: "published", bearing: "blocked", state: "published_with_findings" });
  const check = run("check", "--root", sandbox);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /Map publication: published_with_findings/);
  assert.match(check.stdout, /Bearing check: FAIL/);
});

test("Toolbox runs bounded repository analysis without generated scripts", () => {
  const duplicate = join(sandbox, "packages/auth/src/token-copy.ts");
  writeFileSync(duplicate, readFileSync(join(sandbox, "packages/auth/src/token.ts")));
  assert.equal(run("init", "--root", sandbox).status, 0);

  const filesResult = run("tool", "run", "repository-files", "--path", "apps/web/src", "--role", "source", "--limit", "1", "--root", sandbox, "--json");
  assert.equal(filesResult.status, 0, filesResult.stderr);
  const files = JSON.parse(filesResult.stdout);
  assert.equal(files.tool, "repository-files");
  assert.equal(files.result.returned, 1);
  assert.ok(files.result.files.every((file) => file.path.startsWith("apps/web/src/") && file.role === "source"));
  assert.equal(run("tool", "run", "repository-files", "--path=", "--root", sandbox).status, 1);

  const graphResult = run("tool", "run", "dependency-graph", "--unit", "web", "--root", sandbox, "--json");
  assert.equal(graphResult.status, 0, graphResult.stderr);
  const graph = JSON.parse(graphResult.stdout).result;
  assert.ok(graph.units.some((unit) => unit.name === "@fixture/web"));
  assert.ok(graph.units.some((unit) => unit.name === "@fixture/auth"));
  assert.equal(graph.dependencies.length, 1);

  const boundedGraphResult = run("tool", "run", "dependency-graph", "--unit", "web", "--limit", "1", "--root", sandbox, "--json");
  assert.equal(boundedGraphResult.status, 0, boundedGraphResult.stderr);
  const boundedGraph = JSON.parse(boundedGraphResult.stdout).result;
  assert.equal(boundedGraph.units[0].name, "@fixture/web");
  assert.equal(boundedGraph.truncated, true);

  const documentsResult = run("tool", "run", "documentation-index", "--status", "all", "--root", sandbox, "--json");
  assert.equal(documentsResult.status, 0, documentsResult.stderr);
  assert.ok(JSON.parse(documentsResult.stdout).result.documents.some((document) => document.id === "doc-map"));
  assert.equal(run("tool", "run", "documentation-index", "--status", "historical", "--root", sandbox, "--json").status, 0);

  const duplicatesResult = run("tool", "run", "duplicate-analysis", "--path", "packages/auth/**", "--root", sandbox, "--json");
  assert.equal(duplicatesResult.status, 0, duplicatesResult.stderr);
  assert.ok(JSON.parse(duplicatesResult.stdout).result.groups.some((group) => group.paths.includes("packages/auth/src/token-copy.ts")));
});

test("survey reports are role-specific, baseline-bound, and validated before synthesis", () => {
  writeFileSync(join(sandbox, "AGENTS.md"), "Use repository evidence.\n");
  const init = run("init", "--root", sandbox, "--json");
  assert.equal(init.status, 0, init.stderr);
  const expedition = JSON.parse(init.stdout).expedition;
  const map = readMap();
  const fingerprints = JSON.parse(readFileSync(join(sandbox, ".charthouse/fingerprints.json"), "utf8"));
  const reportPath = expedition.surveys.capability.report_path;
  const report = {
    schema_version: 1,
    role: "capability",
    baseline: {
      commit: map.baseline.commit,
      config_digest: fingerprints.config_digest,
      map_generated_at: map.generated_at
    },
    summary: "Each deterministic unit has one draft capability.",
    findings: [],
    unresolved: [],
    tool_gaps: [],
    capabilities: map.units.map((unit) => ({
      id: `cap-${unit.id.replace(/^unit-/, "")}`,
      name: `${unit.name} capability`,
      purpose: `Own ${unit.name}.`,
      units: [unit.id],
      primary_paths: [unit.root === "." ? "**" : `${unit.root}/**`],
      secondary_paths: [],
      evidence: [unit.manifest || unit.root],
      confidence: 0.8
    }))
  };
  const absolute = join(sandbox, reportPath);
  const wrongPath = run("expedition", "accept-report", expedition.id, "--role", "capability", "--file", ".charthouse/drafts/capability.json", "--root", sandbox, "--json");
  assert.equal(wrongPath.status, 1);
  assert.match(wrongPath.stderr, /isolated path/);
  const symlinkTarget = `${reportPath}.target`;
  writeFileSync(join(sandbox, symlinkTarget), `${JSON.stringify(report, null, 2)}\n`);
  symlinkSync(join(sandbox, symlinkTarget), absolute);
  let token = JSON.parse(run("expedition", "start-survey", expedition.id, "--role", "capability", "--root", sandbox, "--json").stdout).window_token;
  const symbolic = run("expedition", "accept-report", expedition.id, "--role", "capability", "--file", reportPath, "--window", token, "--root", sandbox, "--json");
  assert.equal(symbolic.status, 1);
  assert.ok(JSON.parse(symbolic.stdout).validation.errors.some((item) => item.code === "report-symlink"));
  rmSync(absolute);
  rmSync(join(sandbox, symlinkTarget));
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);

  const valid = run("tool", "run", "survey-report-validate", "--role", "capability", "--file", reportPath, "--root", sandbox, "--json");
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).result.valid, true);
  assert.equal(JSON.parse(valid.stdout).result.counts.capabilities, map.units.length);
  // The symbolic-link rejection closed the window, so the survey starts again.
  token = JSON.parse(run("expedition", "start-survey", expedition.id, "--role", "capability", "--root", sandbox, "--json").stdout).window_token;
  const accepted = run("expedition", "accept-report", expedition.id, "--role", "capability", "--file", reportPath, "--window", token, "--root", sandbox, "--json");
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).accepted, true);
  const repeated = run("expedition", "accept-report", expedition.id, "--role", "capability", "--file", reportPath, "--root", sandbox, "--json");
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(repeated.stdout).expedition.surveys.capability.attempts, 2);

  const common = (role, summary) => ({
    schema_version: 1,
    role,
    baseline: report.baseline,
    summary,
    findings: [],
    unresolved: [],
    tool_gaps: []
  });
  const roleReports = {
    structure: {
      ...common("structure", "The deterministic units have verified structure."),
      units: map.units.map((unit) => ({ id: unit.id, name: unit.name, root: unit.root, purpose: `Own ${unit.name}.`, evidence: [unit.manifest || unit.root], confidence: 0.9 })),
      dependencies: map.dependencies.map((edge) => ({ ...edge, confidence: 0.9 })),
      entrypoints: [],
      tests: []
    },
    documentation: {
      ...common("documentation", "Documents and Instruction Contracts are classified."),
      documents: map.documents
        .filter((document) => !(map.instruction_contracts || []).some((contract) => contract.path === document.path))
        .map((document, index) => ({ id: `document-${index + 1}`, path: document.path, classification: "current", criticality: "informational", claims: [], watches: [], evidence: [document.path], confidence: 0.8 })),
      instruction_contracts: (map.instruction_contracts || []).map((contract) => ({ id: contract.id, path: contract.path, providers: contract.providers, scope: contract.scope, parent: contract.parent, precedence: contract.precedence, evidence: [contract.path], confidence: 1 }))
    },
    duplication: {
      ...common("duplication", "Deterministic duplicate groups are reviewed."),
      duplicate_groups: (map.duplicate_groups || []).map((group) => ({ kind: "exact-duplicate", paths: group.paths, evidence: group.paths, confidence: 1 }))
    }
  };
  for (const [role, roleReport] of Object.entries(roleReports)) {
    const rolePath = expedition.surveys[role].report_path;
    writeFileSync(join(sandbox, rolePath), `${JSON.stringify(roleReport, null, 2)}\n`);
    const checked = run("tool", "run", "survey-report-validate", "--role", role, "--file", rolePath, "--root", sandbox, "--json");
    assert.equal(checked.status, 0, `${role}: ${checked.stdout}\n${checked.stderr}`);
    assert.equal(JSON.parse(checked.stdout).result.valid, true);
    const roleToken = JSON.parse(run("expedition", "start-survey", expedition.id, "--role", role, "--root", sandbox, "--json").stdout).window_token;
    const checkpoint = run("expedition", "accept-report", expedition.id, "--role", role, "--file", rolePath, "--window", roleToken, "--root", sandbox, "--json");
    assert.equal(checkpoint.status, 0, checkpoint.stderr);
    assert.equal(JSON.parse(checkpoint.stdout).accepted, true);
  }

  const resumed = JSON.parse(run("expedition", "resume", expedition.id, "--root", sandbox, "--json").stdout);
  assert.equal(resumed.status, "ready-for-synthesis");
  assert.deepEqual(resumed.reusable_roles, ["structure", "capability", "documentation", "duplication"]);
  assert.deepEqual(resumed.next_roles, []);

  report.capabilities[0].primary_paths = ["{apps,packages}/**"];
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);
  const unsupportedGlob = run("tool", "run", "survey-report-validate", "--role", "capability", "--file", reportPath, "--root", sandbox, "--json");
  assert.equal(unsupportedGlob.status, 1);
  assert.ok(JSON.parse(unsupportedGlob.stdout).result.errors.some((item) => item.code === "unsupported-glob"));
  token = JSON.parse(run("expedition", "start-survey", expedition.id, "--role", "capability", "--root", sandbox, "--json").stdout).window_token;
  const rejected = run("expedition", "accept-report", expedition.id, "--role", "capability", "--file", reportPath, "--window", token, "--root", sandbox, "--json");
  assert.equal(rejected.status, 1);
  assert.equal(JSON.parse(rejected.stdout).accepted, false);
  assert.equal(JSON.parse(rejected.stdout).expedition.surveys.capability.attempts, 3);
  const staleResume = JSON.parse(run("expedition", "resume", expedition.id, "--root", sandbox, "--json").stdout);
  assert.equal(staleResume.status, "surveying");
  assert.deepEqual(staleResume.next_roles, ["capability"]);
  assert.equal(staleResume.surveys.capability.reusable, false);

  report.capabilities[0].primary_paths = ["**"];
  report.capabilities[0].units = [];
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);
  const incomplete = run("tool", "run", "survey-report-validate", "--role", "capability", "--file", reportPath, "--root", sandbox, "--json");
  assert.equal(incomplete.status, 1);
  assert.ok(JSON.parse(incomplete.stdout).result.errors.some((item) => item.code === "coverage-missing"));

  report.capabilities[0].units = [map.units[0].id];
  report.role = "duplication";
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);
  const overwritten = run("tool", "run", "survey-report-validate", "--role", "capability", "--file", reportPath, "--root", sandbox, "--json");
  assert.equal(overwritten.status, 1);
  assert.ok(JSON.parse(overwritten.stdout).result.errors.some((item) => item.code === "role-mismatch"));

  writeFileSync(absolute, "{not json\n");
  const invalidJson = run("tool", "run", "survey-report-validate", "--role", "capability", "--file", reportPath, "--root", sandbox, "--json");
  assert.equal(invalidJson.status, 1);
  assert.ok(JSON.parse(invalidJson.stdout).result.errors.some((item) => item.code === "invalid-json"));

  report.role = "capability";
  report.capabilities[0].units = [map.units[0].id];
  writeFileSync(absolute, `${JSON.stringify(report, null, 2)}\n`);
  const changedSource = join(sandbox, "packages/auth/src/during-survey.ts");
  writeFileSync(changedSource, "export const changedDuringSurvey = true;\n");
  const changedRepository = run("tool", "run", "survey-report-validate", "--role", "capability", "--file", reportPath, "--root", sandbox, "--json");
  assert.equal(changedRepository.status, 1);
  assert.ok(JSON.parse(changedRepository.stdout).result.errors.some((item) => item.code === "repository-changed"));
  rmSync(changedSource);
});

test("the Map accounts for tracked safety exclusions without exposing secret-like paths", () => {
  writeFileSync(join(sandbox, ".env"), "SECRET=do-not-read\n");
  writeFileSync(join(sandbox, "debug.log"), "do not read this log\n");
  assert.equal(git("add", "-f", ".env", "debug.log").status, 0);
  assert.equal(git("-c", "user.name=Charthouse Test", "-c", "user.email=charthouse@test.local", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "track excluded files").status, 0);
  assert.equal(git("branch", "-f", "canonical", "HEAD").status, 0);

  const initialized = run("init", "--root", sandbox, "--json");
  assert.equal(initialized.status, 0, initialized.stderr);
  const map = readMap();
  assert.equal(map.scan_summary.hard_excluded_tracked_files, 2);
  assert.equal(map.scan_summary.hard_excluded_tracked_redacted, 1);
  assert.ok(map.scan_summary.omitted_files >= 2);
  assert.deepEqual(map.excluded_tracked_paths, [
    { path: "debug.log", pattern: "*.log", reason: "hard-safety" }
  ]);
  assert.equal(JSON.stringify(map).includes(".env"), false);
});

test("secret-like tracked names stay hidden under every broader safety exclusion", () => {
  const directories = [".claude", ".agents", "docs/charthouse", "node_modules", ".venv", "venv", "__pycache__"];
  for (const directory of directories) {
    mkdirSync(join(sandbox, directory, "vault.pem"), { recursive: true });
    writeFileSync(join(sandbox, directory, ".env.customer-private"), "FAKE_TEST_VALUE=1\n");
    writeFileSync(join(sandbox, directory, "id_rsa_customer"), "not a key\n");
    writeFileSync(join(sandbox, directory, "vault.pem", "notes.txt"), "a directory with a secret-like name\n");
    writeFileSync(join(sandbox, directory, "plain.txt"), "safe to list\n");
  }
  assert.equal(git("add", "-f", ...directories).status, 0);
  assert.equal(git("-c", "user.name=Charthouse Test", "-c", "user.email=charthouse@test.local", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "track excluded directories").status, 0);
  assert.equal(git("branch", "-f", "canonical", "HEAD").status, 0);

  const initialized = run("init", "--root", sandbox, "--json");
  assert.equal(initialized.status, 0, initialized.stderr);
  const map = readMap();
  assert.equal(map.scan_summary.hard_excluded_tracked_files, 28);
  assert.equal(map.scan_summary.hard_excluded_tracked_redacted, 21);
  assert.deepEqual(map.excluded_tracked_paths.map((item) => item.path).sort(), directories.map((directory) => `${directory}/plain.txt`).sort());
  for (const text of [JSON.stringify(map), readFileSync(join(sandbox, "docs/charthouse/map.md"), "utf8")]) {
    for (const secret of ["customer-private", "id_rsa", "vault.pem"]) assert.equal(text.includes(secret), false, secret);
  }
});

test("Expedition records must match the published schema", async () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const recordPath = join(sandbox, ".charthouse/expeditions/E-0001.json");
  const valid = JSON.parse(readFileSync(recordPath, "utf8"));
  const { validateExpedition } = await import(join(packageRoot, "scripts/lib/expedition-state.mjs"));
  assert.equal(validateExpedition(structuredClone(valid)).id, "E-0001");
  const digest = `sha256:${"0".repeat(64)}`;
  const synthesis = {
    started_at: valid.created_at,
    draft_path: `${valid.draft_root}/synthesis/map.json`,
    inputs: { commit: null, config_digest: digest, map_digest: digest, reports: { structure: digest, capability: digest, documentation: digest, duplication: digest } },
    staged: null,
    approvals: [],
    approved_digest: null
  };
  const malformed = {
    "an unknown top-level field": (record) => { record.extra = true; },
    "a missing baseline commit": (record) => { delete record.baseline.commit; },
    "a missing canonical commit": (record) => { delete record.baseline.canonical_commit; },
    "a numeric baseline commit": (record) => { record.baseline.commit = 42; },
    "an unknown baseline field": (record) => { record.baseline.branch = "main"; },
    "an unknown survey role": (record) => { record.surveys.security = structuredClone(record.surveys.structure); },
    "an unknown survey field": (record) => { record.surveys.structure.owner = "agent"; },
    "a missing report digest": (record) => { delete record.surveys.structure.report_digest; },
    "a numeric report digest": (record) => { record.surveys.structure.report_digest = 7; },
    "a malformed validation time": (record) => { record.surveys.structure.validated_at = "yesterday"; },
    "a malformed validation error": (record) => { record.surveys.structure.validation_errors = ["broken"]; },
    "a validation error with an unknown field": (record) => { record.surveys.structure.validation_errors = [{ code: "x", path: "y", message: "z", hint: "w" }]; },
    "a non-object event": (record) => { record.events = [42]; },
    "an event without a time": (record) => { delete record.events[0].at; },
    "an event with an unknown role": (record) => { record.events[0].role = "security"; },
    "an event with an unknown field": (record) => { record.events[0].actor = "agent"; },
    "a numeric event detail": (record) => { record.events[0].detail = 1; },
    "a synthesis record before synthesis": (record) => { record.synthesis = synthesis; },
    "a synthesizing status without synthesis": (record) => { record.status = "synthesizing"; },
    "an approval status without a staged draft": (record) => { Object.assign(record, { status: "approved", synthesis }); },
    "a synthesis draft outside the Expedition": (record) => { Object.assign(record, { status: "synthesizing", synthesis: { ...synthesis, draft_path: ".charthouse/map.json" } }); },
    "a synthesis input without a report": (record) => { Object.assign(record, { status: "synthesizing", synthesis: { ...synthesis, inputs: { ...synthesis.inputs, reports: {} } } }); },
    "an approved status without an approved draft": (record) => {
      Object.assign(record, { status: "approved", synthesis: { ...synthesis, staged: { at: synthesis.started_at, digest, capabilities: 1 }, approvals: [{ capability: "cap-apps-web", digest, at: synthesis.started_at }] } });
    },
    "a survey window without a signature": (record) => { record.surveys.structure.window = { started_at: synthesis.started_at, head_commit: null }; },
    "a survey window with a malformed time": (record) => { record.surveys.structure.window = { started_at: "soon", head_commit: null, signature: digest }; },
    "a publishing status without a publication": (record) => { Object.assign(record, { status: "publishing", synthesis }); },
    "a finished publication that is not published": (record) => {
      Object.assign(record, { status: "publishing", synthesis, publication: { started_at: synthesis.started_at, plan_digest: digest, completed_at: synthesis.started_at, written: 1, removed: 0 } });
    },
    "a publication with a negative count": (record) => {
      Object.assign(record, { status: "published", publication: { started_at: synthesis.started_at, plan_digest: digest, completed_at: synthesis.started_at, written: -1, removed: 0 } });
    },
    "a duplicate approval": (record) => {
      const approval = { capability: "cap-apps-web", digest, at: synthesis.started_at };
      Object.assign(record, { status: "awaiting-approval", synthesis: { ...synthesis, staged: { at: synthesis.started_at, digest, capabilities: 3 }, approvals: [approval, approval] } });
    }
  };
  for (const [name, change] of Object.entries(malformed)) {
    const record = structuredClone(valid);
    change(record);
    assert.throws(() => validateExpedition(record), /Invalid Expedition/, name);
  }
  // Records written before synthesis staging have no synthesis field.
  const older = structuredClone(valid);
  delete older.synthesis;
  assert.equal(validateExpedition(older).id, "E-0001");
  assert.equal(validateExpedition({ ...structuredClone(valid), status: "synthesizing", synthesis }).status, "synthesizing");

  const record = structuredClone(valid);
  record.events = [42];
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  const status = run("expedition", "status", "--root", sandbox, "--json");
  assert.equal(status.status, 1);
  assert.match(status.stderr, /Invalid Expedition/);
});

test("survey validation rejects evidence that the deterministic Map excluded", () => {
  writeFileSync(join(sandbox, ".env"), "SECRET=do-not-read\n");
  assert.equal(git("add", "-f", ".env").status, 0);
  assert.equal(git("-c", "user.name=Charthouse Test", "-c", "user.email=charthouse@test.local", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "track excluded file").status, 0);
  assert.equal(git("branch", "-f", "canonical", "HEAD").status, 0);

  const initialized = JSON.parse(run("init", "--root", sandbox, "--json").stdout);
  const map = readMap();
  const fingerprints = JSON.parse(readFileSync(join(sandbox, ".charthouse/fingerprints.json"), "utf8"));
  const report = {
    schema_version: 1,
    role: "duplication",
    baseline: {
      commit: map.baseline.commit,
      config_digest: fingerprints.config_digest,
      map_generated_at: map.generated_at
    },
    summary: "Review exact duplicates.",
    findings: [{ kind: "excluded-evidence", summary: "An excluded file supports this claim.", evidence: [".env"], confidence: 1 }],
    unresolved: [],
    tool_gaps: [],
    duplicate_groups: map.duplicate_groups.map((group) => ({ kind: "exact-duplicate", paths: group.paths, evidence: group.paths, confidence: 1 }))
  };
  const reportPath = initialized.expedition.surveys.duplication.report_path;
  writeFileSync(join(sandbox, reportPath), `${JSON.stringify(report, null, 2)}\n`);
  const result = run("tool", "run", "survey-report-validate", "--role", "duplication", "--file", reportPath, "--root", sandbox, "--json");
  assert.equal(result.status, 1);
  assert.ok(JSON.parse(result.stdout).result.errors.some((item) => item.code === "evidence-excluded" && item.path === "findings[0].evidence[0]"));
});

test("Map update preserves approved document and duplicate-group semantics", () => {
  cpSync(join(sandbox, "packages/auth/src/token.ts"), join(sandbox, "packages/auth/src/token-copy.ts"));
  assert.equal(git("add", "packages/auth/src/token-copy.ts").status, 0);
  assert.equal(git("-c", "user.name=Charthouse Test", "-c", "user.email=charthouse@test.local", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "add duplicate").status, 0);
  assert.equal(git("branch", "-f", "canonical", "HEAD").status, 0);
  assert.equal(run("init", "--root", sandbox).status, 0);

  const mapPath = join(sandbox, ".charthouse/map.json");
  const map = readMap();
  const readme = map.documents.find((document) => document.path === "README.md");
  readme.id = "document-readme";
  readme.classification = "current";
  readme.criticality = "binding";
  readme.claims = ["The quickstart matches the installed command surface."];
  readme.watches = ["scripts/**"];
  readme.evidence = ["README.md"];
  readme.confidence = 0.9;
  const duplicate = map.duplicate_groups[0];
  duplicate.kind = "shared-helper-copy";
  duplicate.evidence = [...duplicate.paths];
  duplicate.confidence = 0.95;
  writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);

  const result = run("map", "update", "--root", sandbox);
  assert.equal(result.status, 0, result.stderr);
  const updated = readMap();
  const updatedReadme = updated.documents.find((document) => document.path === "README.md");
  assert.deepEqual(updatedReadme.claims, ["The quickstart matches the installed command surface."]);
  assert.equal(updatedReadme.criticality, "binding");
  const updatedDuplicate = updated.duplicate_groups.find((group) => group.digest === duplicate.digest);
  assert.equal(updatedDuplicate.kind, "shared-helper-copy");
  assert.equal(updatedDuplicate.confidence, 0.95);

  cpSync(join(sandbox, "packages/auth/src/token.ts"), join(sandbox, "packages/auth/src/token-third-copy.ts"));
  assert.equal(run("map", "update", "--root", sandbox).status, 0);
  const changed = readMap();
  const changedDuplicate = changed.duplicate_groups.find((group) => group.digest === duplicate.digest);
  assert.equal(changedDuplicate.kind, undefined);
  assert.ok(changed.unresolved.some((item) => item.kind === "duplicate-group-needs-semantic-review"));
});

test("init records ignored boundaries without reading their contents", () => {
  assert.equal(git("init", "--quiet").status, 0);
  mkdirSync(join(sandbox, "build"));
  mkdirSync(join(sandbox, "docs/private"), { recursive: true });
  writeFileSync(join(sandbox, "build/output.js"), "throw new Error('must not be scanned');\n");
  writeFileSync(join(sandbox, "docs/private/architecture.md"), "# Private architecture\n");
  writeFileSync(join(sandbox, ".env"), "SECRET=do-not-index\n");
  writeFileSync(join(sandbox, ".gitignore"), "build/\ndocs/private/\nprivate-notes/\n.env\n");

  const result = run("init", "--root", sandbox, "--json");
  assert.equal(result.status, 0, result.stderr);
  const map = readMap();
  assert.equal(map.files.some((file) => file.path.startsWith("build/")), false);
  assert.equal(map.files.some((file) => file.path.startsWith("docs/private/")), false);
  assert.equal(map.perimeter_regions.some((region) => region.path === ".env"), false);
  assert.ok(map.scan_summary.hidden_ignored_regions >= 1);
  const build = map.perimeter_regions.find((region) => region.path === "build");
  assert.equal(build.classification, "unknown");
  assert.ok(build.reasons.includes("gitignored"));
  assert.equal(build.reasons.includes("generated-policy"), false);
  const docs = map.perimeter_regions.find((region) => region.path === "docs/private");
  assert.equal(docs.classification, "document");
  assert.equal(docs.review_required, true);
  assert.ok(map.unresolved.some((item) => item.kind === "ignored-region-needs-scan-decision" && item.path === "docs/private"));

  writeFileSync(join(sandbox, "build/output.js"), "changed generated output\n");
  writeFileSync(join(sandbox, "docs/private/architecture.md"), "# Changed private architecture\n");
  assert.match(run("check", "--root", sandbox).stdout, /Bearing check: PASS/);

  mkdirSync(join(sandbox, "private-notes"));
  writeFileSync(join(sandbox, "private-notes/new.md"), "# New ignored boundary\n");
  assert.match(run("check", "--root", sandbox).stdout, /Bearing check: REVIEW/);
});

test("an explicit ignored-doc include makes the document evidence", () => {
  assert.equal(git("init", "--quiet").status, 0);
  mkdirSync(join(sandbox, "docs/private"), { recursive: true });
  mkdirSync(join(sandbox, "scratch"));
  writeFileSync(join(sandbox, "docs/private/architecture.md"), "# Private architecture\n");
  writeFileSync(join(sandbox, "scratch/hidden.md"), "# Hidden\n");
  writeFileSync(join(sandbox, ".env"), "SECRET=do-not-index\n");
  writeFileSync(join(sandbox, ".gitignore"), "docs/private/\nscratch/\n.env\n");
  mkdirSync(join(sandbox, ".charthouse"));
  cpSync(join(packageRoot, "templates/config.json"), join(sandbox, ".charthouse/config.json"));
  editConfig((config) => {
    config.scan.gitignored.include.push("docs/private/**");
    config.scan.gitignored.include.push("scratch/**");
    config.scan.gitignored.include.push(".env");
    config.scan.gitignored.hide.push("scratch/**");
  });

  const result = run("init", "--root", sandbox);
  assert.equal(result.status, 0, result.stderr);
  const map = readMap();
  const document = map.files.find((file) => file.path === "docs/private/architecture.md");
  assert.equal(document.gitignored, true);
  assert.equal(map.files.some((file) => file.path === ".env"), false);
  assert.equal(map.files.some((file) => file.path === "scratch/hidden.md"), false);
  assert.equal(map.perimeter_regions.some((region) => region.path === "scratch"), false);
  assert.equal(map.scan_summary.gitignored_scanned_files, 1);
  assert.equal(map.perimeter_regions.some((region) => region.path === "docs/private"), false);

  writeFileSync(join(sandbox, "docs/private/architecture.md"), "# Changed private architecture\n");
  assert.match(run("check", "--root", sandbox).stdout, /Bearing check: REVIEW/);
});

test("changing gitignore makes repository knowledge suspect", () => {
  assert.equal(git("init", "--quiet").status, 0);
  writeFileSync(join(sandbox, ".gitignore"), "build/\n");
  assert.equal(run("init", "--root", sandbox).status, 0);
  writeFileSync(join(sandbox, ".gitignore"), "build/\nprivate-docs/\n");
  assert.match(run("check", "--root", sandbox).stdout, /Bearing check: REVIEW/);
});

test("existing configurations without gitignored policy keep record defaults", () => {
  assert.equal(git("init", "--quiet").status, 0);
  mkdirSync(join(sandbox, "docs/private"), { recursive: true });
  writeFileSync(join(sandbox, "docs/private/notes.md"), "# Notes\n");
  writeFileSync(join(sandbox, ".gitignore"), "docs/private/\n");
  mkdirSync(join(sandbox, ".charthouse"));
  cpSync(join(packageRoot, "templates/config.json"), join(sandbox, ".charthouse/config.json"));
  editConfig((config) => { delete config.scan.gitignored; });

  const result = run("init", "--root", sandbox);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readMap().files.some((file) => file.path === "docs/private/notes.md"), false);
  assert.equal(readMap().perimeter_regions.find((region) => region.path === "docs/private").review_required, true);
});

test("an explicit ignored-path exclusion resolves the scan decision", () => {
  assert.equal(git("init", "--quiet").status, 0);
  mkdirSync(join(sandbox, "docs/private"), { recursive: true });
  writeFileSync(join(sandbox, "docs/private/notes.md"), "# Notes\n");
  writeFileSync(join(sandbox, ".gitignore"), "docs/private/\n");
  mkdirSync(join(sandbox, ".charthouse"));
  cpSync(join(packageRoot, "templates/config.json"), join(sandbox, ".charthouse/config.json"));
  editConfig((config) => config.scan.gitignored.exclude.push("docs/private/**"));

  assert.equal(run("init", "--root", sandbox).status, 0);
  const map = readMap();
  const docs = map.perimeter_regions.find((region) => region.path === "docs/private");
  assert.equal(docs.review_required, false);
  assert.ok(docs.reasons.includes("gitignored-policy"));
  assert.equal(map.unresolved.some((item) => item.path === "docs/private"), false);
});

test("init honors a configuration file prepared before the first Expedition", () => {
  mkdirSync(join(sandbox, ".charthouse"));
  cpSync(join(packageRoot, "templates/config.json"), join(sandbox, ".charthouse/config.json"));
  editConfig((config) => config.scan.packages.exclude.names.push("@fixture/auth"));
  const result = run("init", "--root", sandbox);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readMap().units.find((unit) => unit.name === "@fixture/auth").scope, "stub");
});

test("excluded packages remain dependency stubs without Navigators or indexed internals", () => {
  symlinkSync("../../../packages/auth/src/token.ts", join(sandbox, "apps/web/src/auth-link.ts"));
  assert.equal(run("init", "--root", sandbox).status, 0);
  editConfig((config) => {
    config.scan.packages.exclude.names.push("@fixture/auth");
    config.scan.follow_symlinks = true;
  });
  const update = run("map", "update", "--root", sandbox);
  assert.equal(update.status, 0, update.stderr);

  const map = readMap();
  const auth = map.units.find((unit) => unit.name === "@fixture/auth");
  assert.equal(auth.scope, "stub");
  assert.equal(map.capabilities.some((item) => item.name === "@fixture/auth"), false);
  assert.equal(map.dependencies.length, 1);
  assert.deepEqual(map.files.filter((file) => file.path.startsWith("packages/auth/")).map((file) => file.path), ["packages/auth/package.json"]);
  assert.equal(map.files.some((file) => file.path.endsWith("auth-link.ts")), false);

  const manifest = JSON.parse(readFileSync(join(sandbox, ".charthouse/manifest.json"), "utf8"));
  assert.equal(Object.keys(manifest.navigators).length, 0);
  assert.equal(existsSync(join(sandbox, ".claude/agents/charthouse-packages-auth-navigator.md")), false);
  assert.equal(existsSync(join(sandbox, ".agents/skills/charthouse-packages-auth-navigator/SKILL.md")), false);

  editConfig((config) => { config.scan.packages.excluded_behavior = "omit"; });
  assert.equal(run("map", "update", "--root", sandbox).status, 0);
  assert.equal(readMap().units.some((unit) => unit.name === "@fixture/auth"), false);
  assert.equal(readMap().dependencies.length, 0);
  const source = join(sandbox, "packages/auth/src/token.ts");
  writeFileSync(source, `${readFileSync(source, "utf8")}\n// omitted package change\n`);
  assert.match(run("check", "--root", sandbox).stdout, /Bearing check: PASS/);
});

test("package includes keep unmatched units as boundary stubs", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  editConfig((config) => config.scan.packages.include.paths.push("apps/**"));
  const update = run("map", "update", "--root", sandbox);
  assert.equal(update.status, 0, update.stderr);
  const map = readMap();
  assert.deepEqual(map.units.filter((unit) => unit.scope === "included").map((unit) => unit.root), ["apps/web"]);
  assert.deepEqual(map.units.filter((unit) => unit.scope === "stub").map((unit) => unit.root).sort(), [".", "packages/auth"]);
  assert.equal(map.capabilities.length, 1);

  editConfig((config) => { config.scan.packages.excluded_behavior = "omit"; });
  assert.equal(run("map", "update", "--root", sandbox).status, 0);
  assert.deepEqual(readMap().units.map((unit) => unit.root), ["apps/web"]);
  const source = join(sandbox, "apps/web/src/index.ts");
  writeFileSync(source, `${readFileSync(source, "utf8")}\n// included package change\n`);
  assert.match(run("check", "--root", sandbox).stdout, /Bearing check: REVIEW/);
});

test("excluded tests do not make knowledge stale", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  editConfig((config) => { config.scan.tests.mode = "exclude"; });
  assert.equal(run("map", "update", "--root", sandbox).status, 0);
  assert.equal(readMap().files.some((file) => file.role === "test"), false);

  const testPath = join(sandbox, "apps/web/src/index.test.ts");
  writeFileSync(testPath, `${readFileSync(testPath, "utf8")}\n// ignored test change\n`);
  const check = run("check", "--root", sandbox);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /Bearing check: PASS/);
});

test("a package override can restore tests as evidence", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  editConfig((config) => {
    config.scan.tests.mode = "exclude";
    config.scan.package_overrides.push({
      selector: { names: ["@fixture/web"], paths: [] },
      tests: "evidence"
    });
  });
  const update = run("map", "update", "--root", sandbox);
  assert.equal(update.status, 0, update.stderr);
  const testFile = readMap().files.find((file) => file.path.endsWith("index.test.ts"));
  assert.equal(testFile.scan_mode, "evidence");
});

test("only full-mode tests participate in duplicate analysis", () => {
  const source = join(sandbox, "apps/web/src/index.test.ts");
  const copy = join(sandbox, "apps/web/src/copy.test.ts");
  writeFileSync(copy, readFileSync(source));
  assert.equal(run("init", "--root", sandbox).status, 0);
  assert.equal(readMap().duplicate_groups.some((group) => group.paths.includes("apps/web/src/index.test.ts")), false);

  editConfig((config) => { config.scan.tests.mode = "full"; });
  assert.equal(run("map", "update", "--root", sandbox).status, 0);
  assert.equal(readMap().duplicate_groups.some((group) => group.paths.includes("apps/web/src/index.test.ts") && group.paths.includes("apps/web/src/copy.test.ts")), true);
});

test("document, language, and file-size policies shape the Map", () => {
  const large = join(sandbox, "apps/web/src/large.ts");
  const ignoredDirectory = join(sandbox, "apps/web/src/ignored");
  const ignored = join(ignoredDirectory, "cache.ts");
  const notesDirectory = join(sandbox, "docs");
  const notes = join(notesDirectory, "notes.md");
  mkdirSync(ignoredDirectory, { recursive: true });
  mkdirSync(notesDirectory, { recursive: true });
  writeFileSync(large, `export const large = "${"x".repeat(2048)}";\n`);
  writeFileSync(ignored, "export const ignored = true;\n");
  writeFileSync(notes, "# Internal notes\n");
  assert.equal(run("init", "--root", sandbox).status, 0);
  editConfig((config) => {
    config.scan.documents.mode = "selected";
    config.scan.documents.include = ["README.md"];
    config.scan.languages.exclude = ["JSON"];
    config.scan.paths.exclude = ["apps/web/src/ignored/**"];
    config.scan.max_file_size = 1024;
  });
  assert.equal(run("map", "update", "--root", sandbox).status, 0);
  const map = readMap();
  assert.deepEqual(map.documents.map((item) => item.path), ["README.md"]);
  assert.equal(map.files.some((file) => file.path.endsWith("account.json")), false);
  const largeFile = map.files.find((file) => file.path.endsWith("large.ts"));
  assert.equal(largeFile.oversize, true);
  assert.equal(largeFile.digest, null);

  const fixture = join(sandbox, "apps/web/fixtures/account.json");
  writeFileSync(fixture, `${readFileSync(fixture, "utf8")}\n`);
  writeFileSync(ignored, `${readFileSync(ignored, "utf8")}\n// ignored\n`);
  writeFileSync(notes, `${readFileSync(notes, "utf8")}\nExcluded note.\n`);
  assert.match(run("check", "--root", sandbox).stdout, /Bearing check: PASS/);
});

test("invalid scan configuration fails with a focused error", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  editConfig((config) => { config.scan.tests.mode = "sometimes"; });
  const result = run("map", "update", "--root", sandbox);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid Charthouse config: scan\.tests\.mode/);
});

test("an unsafe canonical ref fails with a focused error", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  editConfig((config) => { config.git = { canonical_ref: "HEAD~1" }; });
  const result = run("status", "--root", sandbox);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid Charthouse config: git\.canonical_ref is not a safe Git ref name/);
});

test("an existing repository complains until its canonical branch is pinned", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  editConfig((config) => { config.git.canonical_ref = null; });
  const status = run("status", "--root", sandbox);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /relationship: unpinned/);
  const check = run("check", "--root", sandbox);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /canonical-branch-unpinned/);
  for (const args of [
    ["run", "Update the guide", "--root", sandbox],
    ["run", "Update the guide", "--allow-behind", "--root", sandbox]
  ]) {
    const refused = run(...args);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /requires git\.canonical_ref/);
  }
});

test("symlinks are opt-in and remain visibly marked", () => {
  const link = join(sandbox, "apps/web/src/auth-link.ts");
  symlinkSync("../../../packages/auth/src/token.ts", link);
  assert.equal(run("init", "--root", sandbox).status, 0);
  assert.equal(readMap().files.some((file) => file.path.endsWith("auth-link.ts")), false);

  editConfig((config) => { config.scan.follow_symlinks = true; });
  const update = run("map", "update", "--root", sandbox);
  assert.equal(update.status, 0, update.stderr);
  assert.equal(readMap().files.find((file) => file.path.endsWith("auth-link.ts")).via_symlink, true);
});

test("an opted-in symlinked Instruction Contract monitors its in-repository target", () => {
  mkdirSync(join(sandbox, "docs"), { recursive: true });
  writeFileSync(join(sandbox, "docs/agent-rules.md"), "Initial agent rules.\n");
  symlinkSync("docs/agent-rules.md", join(sandbox, "AGENTS.md"));
  mkdirSync(join(sandbox, ".charthouse"));
  cpSync(join(packageRoot, "templates/config.json"), join(sandbox, ".charthouse/config.json"));
  editConfig((config) => { config.scan.follow_symlinks = true; });

  assert.equal(run("init", "--root", sandbox).status, 0);
  assert.ok(readMap().instruction_contracts.some((item) => item.path === "AGENTS.md"));
  writeFileSync(join(sandbox, "docs/agent-rules.md"), "Changed agent rules.\n");
  const changed = run("check", "--root", sandbox, "--json");
  assert.equal(changed.status, 1);
  assert.ok(JSON.parse(changed.stdout).findings.some((item) => item.code === "document-suspect" && item.path === "AGENTS.md"));
});

test("a Bearing check detects changed evidence without changing state", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const clean = run("c", "--root", sandbox);
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /Bearing check: PASS/);

  const source = join(sandbox, "packages/auth/src/token.ts");
  writeFileSync(source, `${readFileSync(source, "utf8")}\n// changed\n`);
  const changed = run("check", "--root", sandbox);
  assert.equal(changed.status, 0, changed.stderr);
  assert.match(changed.stdout, /Bearing check: REVIEW/);
  assert.match(changed.stdout, /document-suspect/);
});

test("a historical document is never made suspect by changed evidence", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  mkdirSync(join(sandbox, "docs/status-reports"), { recursive: true });
  writeFileSync(join(sandbox, "docs/status-reports/2026-01-01-overview.md"), "# Status report as of 1 January 2026\n");
  writeFileSync(join(sandbox, "docs/guide.md"), "# Guide\n");
  const manifestPath = join(sandbox, ".charthouse/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const watches = ["packages/auth/src/token.ts"];
  manifest.documents["doc-status-report"] = { path: "docs/status-reports/2026-01-01-overview.md", status: "historical", criticality: "historical", watches, knowledge: [] };
  // Live control: a maintained document watching the same file must still go suspect.
  manifest.documents["doc-guide"] = { path: "docs/guide.md", status: "current", criticality: "informational", watches, knowledge: [] };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const update = run("map", "update", "--root", sandbox);
  assert.equal(update.status, 0, update.stderr);

  const source = join(sandbox, "packages/auth/src/token.ts");
  writeFileSync(source, `${readFileSync(source, "utf8")}\n// changed\n`);
  const checked = run("check", "--root", sandbox);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /doc-guide is suspect because packages\/auth\/src\/token\.ts changed/);
  assert.doesNotMatch(checked.stdout, /doc-status-report/);
});

test("enforce mode fails when a record needs review", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const configPath = join(sandbox, ".charthouse/config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.mode = "enforce";
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const source = join(sandbox, "apps/web/src/index.ts");
  writeFileSync(source, `${readFileSync(source, "utf8")}\n// changed\n`);
  const result = run("check", "--root", sandbox);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Bearing check: REVIEW/);
});

test("queries resolve aliases and path ownership", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  approveAllCapabilities();
  const status = run("s", "--root", sandbox, "--json");
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).navigators, 3);
  assert.equal(JSON.parse(status.stdout).expedition.status, "published");
  const owner = run("who", "packages/auth/src/token.ts", "--root", sandbox, "--json");
  assert.equal(owner.status, 0, owner.stderr);
  assert.match(owner.stdout, /auth-navigator/);
  const affected = run("impact", "change auth token handling", "--root", sandbox, "--json");
  assert.equal(affected.status, 0, affected.stderr);
  const impact = JSON.parse(affected.stdout);
  assert.equal(typeof impact.capabilities[0].score, "number");
  assert.equal(impact.matches[0].capability, impact.capabilities[0].id);
});

test("Bearing check reports an unresolved inline pointer", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const source = join(sandbox, "packages/auth/src/token.ts");
  writeFileSync(source, `${readFileSync(source, "utf8")}\n// CHARTHOUSE[K-9999]: Keep this operation atomic.\n`);
  const result = run("check", "--root", sandbox);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /marker-unresolved/);
});

test("Map update preserves semantic capability decisions", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const mapPath = join(sandbox, ".charthouse/map.json");
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  const auth = map.capabilities.find((item) => item.id.includes("packages-auth"));
  auth.purpose = "Keep token lifecycle rules in one package.";
  auth.provenance = "human-approved";
  auth.approved = true;
  writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);
  const manifestPath = join(sandbox, ".charthouse/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.documents["doc-design"] = {
    path: "README.md",
    status: "current",
    criticality: "informational",
    watches: ["README.md"],
    knowledge: []
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const source = join(sandbox, "packages/auth/src/token.ts");
  writeFileSync(source, `${readFileSync(source, "utf8")}\n// changed\n`);
  const updated = run("map", "update", "--root", sandbox);
  assert.equal(updated.status, 0, updated.stderr);
  const next = JSON.parse(readFileSync(mapPath, "utf8"));
  const preserved = next.capabilities.find((item) => item.id === auth.id);
  assert.equal(preserved.purpose, "Keep token lifecycle rules in one package.");
  assert.equal(preserved.approved, true);
  const nextManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(nextManifest.documents["doc-design"].path, "README.md");

  const check = run("check", "--root", sandbox);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /Bearing check: PASS/);
});

test("Map update never deletes a product file named by untrusted state", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const manifestPath = join(sandbox, ".charthouse/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.navigators.untrusted = {
    source: "apps/web/src/index.ts",
    generated_agent: "packages/auth/src/token.ts",
    generated_rule: "README.md",
    primary_paths: [],
    secondary_paths: [],
    approved: false
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const product = join(sandbox, "apps/web/src/index.ts");
  const before = readFileSync(product, "utf8");
  const update = run("map", "update", "--root", sandbox);
  assert.equal(update.status, 0, update.stderr);
  assert.equal(readFileSync(product, "utf8"), before);
});

test("a modified tracked file keeps its full path in the changed-path list", async () => {
  writeFileSync(join(sandbox, "package.json"), `${readFileSync(join(sandbox, "package.json"), "utf8")}\n`);
  const { gitChangedPaths } = await import(join(packageRoot, "scripts/lib/git.mjs"));
  // `git status --porcelain` starts a modified line with a space. A trim of the
  // whole output removed that space and the parser sliced the first letter off.
  assert.deepEqual(gitChangedPaths(sandbox), ["package.json"]);
});

test("map update keeps a human-approved capability that spans several units", () => {
  assert.equal(git("init", "--quiet").status, 0);
  assert.equal(run("init", "--root", sandbox).status, 0);
  const mapPath = join(sandbox, ".charthouse/map.json");
  approveExpeditionMap(sandbox, run, (map) => {
    const drafts = map.capabilities.map((item) => item.id).sort();
    assert.deepEqual(drafts, ["cap-apps-web", "cap-fixture-root", "cap-packages-auth"]);
    map.capabilities = [
      {
        id: "cap-identity",
        name: "Identity",
        purpose: "Own sign-in for the web app and the auth package.",
        primary_paths: ["apps/web/**", "packages/auth/**"],
        secondary_paths: [],
        units: ["unit-apps-web", "unit-packages-auth"],
        entrypoints: ["packages/auth/src/index.ts"],
        invariants: [{ statement: "A session token is never logged.", evidence: ["packages/auth/src/index.ts"], confidence: 0.8 }],
        review: [{ navigator: "cap-fixture-root", reason: "the workspace build wires the package." }],
        verification: ["npm test --workspace packages/auth"],
        rules: ["Keep the token format in one module."],
        confidence: 0.9,
        evidence: ["packages/auth/package.json"],
        provenance: "semantic"
      },
      map.capabilities.find((item) => item.id === "cap-fixture-root")
    ];
    map.anomalies.push({ id: "anomaly-auth-copy", kind: "misplaced-shared-code", severity: "minor", detail: "apps/web copies a helper from packages/auth.", paths: ["apps/web/src/auth.ts"], evidence: ["packages/auth/src/index.ts"], confidence: 0.8 });
    map.unresolved.push({ id: "unresolved-scope-1", kind: "unassigned-scope", paths: ["docs/**"], detail: "No capability owns docs/." });
  });
  const published = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(published.status, 0, published.stderr);
  const update = run("map", "update", "--root", sandbox);
  assert.equal(update.status, 0, update.stderr);
  const after = JSON.parse(readFileSync(mapPath, "utf8"));
  // The approved boundary survives and the drafts for the units it covers do not
  // come back. The workspace draft that nothing covers is still there.
  assert.deepEqual(after.capabilities.map((item) => item.id).sort(), ["cap-fixture-root", "cap-identity"]);
  // Findings with an id came from a survey. A rescan keeps them beside its own.
  assert.ok(after.anomalies.some((item) => item.id === "anomaly-auth-copy"));
  assert.ok(after.unresolved.some((item) => item.id === "unresolved-scope-1"));
  const identity = after.capabilities.find((item) => item.id === "cap-identity");
  assert.equal(identity.approved, true);
  assert.equal(identity.provenance, "human-approved");
  assert.ok(existsSync(join(sandbox, "docs/charthouse/navigators/identity.md")));
  assert.ok(!existsSync(join(sandbox, "docs/charthouse/navigators/packages-auth.md")));
  // The regenerated brief keeps every semantic field the Map carries.
  const brief = readFileSync(join(sandbox, "docs/charthouse/navigators/identity.md"), "utf8");
  for (const expected of [
    "- Provenance: human-approved",
    "## Entrypoints",
    "- `packages/auth/src/index.ts`",
    "## Invariants to protect",
    "1. A session token is never logged.",
    "## Required review",
    "- cap-fixture-root, because the workspace build wires the package.",
    "## Verification",
    "npm test --workspace packages/auth",
    "- Keep the token format in one module."
  ]) assert.ok(brief.includes(expected), `missing: ${expected}`);
  const regenerate = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(regenerate.status, 0, regenerate.stderr);
  assert.match(regenerate.stdout, /generated: 2/);
  assert.match(regenerate.stdout, /Restart agent sessions/);
  assert.equal(JSON.parse(run("expedition", "status", "--root", sandbox, "--json").stdout).status, "published");
  const agent = readFileSync(join(sandbox, ".claude/agents/charthouse-identity-navigator.md"), "utf8");
  assert.match(agent, /Repository specialist for Identity/);
  assert.match(agent, /apps\/web\/\*\*, packages\/auth\/\*\*/);
  assert.match(agent, /review the changed files and any diff that the parent session supplies/);
  const skill = readFileSync(join(sandbox, ".agents/skills/charthouse-identity-navigator/SKILL.md"), "utf8");
  assert.match(skill, /Identity Navigator/);
  const taskBrief = JSON.parse(run("brief", "change identity login", "--root", sandbox, "--json").stdout);
  assert.ok(taskBrief.navigators.some((navigator) => navigator.id === "charthouse-identity-navigator" && navigator.role === "responsible"));
  assert.ok(taskBrief.navigators.some((navigator) => navigator.id === "charthouse-fixture-root-navigator" && navigator.role === "reviewing"));
});

test("brief returns compact task context without creating a Voyage", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  approveAllCapabilities();
  const result = run("brief", "change auth token handling", "--root", sandbox, "--json");
  assert.equal(result.status, 0, result.stderr);
  const brief = JSON.parse(result.stdout);
  assert.equal(brief.objective, "change auth token handling");
  assert.equal(brief.git.ref, "canonical");
  assert.ok(brief.capabilities.some((capability) => capability.name.includes("auth")));
  assert.ok(brief.navigators.some((navigator) => navigator.generated_skill?.startsWith(".agents/skills/")));
  assert.equal(brief.charter.path, "docs/charthouse/charter.md");
  assert.equal(brief.pre_response_gate.required, true);
  assert.equal(brief.pre_response_gate.decision_gate.maximum_questions, 1);
  assert.ok(brief.pre_response_gate.decision_gate.exclude.includes("ownership or specialist lists"));
  assert.ok(brief.pre_response_gate.decision_gate.exclude.includes("routine no-write bookkeeping"));
  assert.match(brief.note, /lexical/i);
  assert.equal(existsSync(join(sandbox, ".charthouse/voyages/V-0001.json")), false);
});

test("brief ranks a direct-debit marketplace task without loading the whole Map", () => {
  mkdirSync(join(sandbox, "packages/health-web-service"), { recursive: true });
  writeFileSync(join(sandbox, "packages/health-web-service/package.json"), `${JSON.stringify({
    name: "@example/health-web-service",
    scripts: {
      test: "npm run type-check && npm run lint && vitest run",
      "type-check": "tsc --noEmit",
      lint: "eslint .",
      build: "tsc -p tsconfig.build.json"
    }
  }, null, 2)}\n`);
  assert.equal(run("init", "--root", sandbox).status, 0);
  approveExpeditionMap(sandbox, run, (map) => {
    map.capabilities = [
      {
        id: "cap-marketplace-web-application",
        name: "Marketplace Web Application",
        purpose: "Serve the marketplace SPA and the apps that mount inside it.",
        primary_paths: ["apps/web/**", "packages/ezidebit/apps/direct-debit/**"],
        secondary_paths: [],
        units: [],
        evidence: ["packages/ezidebit/apps/direct-debit/src/index.ts"],
        review: [{ navigator: "cap-marketplace-backend-service", reason: "The app calls the marketplace API." }],
        verification: [
          "npm run build --workspace @example/health-web",
          "npm run test --workspace @example/health-web",
          "npm run lint --workspace @example/health-web",
          "npm test --workspace @example/ezidebit-app-direct-debit",
          "node --test bin/new-web-app.spec.js"
        ],
        confidence: 0.9,
        provenance: "semantic"
      },
      {
        id: "cap-marketplace-backend-service",
        name: "Marketplace Backend Service",
        purpose: "Serve the marketplace API, including the server routes for installed apps.",
        primary_paths: ["packages/health-web-service/**"],
        secondary_paths: [],
        units: [],
        evidence: ["packages/health-web-service/src/routes/api/mini-apps/direct-debit.ts"],
        review: [
          { navigator: "cap-marketplace-web-application", reason: "The marketplace SPA consumes this API." },
          { navigator: "cap-unified-api-service", reason: "The backend calls the unified API." },
          { navigator: "cap-financial-and-payment-integrations", reason: "Direct-debit routes use the payment connector." }
        ],
        verification: [
          "npm run test --workspace packages/health-web-service",
          "npm run type-check --workspace packages/health-web-service",
          "npm run lint --workspace packages/health-web-service",
          "npm run build --workspace packages/health-web-service"
        ],
        confidence: 0.9,
        provenance: "semantic"
      },
      {
        id: "cap-financial-and-payment-integrations",
        name: "Financial and Payment Integrations",
        purpose: "Provide direct-debit payment clients used by routines and the marketplace backend.",
        primary_paths: ["packages/ezidebit/src/**"],
        secondary_paths: [],
        units: [],
        evidence: ["packages/ezidebit/package.json"],
        review: [],
        verification: ["npm test --workspace packages/ezidebit"],
        confidence: 0.8,
        provenance: "semantic"
      },
      {
        id: "cap-unified-api-service",
        name: "Unified API Service",
        purpose: "Serve one HTTP API over every practice-management target.",
        primary_paths: ["packages/health-service/**"],
        secondary_paths: [],
        units: [],
        evidence: ["packages/health-service/package.json"],
        review: [],
        verification: ["npm test --workspace packages/health-service"],
        confidence: 0.8,
        provenance: "semantic"
      },
      {
        id: "cap-monorepo-build-and-release-tooling",
        name: "Monorepo Build and Release Tooling",
        purpose: "Run repository builds and release workflows.",
        primary_paths: ["bin/**", ".github/workflows/**"],
        secondary_paths: [],
        units: ["unit-fixture-root"],
        evidence: ["package.json"],
        review: [],
        verification: ["npm test"],
        confidence: 0.8,
        provenance: "semantic"
      },
      {
        id: "cap-authentication",
        name: "Authentication",
        purpose: "Issue and check session tokens.",
        primary_paths: ["packages/auth/**"],
        secondary_paths: [],
        units: ["unit-packages-auth"],
        evidence: ["packages/auth/package.json"],
        review: [],
        verification: ["npm test --workspace packages/auth"],
        confidence: 0.8,
        provenance: "semantic"
      }
    ];
  });
  const regenerated = run("navigator", "regenerate", "all", "--root", sandbox);
  assert.equal(regenerated.status, 0, regenerated.stderr);

  const objective = "change the direct-debit app so that its settings are backed by the marketplace API";
  const result = run("brief", objective, "--root", sandbox, "--json");
  assert.equal(result.status, 0, result.stderr);
  const brief = JSON.parse(result.stdout);

  assert.deepEqual(brief.capabilities.map((capability) => capability.id).sort(), [
    "cap-marketplace-backend-service",
    "cap-marketplace-web-application"
  ]);
  assert.deepEqual(brief.navigators.map((navigator) => [navigator.id, navigator.role]).sort(), [
    ["charthouse-financial-and-payment-integrations-navigator", "reviewing"],
    ["charthouse-marketplace-backend-service-navigator", "responsible"],
    ["charthouse-marketplace-web-application-navigator", "responsible"]
  ]);
  assert.deepEqual(brief.likely_paths, [
    "packages/ezidebit/apps/direct-debit/**",
    "packages/health-web-service/**"
  ]);
  assert.ok(brief.verification.length <= 6, brief.verification.join("\n"));
  assert.ok(brief.verification.includes("npm test --workspace @example/ezidebit-app-direct-debit"));
  assert.ok(brief.verification.includes("npm run test --workspace packages/health-web-service"));
  assert.equal(brief.verification.includes("npm run type-check --workspace packages/health-web-service"), false);
  assert.equal(brief.verification.includes("npm run lint --workspace packages/health-web-service"), false);
  assert.equal(brief.verification.includes("node --test bin/new-web-app.spec.js"), false);
  assert.equal(brief.verification.includes("npm test"), false);
  assert.ok(brief.instruction_contracts.length <= 6);
  assert.ok(brief.documents.length <= 8);
  assert.match(brief.note, /ranked/i);
});

test("reconcile refreshes changed evidence once and clears the queue", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const target = join(sandbox, "packages/auth/src/token.ts");
  const before = readMap().files.find((file) => file.path === "packages/auth/src/token.ts").digest;
  writeFileSync(target, "export const token = 'changed';\n");
  const queued = spawnSync(process.execPath, [bin, "hook", "changed", "--root", sandbox], {
    cwd: sandbox,
    encoding: "utf8",
    input: JSON.stringify({ tool_input: { file_path: target } })
  });
  assert.equal(queued.status, 0, queued.stderr);

  const first = run("reconcile", "--root", sandbox, "--json");
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).updated, true);
  const after = readMap().files.find((file) => file.path === "packages/auth/src/token.ts").digest;
  assert.notEqual(after, before);
  assert.deepEqual(JSON.parse(readFileSync(join(sandbox, ".charthouse/changed-paths.json"), "utf8")).paths, []);

  const second = run("reconcile", "--root", sandbox, "--json");
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).updated, false);

  writeFileSync(target, "export const token = 'changed again';\n");
  const queuedAgain = spawnSync(process.execPath, [bin, "hook", "changed", "--root", sandbox], {
    cwd: sandbox,
    encoding: "utf8",
    input: JSON.stringify({ tool_input: { file_path: target } })
  });
  assert.equal(queuedAgain.status, 0, queuedAgain.stderr);
  const sessionStart = run("hook", "session-start", "--root", sandbox);
  assert.equal(sessionStart.status, 0, sessionStart.stderr);
  assert.match(sessionStart.stdout, /Repository context refreshed from 1 changed path\./);
  const afterSessionStart = readMap().files.find((file) => file.path === "packages/auth/src/token.ts").digest;
  assert.notEqual(afterSessionStart, after);
});

test("reconcile dry-run reports pending work without changing Charthouse state", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const target = join(sandbox, "packages/auth/src/token.ts");
  writeFileSync(target, "export const token = 'dry-run change';\n");
  const before = Object.fromEntries([
    ".charthouse/map.json",
    ".charthouse/manifest.json",
    ".charthouse/fingerprints.json",
    ".charthouse/reconciliation.json",
    ".charthouse/changed-paths.json"
  ].map((path) => [path, readFileSync(join(sandbox, path), "utf8")]));

  const preview = JSON.parse(run("reconcile", "--dry-run", "--root", sandbox, "--json").stdout);
  assert.equal(preview.dry_run, true);
  assert.equal(preview.updated, false);
  assert.equal(preview.would_update, true);
  assert.ok(preview.paths.includes("packages/auth/src/token.ts"));
  for (const [path, contents] of Object.entries(before)) {
    assert.equal(readFileSync(join(sandbox, path), "utf8"), contents, `${path} changed during dry-run`);
  }

  const applied = JSON.parse(run("reconcile", "--root", sandbox, "--json").stdout);
  assert.equal(applied.updated, true);
});

test("reconcile refreshes a clean working tree when HEAD changes", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const target = join(sandbox, "packages/auth/src/token.ts");
  const before = readMap().files.find((file) => file.path === "packages/auth/src/token.ts").digest;
  writeFileSync(target, "export const token = 'committed change';\n");
  assert.equal(git("add", "packages/auth/src/token.ts").status, 0);
  assert.equal(git("-c", "user.name=Charthouse Test", "-c", "user.email=charthouse@test.local", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "change token").status, 0);
  assert.equal(git("status", "--porcelain", "--untracked-files=no").stdout, "");

  const beforeReconcile = JSON.parse(run("check", "--root", sandbox, "--json").stdout);
  assert.ok(beforeReconcile.findings.some((item) => item.code === "reconciliation-required" && item.message.includes("head-commit")));
  const refreshed = JSON.parse(run("reconcile", "--root", sandbox, "--json").stdout);
  assert.equal(refreshed.updated, true);
  assert.ok(refreshed.triggers.includes("head-commit"));
  assert.deepEqual(refreshed.paths, ["**"]);
  assert.notEqual(readMap().files.find((file) => file.path === "packages/auth/src/token.ts").digest, before);
  assert.equal(JSON.parse(run("reconcile", "--root", sandbox, "--json").stdout).updated, false);
});

test("the monitor records canonical movement and discovers new instructions after a clean fast-forward", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const workingBranch = git("branch", "--show-current").stdout.trim();
  assert.equal(git("switch", "--quiet", "canonical").status, 0);
  writeFileSync(join(sandbox, "AGENTS.md"), "New canonical instructions.\n");
  assert.equal(git("add", "AGENTS.md").status, 0);
  assert.equal(git("-c", "user.name=Charthouse Test", "-c", "user.email=charthouse@test.local", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "add instructions").status, 0);
  assert.equal(git("switch", "--quiet", workingBranch).status, 0);

  const canonicalOnly = JSON.parse(run("reconcile", "--root", sandbox, "--json").stdout);
  assert.equal(canonicalOnly.updated, false);
  assert.equal(canonicalOnly.canonical_changed, true);
  assert.equal(canonicalOnly.checkout_update_required, true);
  assert.deepEqual(canonicalOnly.triggers, ["canonical-commit"]);
  assert.equal(readMap().instruction_contracts.some((item) => item.path === "AGENTS.md"), false);

  assert.equal(git("merge", "--quiet", "--ff-only", "canonical").status, 0);
  const pending = JSON.parse(run("check", "--root", sandbox, "--json").stdout);
  assert.ok(pending.findings.some((item) => item.code === "reconciliation-required" && item.message.includes("head-commit")));
  const sessionStart = run("hook", "session-start", "--root", sandbox);
  assert.equal(sessionStart.status, 0, sessionStart.stderr);
  assert.match(sessionStart.stdout, /Repository context refreshed/);
  assert.ok(readMap().instruction_contracts.some((item) => item.path === "AGENTS.md"));
  const current = JSON.parse(run("check", "--root", sandbox, "--json").stdout);
  assert.equal(current.findings.some((item) => item.code === "reconciliation-required"), false);
});

test("reconcile migrates legacy repository context even when evidence is unchanged", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  approveAllCapabilities();
  const manifestPath = join(sandbox, ".charthouse/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.schema_version = 1;
  for (const navigator of Object.values(manifest.navigators)) delete navigator.generated_skill;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const mapPath = join(sandbox, ".charthouse/map.json");
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  delete map.instruction_contracts;
  delete map.instruction_duplicate_groups;
  writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);

  const before = run("check", "--root", sandbox);
  assert.equal(before.status, 0, before.stderr);
  assert.match(before.stdout, /migration-required/);
  const diagnosis = JSON.parse(run("doctor", "--root", sandbox, "--json").stdout);
  assert.equal(diagnosis.migration.required, true);
  assert.equal(diagnosis.migration.supported, true);
  assert.ok(diagnosis.migration.reasons.includes("instruction-contracts"));

  const migrated = run("reconcile", "--root", sandbox, "--json");
  assert.equal(migrated.status, 0, migrated.stderr);
  const result = JSON.parse(migrated.stdout);
  assert.equal(result.updated, true);
  assert.equal(result.migration.completed, true);
  const upgraded = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(upgraded.schema_version, 2);
  for (const navigator of Object.values(upgraded.navigators)) {
    assert.ok(navigator.generated_skill);
    assert.equal(existsSync(join(sandbox, navigator.generated_skill)), true);
  }
  assert.ok(Array.isArray(readMap().instruction_contracts));
  assert.equal(JSON.parse(run("reconcile", "--root", sandbox, "--json").stdout).updated, false);
});

test("reconcile refuses a future manifest schema", () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  const manifestPath = join(sandbox, ".charthouse/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.schema_version = 999;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const check = run("check", "--root", sandbox);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /migration-unsupported/);
  const result = run("reconcile", "--root", sandbox);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot be migrated automatically/);
  const update = run("map", "update", "--root", sandbox);
  assert.equal(update.status, 1);
  assert.match(update.stderr, /cannot be migrated automatically/);
  assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).schema_version, 999);
});

test("the Stop hook catches shell changes without rescanning the same dirty tree", async () => {
  assert.equal(run("init", "--root", sandbox).status, 0);
  assert.equal(git("init", "--quiet").status, 0);
  assert.equal(git("add", ".").status, 0);
  assert.equal(git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "baseline").status, 0);
  const target = join(sandbox, "apps/web/src/index.ts");
  writeFileSync(target, `${readFileSync(target, "utf8")}\n// shell edit\n`);

  const first = run("hook", "stop", "--root", sandbox);
  assert.equal(first.status, 0, first.stderr);
  const refreshed = readMap();
  assert.equal(refreshed.files.find((file) => file.path === "apps/web/src/index.ts").digest, (await import(join(packageRoot, "scripts/lib/fs.mjs"))).fingerprintFile(target));

  const second = run("hook", "stop", "--root", sandbox);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readMap().generated_at, refreshed.generated_at);
});

function fillCharter(sandbox, sections = null) {
  const path = join(sandbox, "docs/charthouse/charter.md");
  let text = readFileSync(path, "utf8");
  const prompts = {
    "Product purpose": "A fixture monorepo for Charthouse tests.",
    "Intended capability boundaries": "Identity stays in packages/auth.",
    "Ownership": "One team owns everything.",
    "Required architecture rules": "Apps import packages. Packages never import apps.",
    "Allowed exceptions": "None.",
    "Security and compliance": "No secrets in the tree.",
    "Build and deployment constraints": "Node 20 or later.",
    "Refit priorities": "None approved.",
    "Excluded paths": "build/"
  };
  for (const [name, body] of Object.entries(prompts)) {
    if (sections && !sections.includes(name)) continue;
    text = text.replace(new RegExp(`(## ${name}\\n\\n)[^\\n]+`), `$1${body}`);
  }
  writeFileSync(path, text);
}

test("a template Charter is reported and refused where intent is compared", () => {
  assert.equal(git("init", "--quiet").status, 0);
  const init = run("init", "--root", sandbox);
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /charthouse charter create/);

  const validate = run("charter", "validate", "--root", sandbox);
  assert.equal(validate.status, 1);
  assert.match(validate.stdout, /valid: false/);
  assert.match(validate.stdout, /state: template/);

  const check = run("check", "--root", sandbox);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /Bearing check: PASS/);
  assert.match(check.stdout, /INFORMATION charter-template: .*template prompts/);
  assert.match(run("status", "--root", sandbox).stdout, /charter: template/);
  assert.match(run("doctor", "--root", sandbox).stdout, /charter: template/);

  const pr = run("pr", "preview", "--root", sandbox);
  assert.notEqual(pr.status, 0);
  assert.match(pr.stderr, /Charter is a template/);
  const refit = run("refit", "propose", "--root", sandbox);
  assert.notEqual(refit.status, 0);
  assert.match(refit.stderr, /Charter is a template/);
  assert.match(run("run", "fix login", "--root", sandbox).stdout, /charter: template/);
  assert.match(run("charter", "update", "x", "--root", sandbox).stdout, /charthouse charter create/);

  const hook = spawnSync(process.execPath, [bin, "hook", "session-start", "--root", sandbox], { cwd: sandbox, encoding: "utf8" });
  assert.match(hook.stdout, /The Charter is template; run \/charthouse charter create/);
});

test("a filled Charter validates and unlocks the intent-comparing commands", () => {
  assert.equal(git("init", "--quiet").status, 0);
  assert.equal(run("init", "--root", sandbox).status, 0);

  fillCharter(sandbox, ["Product purpose"]);
  const partial = run("charter", "validate", "--root", sandbox);
  assert.equal(partial.status, 1);
  assert.match(partial.stdout, /state: partial/);
  assert.match(partial.stdout, /Required architecture rules/);
  assert.match(run("check", "--root", sandbox).stdout, /INFORMATION charter-partial: .*Intended capability boundaries/);
  assert.match(run("charter", "create", "--root", sandbox).stdout, /Sections still holding template prompts/);

  fillCharter(sandbox);
  const complete = run("charter", "validate", "--root", sandbox);
  assert.equal(complete.status, 0, complete.stdout);
  assert.match(complete.stdout, /valid: true/);
  assert.match(complete.stdout, /state: complete/);
  const check = run("check", "--root", sandbox);
  assert.match(check.stdout, /Bearing check: PASS/);
  assert.doesNotMatch(check.stdout, /charter-/);
  assert.match(run("status", "--root", sandbox).stdout, /charter: complete/);
  assert.equal(run("pr", "preview", "--root", sandbox).status, 0);
  assert.equal(run("refit", "propose", "--root", sandbox).status, 0);
  assert.match(run("charter", "create", "--root", sandbox).stdout, /Charter is complete/);
  const hook = spawnSync(process.execPath, [bin, "hook", "session-start", "--root", sandbox], { cwd: sandbox, encoding: "utf8" });
  assert.doesNotMatch(hook.stdout, /Charter/);
});

test("next lists findings and suggests commands in priority order", () => {
  assert.equal(git("init", "--quiet").status, 0);
  assert.equal(run("init", "--root", sandbox).status, 0);
  const first = run("next", "--root", sandbox);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Charter: template/);
  assert.match(first.stdout, /1\. \[now\] Write the Charter\.\n   charthouse charter create/);
  assert.match(first.stdout, /\[now\] Review 3 preliminary capability boundaries at the Map gate\.\n   charthouse expedition resume E-0001/);
  assert.match(first.stdout, /Run the first Voyage/);
  assert.equal(run("suggest", "--root", sandbox).stdout, first.stdout);
  assert.equal(run("n", "--root", sandbox).stdout, first.stdout);

  fillCharter(sandbox);
  const mapPath = join(sandbox, ".charthouse/map.json");
  const map = JSON.parse(readFileSync(mapPath, "utf8"));
  map.capabilities = map.capabilities.map((item) => ({ ...item, approved: true, provenance: "human-approved" }));
  map.anomalies.push({ id: "anomaly-stale-readme", kind: "stale-document", severity: "major", detail: "README.md names a deleted package.", paths: ["README.md"], evidence: ["packages"], confidence: 0.9 });
  map.anomalies.push({ id: "anomaly-copy", kind: "misplaced-shared-code", severity: "minor", detail: "apps/web copies a helper.", paths: ["apps/web/src/auth.ts"], evidence: [], confidence: 0.8 });
  writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);
  const manifestPath = join(sandbox, ".charthouse/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.documents["doc-readme"] = { path: "README.md", status: "stale", criticality: "binding", watches: ["packages"] };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const second = run("next", "--root", sandbox);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Bearing: FAIL/);
  assert.match(second.stdout, /- \[major\] anomaly-stale-readme: README\.md names a deleted package\./);
  assert.match(second.stdout, /- \[stale, binding\] README\.md/);
  assert.doesNotMatch(second.stdout, /Write the Charter/);
  assert.match(second.stdout, /1\. \[now\] doc-readme is declared stale\.\n   charthouse run "Update README\.md"/);
  assert.match(second.stdout, /\[later\] Propose a Refit for 1 structural finding \(misplaced-shared-code\)\.\n   charthouse refit propose/);

  manifest.documents["doc-notes"] = { path: "docs/notes.md", status: "stale", criticality: "informational", watches: [] };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const third = run("next", "--root", sandbox);
  assert.match(third.stdout, /\[soon\] Delete or correct 1 stale or suspect non-binding document: docs\/notes\.md\.\n   charthouse run "Delete or correct stale documents"/);
  const asJson = JSON.parse(run("next", "--json", "--root", sandbox).stdout);
  assert.equal(asJson.suggestions[0].priority, "now");
  assert.equal(asJson.findings.anomalies[0].id, "anomaly-stale-readme");
});
