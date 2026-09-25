#!/usr/bin/env node
// Token-efficiency benchmark: the same tasks in two isolated Claude Code
// environments, one plain and one with Charthouse. See README.md.
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderReport, runMetrics, summarize } from "./lib.mjs";

const CHARTHOUSE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONDITIONS = ["base", "charthouse"];
const BRANCH = "bench";
// Hooks rewrite these on every session start. The benchmark restores them so
// that every trial starts from the same reconciled state.
const RECONCILIATION_FILES = [".charthouse/reconciliation.json", ".charthouse/changed-paths.json"];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function options(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) fail(`Unexpected argument: ${key}`);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) values[key.slice(2)] = true;
    else { values[key.slice(2)] = next; index += 1; }
  }
  return values;
}

function sh(command, args, { cwd, env = process.env, allowFailure = false, timeout } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout });
  if (!allowFailure && result.status !== 0) fail(`${command} ${args.join(" ")} failed in ${cwd}:\n${result.stderr || result.stdout}`);
  return result;
}

const git = (cwd, ...args) => sh("git", ["-c", "user.name=Charthouse Bench", "-c", "user.email=bench@charthouse.local", "-c", "commit.gpgsign=false", ...args], { cwd });

function paths(work) {
  return {
    work,
    state: join(work, "bench.json"),
    clone: (condition) => join(work, condition),
    config: (condition) => join(work, "config", condition),
    runtime: join(work, "runtime"),
    agentSkills: join(work, "agent-skills"),
    snapshot: join(work, "reconciliation-snapshot"),
    setup: join(work, "setup.json"),
    results: join(work, "results.jsonl"),
    report: join(work, "report.md")
  };
}

function readState(work) {
  const file = paths(work).state;
  if (!existsSync(file)) fail(`No benchmark in ${work}. Run \`prepare\` first.`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function claudeEnv(condition, work) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: paths(work).config(condition) };
  // The skills prefer `charthouse` on PATH, so the benchmark's own runtime comes
  // first. Otherwise they could fall back to an installed ~/.charthouse.
  if (condition === "charthouse") env.PATH = `${join(paths(work).runtime, "bin")}:${process.env.PATH}`;
  return env;
}

function claude(condition, work, prompt, { model, maxTurns, budget, timeoutMinutes }) {
  const args = ["-p", prompt, "--output-format", "json", "--model", model, "--permission-mode", "bypassPermissions", "--no-session-persistence", "--strict-mcp-config"];
  if (maxTurns) args.push("--max-turns", String(maxTurns));
  if (budget) args.push("--max-budget-usd", String(budget));
  const started = Date.now();
  const result = sh("claude", args, { cwd: paths(work).clone(condition), env: claudeEnv(condition, work), allowFailure: true, timeout: timeoutMinutes * 60 * 1000 });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch {}
  return { json, status: result.status, stderr: (result.stderr || "").slice(0, 2000), wall_ms: Date.now() - started };
}

function prepare(values) {
  const work = resolve(values.work || fail("--work <dir> is required."));
  const repo = values.repo || fail("--repo <path or URL> is required.");
  const ref = values.ref || "HEAD";
  const p = paths(work);
  if (existsSync(p.state)) fail(`${work} already holds a benchmark. Use a new --work directory.`);
  mkdirSync(work, { recursive: true });
  for (const condition of CONDITIONS) {
    sh("git", ["clone", "--quiet", repo, p.clone(condition)], { cwd: work });
    git(p.clone(condition), "checkout", "--quiet", "-B", BRANCH, ref);
    mkdirSync(p.config(condition), { recursive: true });
    // A login made before prepare keeps its settings; the installer adds hooks to them.
    if (!existsSync(join(p.config(condition), "settings.json"))) writeFileSync(join(p.config(condition), "settings.json"), "{}\n");
  }
  const commit = git(p.clone("base"), "rev-parse", "HEAD").stdout.trim();
  // The Charthouse environment gets the sidecar skills and lifecycle hooks, and nothing else.
  sh("sh", [join(CHARTHOUSE_ROOT, "install.sh"), "--host", "claude", "--yes"], {
    cwd: CHARTHOUSE_ROOT,
    env: { ...process.env, CLAUDE_CONFIG_DIR: p.config("charthouse"), CHARTHOUSE_HOME: p.runtime, AGENT_SKILLS_DIR: p.agentSkills }
  });
  // Results belong to one Charthouse build, so record which one this checkout installed.
  const charthouse = {
    version: JSON.parse(readFileSync(join(CHARTHOUSE_ROOT, "package.json"), "utf8")).version,
    commit: git(CHARTHOUSE_ROOT, "rev-parse", "--short", "HEAD").stdout.trim(),
    dirty: git(CHARTHOUSE_ROOT, "status", "--porcelain").stdout.trim() !== ""
  };
  writeFileSync(p.state, `${JSON.stringify({ repo, ref, commit, charthouse, charthouse_commit: null, created_at: new Date().toISOString() }, null, 2)}\n`);
  process.stdout.write(`Prepared ${work} at ${commit}.\nNext: log in once per environment (see README), then run \`check-auth\`.\n`);
}

