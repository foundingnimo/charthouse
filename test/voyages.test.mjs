import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { acceptAllSurveys } from "./helpers/surveys.mjs";
import { normalizeVoyagePath, validateVoyage, voyagePathsOverlap } from "../scripts/lib/voyages.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(packageRoot, "test/fixtures/monorepo");
const bin = join(packageRoot, "bin/charthouse");
let sandbox;

function run(...args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: sandbox, encoding: "utf8" });
}

function ok(...args) {
  const result = run(...args);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function json(...args) {
  return JSON.parse(ok(...args, "--root", sandbox, "--json").stdout);
}

function git(...args) {
  const result = spawnSync("git", ["-c", "user.email=charthouse@test.local", "-c", "user.name=Charthouse Test", "-c", "commit.gpgsign=false", ...args], { cwd: sandbox, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function commitAll(message) {
  git("add", "-A");
  git("commit", "--quiet", "--allow-empty", "-m", message);
  return git("rev-parse", "HEAD");
}

function configureCanonical(ref) {
  const path = join(sandbox, ".charthouse/config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  config.git = { canonical_ref: ref };
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

function approveAllCapabilities() {
  acceptAllSurveys(sandbox, run);
  const path = join(sandbox, ".charthouse/map.json");
  const map = JSON.parse(readFileSync(path, "utf8"));
  map.capabilities = map.capabilities.map((capability) => ({
    ...capability,
    approved: true,
    provenance: "human-approved"
  }));
  writeFileSync(path, `${JSON.stringify(map, null, 2)}\n`);
  ok("navigator", "regenerate", "all", "--root", sandbox);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "charthouse-voyage-"));
  cpSync(fixture, sandbox, { recursive: true });
  git("init", "--quiet");
  commitAll("fixture");
  git("branch", "canonical");
  ok("init", "--canonical-ref", "canonical", "--root", sandbox);
  approveAllCapabilities();
  commitAll("initialize Charthouse");
  git("branch", "-f", "canonical", "HEAD");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

test("starting a Voyage creates a durable planning record with predicted scope", () => {
  const head = git("rev-parse", "HEAD");
  const result = json("run", "Change auth token lifecycle");
  const voyage = result.voyage;
  assert.equal(result.outcome, "Voyage created for planning");
  assert.equal(voyage.id, "V-0001");
  assert.equal(voyage.status, "planning");
  assert.equal(voyage.baseline.commit, head);
  assert.equal(voyage.baseline.dirty, false);
  assert.equal(voyage.baseline.canonical_ref, "canonical");
  assert.equal(voyage.baseline.canonical_commit, head);
  assert.deepEqual(voyage.proposed_paths, ["packages/auth/**"]);
  assert.ok(voyage.navigators.some((name) => name.toLowerCase().includes("auth")));
  assert.equal(voyage.plan_path, "docs/charthouse/chronicles/V-0001/plan.md");
  assert.match(result.next.join("\n"), /charthouse run activate V-0001/);
  assert.equal(existsSync(join(sandbox, ".charthouse/voyages/V-0001.json")), true);
  assert.deepEqual(json("run", "status", "V-0001"), voyage);

  const second = json("run", "Change web entrypoint").voyage;
  assert.equal(second.id, "V-0002");
  const status = json("run", "status");
  assert.equal(status.summary.planning, 2);
  assert.deepEqual(status.voyages.map((item) => item.id), ["V-0001", "V-0002"]);

  const legacy = structuredClone(voyage);
  delete legacy.baseline.canonical_ref;
  delete legacy.baseline.canonical_commit;
  assert.doesNotThrow(() => validateVoyage(legacy));
});

test("Voyages record canonical evidence and guard later lifecycle changes", () => {
  configureCanonical("base");
  commitAll("configure canonical history");
  git("branch", "base");
  const head = git("rev-parse", "HEAD");
  const voyage = json("run", "Change auth token lifecycle").voyage;
  assert.equal(voyage.baseline.canonical_ref, "base");
  assert.equal(voyage.baseline.canonical_commit, head);
  json("run", "activate", voyage.id);

  const canonicalCommit = git("commit-tree", `${head}^{tree}`, "-p", head, "-m", "Canonical advanced");
  git("update-ref", "refs/heads/base", canonicalCommit);
  const refused = run("run", "finish", voyage.id, "--root", sandbox);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /canonical branch base: 1 commit behind/);
  const finished = json("run", "finish", voyage.id, "--allow-behind").voyage;
  assert.equal(finished.status, "completed");
  assert.equal(finished.allow_behind, true);
});

test("activation follows plan approval and lifecycle commands release the lease", () => {
  const first = json("run", "Change auth token lifecycle").voyage;
  const activated = json("run", "activate", first.id).voyage;
  assert.equal(activated.status, "active");
  assert.equal(activated.scope_source, "predicted");
  assert.deepEqual(activated.leased_paths, ["packages/auth/**"]);
  assert.ok(activated.activated_at);

  const resumed = json("run", "resume", first.id).voyage;
  assert.equal(resumed.history.at(-1).event, "resumed");
  assert.match(ok("hook", "session-start", "--root", sandbox).stdout, /1 active Voyage; run \/charthouse run status/);

  const overlapping = json("run", "Another auth change").voyage;
  const conflict = run("run", "activate", overlapping.id, "--path", "packages/auth/src/**", "--root", sandbox);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /overlaps active V-0001/);

  const completed = json("run", "finish", first.id).voyage;
  assert.equal(completed.status, "completed");
  assert.ok(completed.closed_at);
  assert.equal(completed.final_commit, git("rev-parse", "HEAD"));

  const next = json("run", "activate", overlapping.id, "--path", "packages/auth/src/**").voyage;
  assert.equal(next.status, "active");
  const abandoned = json("run", "abandon", overlapping.id, "--reason", "The ticket was withdrawn.").voyage;
  assert.equal(abandoned.status, "abandoned");
  assert.equal(abandoned.abandonment_reason, "The ticket was withdrawn.");
  assert.equal(json("status").voyages.active, 0);
});

test("an objective with no predicted scope needs explicit approved paths", () => {
  const voyage = json("run", "xyzzy quux frobnicate").voyage;
  assert.deepEqual(voyage.proposed_paths, []);
  const refused = run("run", "activate", voyage.id, "--root", sandbox);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /has no predicted path scope/);
  const activated = json("run", "activate", voyage.id, "--path", "docs/guide.md", "--path", "apps/web/src").voyage;
  assert.equal(activated.scope_source, "explicit");
  assert.deepEqual(activated.leased_paths, ["apps/web/src", "docs/guide.md"]);
});

test("Voyage paths are repository-relative and overlap conservatively", () => {
  assert.equal(normalizeVoyagePath("./apps/web/**"), "apps/web/**");
  assert.equal(normalizeVoyagePath("apps/./web/**"), "apps/web/**");
  assert.equal(voyagePathsOverlap("apps/web/**", "apps/web/src/index.ts"), true);
  assert.equal(voyagePathsOverlap("apps/web/**", "packages/auth/**"), false);
  assert.equal(voyagePathsOverlap("apps/web/src/a.ts", "apps/web/src/b.ts"), false);
  assert.equal(voyagePathsOverlap("apps/*/src/**", "apps/web/test/**"), true);
  assert.throws(() => normalizeVoyagePath("../outside"), /stay inside/);
  assert.throws(() => normalizeVoyagePath("apps\\..\\outside"), /stay inside/);
  assert.throws(() => normalizeVoyagePath("/tmp/outside"), /repository-relative/);
  assert.throws(() => normalizeVoyagePath("C:outside"), /repository-relative/);
});

function activateProcess(id, path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [bin, "run", "activate", id, "--path", path, "--root", sandbox, "--json"], {
      cwd: sandbox,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}

test("independent processes serialize overlapping and non-overlapping activations", async () => {
  const first = json("run", "first unscoped objective").voyage;
  const second = json("run", "second unscoped objective").voyage;
  const overlapping = await Promise.all([
    activateProcess(first.id, "packages/auth/**"),
    activateProcess(second.id, "packages/auth/src/**")
  ]);
  assert.deepEqual(overlapping.map((item) => item.status).sort(), [0, 1]);
  assert.match(overlapping.find((item) => item.status === 1).stderr, /overlaps active/);
  const winner = json("run", "status").voyages.find((item) => item.status === "active");
  json("run", "abandon", winner.id, "--reason", "Concurrency fixture cleanup.");

  const third = json("run", "third unscoped objective").voyage;
  const fourth = json("run", "fourth unscoped objective").voyage;
  const separate = await Promise.all([
    activateProcess(third.id, "packages/auth/**"),
    activateProcess(fourth.id, "apps/web/**")
  ]);
  assert.deepEqual(separate.map((item) => item.status), [0, 0]);
  assert.equal(json("run", "status").summary.active, 2);
});
