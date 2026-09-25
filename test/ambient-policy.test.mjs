import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ambient = readFileSync(resolve(packageRoot, "skills/charthouse/references/ambient.md"), "utf8");
const contextSkill = readFileSync(resolve(packageRoot, "skills/charthouse-context/SKILL.md"), "utf8");
const specification = readFileSync(resolve(packageRoot, "docs/SPEC.md"), "utf8");

test("ambient reconciliation remains authorized during read-only repository work", () => {
  assert.match(ambient, /Do not skip reconciliation because it writes Charthouse-owned derived\s+state/);
  assert.match(ambient, /timestamp comparison[\s\S]+is not a substitute for reconciliation/);
  assert.match(specification, /Ambient reconciliation is an authorized Charthouse-state write/);
});

test("an explicit no-write request uses reconciliation preview instead of skipping", () => {
  assert.match(ambient, /explicitly forbids all repository writes[\s\S]+`charthouse reconcile --dry-run --json`/);
  assert.match(ambient, /do not say that reconciliation was skipped/);
  assert.match(specification, /explicit instruction to make no repository writes overrides ambient\s+maintenance/);
  assert.match(specification, /does not update the Map, generated views, change queue,\s+fingerprints, or reconciliation metadata/);
});

test("ambient output hides routine bookkeeping", () => {
  assert.match(ambient, /Do not report that `brief` wrote nothing/);
  assert.match(ambient, /Do not show routine command output unless it changes the answer/);
  assert.match(specification, /Routine successful maintenance stays out of\s+the answer/);
});

test("a contradicted or ambiguous premise stops at one decision gate", () => {
  assert.match(ambient, /stop after the concise evidence\s+and one focused decision question/);
  assert.match(ambient, /Do not produce paths, risks, checks, or an\s+implementation plan for an assumed interpretation/);
  assert.match(specification, /Detailed briefing resumes after the user confirms/);
});

test("every substantive answer must pass the pre-response gate", () => {
  assert.match(contextSkill, /Before every substantive answer, run the mandatory pre-response gate/);
  assert.match(contextSkill, /Do not send the answer until every applicable gate item\s+passes/);
  assert.match(ambient, /## Mandatory pre-response gate/);
  assert.match(ambient, /immediately before every substantive answer/);
  assert.match(ambient, /If one item fails, revise\s+the draft and run the gate again/);
  assert.match(ambient, /ownership and specialist lists, path\s+inventories, risks, verification checks, speculative implementation/);
  assert.match(ambient, /Do not say that no files changed/);
  assert.match(specification, /Every Brief carries a mandatory pre-response gate/);
  assert.match(specification, /Contribution handling does not add\s+a second question/);
});

test("verification guidance removes checks covered by another package script", () => {
  assert.match(ambient, /do not list\s+`type-check` or `lint` separately when the selected `test` script runs both/);
  assert.match(ambient, /only from the current package manifest/);
  assert.match(specification, /removes an npm script command\s+when another selected command for the same current package manifest invokes/);
});

test("ambient Charthouse records only safe new upstream improvement candidates", () => {
  assert.match(ambient, /Charthouse defect, repeated workaround, missing\s+reusable operation/);
  assert.match(ambient, /Offer to prepare a GitHub suggestion or code pull\s+request only when the candidate is new/);
  assert.match(ambient, /Do not put repository names, absolute paths, tickets, product code, raw logs/);
  assert.match(specification, /Candidate records are private user state outside the target repository and\s+installed runtime/);
  assert.match(specification, /Creating an issue, branch, commit, push, or pull request is an external change\s+and needs explicit authorization/);
});