function checkAuth(values) {
  const work = resolve(values.work || fail("--work <dir> is required."));
  readState(work);
  for (const condition of CONDITIONS) {
    const run = claude(condition, work, "Reply with the single word OK.", { model: values.model || "haiku", maxTurns: 1, timeoutMinutes: 2 });
    const ok = run.json && run.json.is_error === false;
    process.stdout.write(`${condition}: ${ok ? `ready (${run.json.result})` : `not ready: ${run.stderr || run.json?.result || "no JSON"}`}\n`);
  }
}

function snapshotReconciliation(work) {
  const p = paths(work);
  mkdirSync(p.snapshot, { recursive: true });
  for (const file of RECONCILIATION_FILES) {
    const source = join(p.clone("charthouse"), file);
    if (existsSync(source)) copyFileSync(source, join(p.snapshot, file.replace(/\//g, "__")));
  }
}

// Commit the published Charthouse state so that every trial resets to it.
function recordCharthouseState(work, setupCost) {
  const p = paths(work);
  const clone = p.clone("charthouse");
  const status = JSON.parse(sh("node", [join(p.runtime, "bin/charthouse"), "status", "--root", clone, "--json"], { cwd: clone }).stdout);
  if (status.publication?.map !== "published") fail(`The Charthouse Map is not published (${status.publication?.map}). Finish the Expedition first.`);
  appendFileSync(join(clone, ".git/info/exclude"), `\n${RECONCILIATION_FILES.join("\n")}\n`);
  git(clone, "add", "-A");
  git(clone, "commit", "--quiet", "--allow-empty", "-m", "Charthouse state for the benchmark");
  sh("node", [join(p.runtime, "bin/charthouse"), "reconcile", "--root", clone], { cwd: clone });
  snapshotReconciliation(work);
  const state = readState(work);
  state.charthouse_commit = git(clone, "rev-parse", "HEAD").stdout.trim();
  writeFileSync(p.state, `${JSON.stringify(state, null, 2)}\n`);
  if (setupCost !== undefined) writeFileSync(p.setup, `${JSON.stringify({ cost_usd: setupCost, recorded_at: new Date().toISOString() }, null, 2)}\n`);
  process.stdout.write(`Recorded the Charthouse state at ${state.charthouse_commit}.\n`);
}

function setup(values) {
  const work = resolve(values.work || fail("--work <dir> is required."));
  readState(work);
  const p = paths(work);
  if (values.record) {
    recordCharthouseState(work, values.cost === undefined ? null : Number(values.cost));
    return;
  }
  if (values.manual) {
    process.stdout.write([
      "Run the first Expedition yourself, then record it:",
      `  cd ${p.clone("charthouse")}`,
      `  PATH=${join(p.runtime, "bin")}:$PATH CLAUDE_CONFIG_DIR=${p.config("charthouse")} claude`,
      `  /charthouse init   (choose the branch "${BRANCH}", finish the Expedition, approve, publish)`,
      `  node ${fileURLToPath(import.meta.url)} setup --work ${work} --record --cost <session cost in USD>`,
      ""
    ].join("\n"));
    return;
  }
  // The command skill is user-invoked only, so the prompt must start with the
  // slash command for Claude Code to expand it.
  const prompt = [
    `/charthouse init --canonical-ref ${BRANCH}`,
    "Complete the whole first Expedition in this repository. This is an automated benchmark with no human at the Map gate:",
    "the operator approves every proposed capability boundary as proposed. Record that approval with",
    "`charthouse expedition approve <id> --all`, publish with `charthouse navigator regenerate all`, and do not ask questions."
  ].join(" ");
  const run = claude("charthouse", work, prompt, { model: values.model || "sonnet", maxTurns: Number(values["max-turns"] || 200), budget: values.budget, timeoutMinutes: Number(values["timeout-minutes"] || 90) });
  if (!run.json) fail(`The setup session printed no result JSON.\n${run.stderr}`);
  const metrics = runMetrics(run.json);
  writeFileSync(p.setup, `${JSON.stringify({ ...metrics, recorded_at: new Date().toISOString(), result: String(run.json.result || "").slice(0, 2000) }, null, 2)}\n`);
  recordCharthouseState(work);
  process.stdout.write(`First Expedition cost $${metrics.cost_usd.toFixed(4)} and ${metrics.tokens} tokens.\n`);
}

function resetClone(work, condition, state) {
  const p = paths(work);
  const clone = p.clone(condition);
  const target = condition === "charthouse" ? state.charthouse_commit : state.commit;
  git(clone, "reset", "--quiet", "--hard", target);
  git(clone, "clean", "-fdq");
  if (condition !== "charthouse") return;
  for (const file of RECONCILIATION_FILES) {
    const saved = join(p.snapshot, file.replace(/\//g, "__"));
    if (existsSync(saved)) copyFileSync(saved, join(clone, file));
  }
}

function changedPaths(clone) {
  const tracked = git(clone, "diff", "--name-only", "HEAD").stdout.split("\n");
  const untracked = git(clone, "ls-files", "--others", "--exclude-standard").stdout.split("\n");
  return new Set([...tracked, ...untracked].filter(Boolean));
}

// Every configured check must pass. A task without checks counts as a success
// when the session itself finished without an error.
function checkTask(task, clone, answer, metrics) {
  const check = task.check || {};
  const failures = [];
  for (const value of check.answer_includes || []) {
    if (!answer.toLowerCase().includes(String(value).toLowerCase())) failures.push(`answer lacks "${value}"`);
  }
  if (check.changed_paths) {
    const changed = changedPaths(clone);
    for (const path of check.changed_paths) if (!changed.has(path)) failures.push(`${path} did not change`);
  }
  if (check.command) {
    const result = sh("sh", ["-c", check.command], { cwd: clone, allowFailure: true, timeout: 10 * 60 * 1000 });
    if (result.status !== 0) failures.push(`\`${check.command}\` exited ${result.status}`);
  }
  if (metrics.failed) failures.push("the session ended with an error");
  return { success: failures.length === 0, failures };
}

// A small seeded shuffle, so that a run order can be repeated.
function shuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), value | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function spentSoFar(work) {
  const p = paths(work);
  const setupCost = existsSync(p.setup) ? Number(JSON.parse(readFileSync(p.setup, "utf8")).cost_usd) || 0 : 0;
  const trials = existsSync(p.results)
    ? readFileSync(p.results, "utf8").split("\n").filter(Boolean).reduce((sum, line) => sum + (Number(JSON.parse(line).metrics?.cost_usd) || 0), 0)
    : 0;
  return setupCost + trials;
}

function run(values) {
  const work = resolve(values.work || fail("--work <dir> is required."));
  const state = readState(work);
  const totalBudget = values["total-budget"] === undefined ? null : Number(values["total-budget"]);
  const sessionBudget = values.budget === undefined ? null : Number(values.budget);
  if (totalBudget !== null && sessionBudget === null) fail("--total-budget needs --budget, the cap for each session.");
  if (!state.charthouse_commit) fail("The Charthouse environment has no recorded state. Run `setup` first.");
  const tasks = JSON.parse(readFileSync(resolve(values.tasks || fail("--tasks <file> is required.")), "utf8"));
  const rounds = Number(values.runs || 3);
  const random = seeded(Number(values.seed || 1));
  const settings = { model: values.model || "sonnet", maxTurns: Number(values["max-turns"] || 60), budget: values.budget, timeoutMinutes: Number(values["timeout-minutes"] || 30) };
  for (let round = 1; round <= rounds; round += 1) {
    for (const task of shuffle(tasks, random)) {
      // Alternate the order of the two environments so that neither always runs first.
      for (const condition of shuffle(CONDITIONS, random)) {
        // Stop before a session that could take the whole run past its cap.
        if (totalBudget !== null && spentSoFar(work) + sessionBudget > totalBudget) {
          process.stdout.write(`Stopped: $${spentSoFar(work).toFixed(2)} spent; another session could pass the $${totalBudget} cap.\n`);
          return;
        }
        resetClone(work, condition, state);
        const session = claude(condition, work, task.prompt, settings);
        const metrics = session.json ? runMetrics(session.json) : { failed: true };
        const answer = String(session.json?.result || "");
        const verdict = checkTask(task, paths(work).clone(condition), answer, metrics);
        const record = {
          task: task.id,
          condition,
          round,
          model: settings.model,
          started_at: new Date(Date.now() - session.wall_ms).toISOString(),
          wall_ms: session.wall_ms,
          success: verdict.success,
          failures: verdict.failures,
          metrics,
          answer: answer.slice(0, 1500),
          stderr: session.json ? undefined : session.stderr
        };
        appendFileSync(paths(work).results, `${JSON.stringify(record)}\n`);
        process.stdout.write(`round ${round} ${task.id} ${condition}: ${verdict.success ? "pass" : "FAIL"} $${(metrics.cost_usd ?? 0).toFixed(4)} ${metrics.tokens ?? "?"} tokens\n`);
      }
    }
  }
}

function report(values) {
  const work = resolve(values.work || fail("--work <dir> is required."));
  const p = paths(work);
  if (!existsSync(p.results)) fail(`No results in ${work}. Run \`run\` first.`);
  const records = readFileSync(p.results, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const setupCost = existsSync(p.setup) ? JSON.parse(readFileSync(p.setup, "utf8")).cost_usd ?? null : null;
  const text = renderReport(summarize(records, { setupCostUsd: setupCost }));
  writeFileSync(p.report, text);
  process.stdout.write(text);
}

const [command, ...rest] = process.argv.slice(2);
const commands = { prepare, "check-auth": checkAuth, setup, run, report };
if (!commands[command]) fail(`Usage: node run.mjs <${Object.keys(commands).join("|")}> --work <dir> [options]. See README.md.`);
commands[command](options(rest));
