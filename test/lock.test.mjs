import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { projectLockPath, projectLockStatus, withProjectLock } from "../scripts/lib/lock.mjs";
import { initialize, updateMap } from "../scripts/lib/state.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(packageRoot, "test/fixtures/monorepo");
const bin = join(packageRoot, "bin/charthouse");
let sandbox;

function git(...args) {
  const result = spawnSync("git", ["-c", "user.email=charthouse@test.local", "-c", "user.name=Charthouse Test", "-c", "commit.gpgsign=false", ...args], { cwd: sandbox, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function initializeRepository() {
  git("init", "--quiet");
  git("add", "-A");
  git("commit", "--quiet", "-m", "fixture");
  git("branch", "canonical");
  return initialize(sandbox, packageRoot, { canonicalRef: "canonical" });
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "charthouse-lock-"));
  cpSync(fixture, sandbox, { recursive: true });
});

afterEach(() => {
  rmSync(dirname(projectLockPath(sandbox)), { recursive: true, force: true });
  rmSync(sandbox, { recursive: true, force: true });
});

test("the project lock reports its owner, rejects nesting, and releases", () => {
  assert.equal(projectLockStatus(sandbox), null);
  const value = withProjectLock(sandbox, "test mutation", () => {
    const status = projectLockStatus(sandbox);
    assert.equal(status.state, "active");
    assert.equal(status.operation, "test mutation");
    assert.equal(status.pid, process.pid);
    assert.equal(status.host, hostname());
    assert.equal("token" in status, false);
    assert.throws(
      () => withProjectLock(sandbox, "nested mutation", () => null, { timeoutMs: 0 }),
      /Nested state mutation is not allowed/
    );
    return 42;
  });
  assert.equal(value, 42);
  assert.equal(projectLockStatus(sandbox), null);
});

test("doctor reports the current project-state writer without exposing its token", () => {
  withProjectLock(sandbox, "held for doctor", () => {
    const result = spawnSync(process.execPath, [bin, "doctor", "--root", sandbox, "--json"], {
      cwd: sandbox,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    const lock = JSON.parse(result.stdout).project_lock;
    assert.equal(lock.state, "active");
    assert.equal(lock.operation, "held for doctor");
    assert.equal(lock.pid, process.pid);
    assert.equal(lock.path, projectLockPath(sandbox));
    assert.equal("token" in lock, false);
    const refused = spawnSync(process.execPath, [bin, "doctor", "--clear-stale-lock", "--root", sandbox], { cwd: sandbox, encoding: "utf8" });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /cannot clear the active lock/);
  });
});

test("the project lock releases when a mutation fails", () => {
  assert.throws(
    () => withProjectLock(sandbox, "failing mutation", () => { throw new Error("fixture failure"); }),
    /fixture failure/
  );
  assert.equal(projectLockStatus(sandbox), null);
  assert.equal(withProjectLock(sandbox, "retry", () => "ok"), "ok");
});

test("a dead local owner is reported as stale and is not removed automatically", () => {
  const path = projectLockPath(sandbox);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({
    schema_version: 1,
    token: "stale-test-token",
    pid: 2147483647,
    host: hostname(),
    operation: "interrupted update",
    acquired_at: "2026-01-01T00:00:00.000Z"
  }, null, 2)}\n`);
  assert.equal(projectLockStatus(sandbox).state, "stale");
  assert.throws(
    () => withProjectLock(sandbox, "new update", () => null, { timeoutMs: 0 }),
    /charthouse doctor --clear-stale-lock/
  );
  const cleared = spawnSync(process.execPath, [bin, "doctor", "--clear-stale-lock", "--root", sandbox, "--json"], { cwd: sandbox, encoding: "utf8" });
  assert.equal(cleared.status, 0, cleared.stderr);
  const result = JSON.parse(cleared.stdout);
  assert.equal(result.lock_cleanup.cleared, true);
  assert.equal(result.project_lock, null);
  assert.equal(withProjectLock(sandbox, "new update", () => "ok"), "ok");
});

test("state mutators hold the lock across the complete Map update", () => {
  initializeRepository();
  const before = readFileSync(join(sandbox, ".charthouse/map.json"), "utf8");
  withProjectLock(sandbox, "other writer", () => {
    assert.throws(() => updateMap(sandbox), /Nested state mutation is not allowed/);
  });
  assert.equal(readFileSync(join(sandbox, ".charthouse/map.json"), "utf8"), before);
  assert.equal(projectLockStatus(sandbox), null);
});

function changedHook(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [bin, "hook", "changed", "--root", sandbox], {
      cwd: sandbox,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(stderr || `hook exited ${code}`));
    });
    child.stdin.end(JSON.stringify({ tool_input: { file_path: path } }));
  });
}

test("concurrent hooks do not lose changed paths", async () => {
  initializeRepository();
  const paths = Array.from({ length: 20 }, (_, index) => `apps/web/src/concurrent-${index}.ts`);
  await Promise.all(paths.map(changedHook));
  const queue = JSON.parse(readFileSync(join(sandbox, ".charthouse/changed-paths.json"), "utf8"));
  assert.deepEqual(queue.paths, [...paths].sort());
  assert.equal(projectLockStatus(sandbox), null);
});
