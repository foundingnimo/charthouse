import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { contributionLockPath, contributionStatePath, loadContributionLog } from "../scripts/lib/contributions.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(packageRoot, "bin/charthouse");
let sandbox;
let environment;

function run(...args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: sandbox, encoding: "utf8", env: environment });
}

function record(overrides = {}) {
  const values = {
    key: "read-only-reconcile",
    type: "enhancement",
    title: "Preview reconciliation without writes",
    observed: "An explicit no-write request prevents ambient reconciliation.",
    expected: "Charthouse reports pending reconciliation without changing repository state.",
    source: "ambient",
    ...overrides
  };
  return run(
    "contribute", "record",
    "--key", values.key,
    "--type", values.type,
    "--title", values.title,
    "--observed", values.observed,
    "--expected", values.expected,
    "--source", values.source,
    "--json"
  );
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "charthouse-contribution-test-"));
  environment = { ...process.env, HOME: sandbox, CHARTHOUSE_STATE_HOME: join(sandbox, "state") };
});

afterEach(() => {
  rmSync(dirname(contributionLockPath(environment)), { recursive: true, force: true });
  rmSync(sandbox, { recursive: true, force: true });
});

test("contribution candidates work before repository initialization and deduplicate", () => {
  const first = record();
  assert.equal(first.status, 0, first.stderr);
  const created = JSON.parse(first.stdout);
  assert.equal(created.outcome, "created");
  assert.equal(created.improvement.id, "MI-0001");

  const second = record();
  assert.equal(second.status, 0, second.stderr);
  const updated = JSON.parse(second.stdout);
  assert.equal(updated.outcome, "updated");
  assert.equal(updated.improvement.occurrences, 2);

  const path = contributionStatePath(environment);
  assert.ok(path.startsWith(environment.CHARTHOUSE_STATE_HOME));
  assert.equal(loadContributionLog(environment).improvements.length, 1);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).improvements[0].occurrences, 2);
});

test("contribution previews support a suggestion or pull request without external writes", () => {
  assert.equal(record().status, 0);
  const suggestion = JSON.parse(run("contribute", "preview", "MI-0001", "--as", "suggestion", "--json").stdout);
  assert.equal(suggestion.repository, "foundingnimo/charthouse");
  assert.equal(suggestion.external_write_required, true);
  assert.match(suggestion.title, /^Suggestion:/);
  assert.match(suggestion.body, /must not contain target-repository code/);

  const pr = JSON.parse(run("contribute", "preview", "MI-0001", "--as", "pr", "--json").stdout);
  assert.match(pr.title, /^feat:/);
  assert.match(pr.body, /npm test/);
  assert.ok(pr.body.includes("`npm run validate`"));
  assert.equal(loadContributionLog(environment).improvements[0].status, "candidate");
});

test("contribution state records dismissal and successful upstream submission", () => {
  assert.equal(record().status, 0);
  const dismissed = run("contribute", "dismiss", "MI-0001", "--reason", "Not general enough", "--json");
  assert.equal(dismissed.status, 0, dismissed.stderr);
  assert.equal(JSON.parse(dismissed.stdout).status, "dismissed");
  const suppressed = JSON.parse(record().stdout);
  assert.equal(suppressed.recorded, false);
  assert.equal(suppressed.outcome, "dismissed");

  assert.equal(record({ key: "bounded-output", title: "Bound contribution output" }).status, 0);
  const submitted = run(
    "contribute", "submitted", "MI-0002", "--as", "suggestion",
    "--url", "https://github.com/foundingnimo/charthouse/issues/42", "--json"
  );
  assert.equal(submitted.status, 0, submitted.stderr);
  assert.equal(JSON.parse(submitted.stdout).status, "submitted");
  assert.equal(run("contribute", "preview", "MI-0002", "--as", "pr").status, 1);
});

test("contribution records reject private paths, credentials, and unrelated submission URLs", () => {
  const privatePath = record({ observed: "Failed in /private/company/repository." });
  assert.equal(privatePath.status, 1);
  assert.match(privatePath.stderr, /must not contain an absolute path/);

  const credential = record({ observed: "The token was ghp_abcdefghijklmnopqrstuvwxyz123456." });
  assert.equal(credential.status, 1);
  assert.match(credential.stderr, /credential or secret/);

  assert.equal(record().status, 0);
  const wrongRepository = run(
    "contribute", "submitted", "MI-0001", "--as", "pr",
    "--url", "https://github.com/example/private/pull/9"
  );
  assert.equal(wrongRepository.status, 1);
  assert.match(wrongRepository.stderr, /foundingnimo\/charthouse/);
});

test("contribution doctor safely clears a stale private-state lock", () => {
  const path = contributionLockPath(environment);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify({
    schema_version: 1,
    token: "stale-contribution-test-token",
    pid: 2147483647,
    host: hostname(),
    operation: "interrupted contribution update",
    acquired_at: "2026-01-01T00:00:00.000Z"
  }, null, 2)}\n`);

  const refused = record();
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /charthouse contribute doctor --clear-stale-lock/);

  const cleared = run("contribute", "doctor", "--clear-stale-lock", "--json");
  assert.equal(cleared.status, 0, cleared.stderr);
  const report = JSON.parse(cleared.stdout);
  assert.equal(report.lock_cleanup.cleared, true);
  assert.equal(report.contribution_lock, null);
  assert.equal(record().status, 0);
});
