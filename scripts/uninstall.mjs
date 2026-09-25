#!/usr/bin/env node
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { isCharthouseHookCommand, readClaudeSettings, writeClaudeSettings } from "./lib/claude-settings.mjs";
import { runtimeFolderState } from "./runtime-state.mjs";

// Removes a sidecar installation: the runtime, both skill adapters, and the
// Claude lifecycle hooks. It resolves paths the same way as install.sh and
// install.ps1, checks every target first, and changes nothing if a check fails.
// Repository state is never touched.

const SKILLS = ["charthouse", "charthouse-context"];
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function comparable(path) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function sameOrAncestor(parent, child) {
  const [p, c] = [comparable(parent), comparable(child)];
  return p === c || c.startsWith(p.endsWith(sep) ? p : p + sep);
}

function isRoot(path) {
  return path === parse(path).root;
}

// install.sh and install.ps1 stage a new runtime and keep the previous one
// beside it until the swap completes. An interrupted run can leave either
// behind. A matching name alone is not enough: the folder must hold a runtime
// executable. An install stopped before that copy leaves a folder to remove by hand.
function stagingLeftovers(runtime) {
  const parent = dirname(runtime);
  const prefix = basename(runtime).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${prefix}\\.(?:install|previous)-\\d+$`);
  try {
    return readdirSync(parent)
      .filter((name) => pattern.test(name))
      .map((name) => join(parent, name))
      .filter((path) => existsSync(join(path, "bin", "charthouse")));
  } catch {
    return [];
  }
}

// Remove Charthouse commands, then drop only the groups and events that this
// removal emptied. Returns the number of commands removed.
function removeCharthouseHooks(settings) {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) return 0;
  let removed = 0;
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) {
        kept.push(group);
        continue;
      }
      const remaining = group.hooks.filter((hook) => !isCharthouseHookCommand(hook?.command));
      removed += group.hooks.length - remaining.length;
      if (remaining.length === group.hooks.length) kept.push(group);
      else if (remaining.length) kept.push({ ...group, hooks: remaining });
    }
    if (!kept.length && groups.length) delete hooks[event];
    else hooks[event] = kept;
  }
  if (removed && !Object.keys(hooks).length) delete settings.hooks;
  return removed;
}

async function confirmed() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  prompt.on("SIGINT", () => {
    process.stdout.write("\nNothing changed.\n");
    process.exit(130);
  });
  // Ctrl+D closes the input without an answer. Some Node versions leave the
  // question pending when that happens, so the close event also answers no.
  const closed = new Promise((resolve) => prompt.once("close", () => resolve(null)));
  let answer = null;
  try {
    answer = await Promise.race([prompt.question("Remove Charthouse? [y/N] "), closed]);
  } catch {
    // Newer Node versions reject the question instead. That also means no.
  } finally {
    prompt.close();
  }
  if (answer === null) process.stdout.write("\n");
  return answer !== null && /^(y|yes)$/i.test(answer.trim());
}

const args = process.argv.slice(2);
const unknown = args.find((arg) => arg !== "--yes" && arg !== "-y");
if (unknown) fail(`Unknown option: ${unknown}. Usage: node scripts/uninstall.mjs [--yes]`);
const assumeYes = args.includes("--yes") || args.includes("-y");

const home = resolve(process.env.HOME || homedir());
const runtime = resolve(process.env.CHARTHOUSE_HOME || join(home, ".charthouse"));
const claude = resolve(process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"));
const sharedSkills = resolve(process.env.AGENT_SKILLS_DIR || join(home, ".agents", "skills"));
const claudeSkills = join(claude, "skills");
const legacyRuntime = join(claude, "charthouse");
const settingsPath = join(claude, "settings.json");

// The same limits as install.sh, plus the running checkout. The runtime may
// be the running copy itself; the identity check below decides that case.
if (isRoot(runtime) || sameOrAncestor(runtime, home) || sameOrAncestor(runtime, claude) || sameOrAncestor(runtime, sharedSkills)
    || (comparable(runtime) !== comparable(packageRoot) && (sameOrAncestor(runtime, packageRoot) || sameOrAncestor(packageRoot, runtime)))) {
  fail(`Unsafe CHARTHOUSE_HOME: ${runtime}. Nothing changed.`);
}
for (const directory of [claudeSkills, sharedSkills]) {
  if (isRoot(directory) || sameOrAncestor(directory, packageRoot) || sameOrAncestor(packageRoot, directory)) {
    fail(`Unsafe skill directory: ${directory}. Nothing changed.`);
  }
}

// An empty folder is left alone. Any other folder that is not a runtime stops the uninstall.
const runtimes = [...new Set([runtime, legacyRuntime])].filter((path) => {
  const state = runtimeFolderState(path);
  if (state === "other") fail(`${path} is not a Charthouse runtime. Nothing changed.`);
  return state === "runtime";
});
const leftovers = stagingLeftovers(runtime);
const skills = [...new Set([claudeSkills, sharedSkills])]
  .flatMap((directory) => SKILLS.map((name) => join(directory, name)))
  .filter((path) => existsSync(path));
let settings = null;
let hookCount = 0;
if (existsSync(settingsPath)) {
  try {
    settings = readClaudeSettings(settingsPath);
  } catch (error) {
    fail(`Charthouse cannot read ${settingsPath}: ${error.message} Nothing changed.`);
  }
  hookCount = removeCharthouseHooks(settings);
}

if (!runtimes.length && !leftovers.length && !skills.length && !hookCount) {
  process.stdout.write("Charthouse is not installed. Nothing changed.\n");
  process.exit(0);
}

const lines = ["Uninstall removes:", ...[...runtimes, ...leftovers, ...skills].map((path) => `  ${path}`)];
if (hookCount) lines.push(`  ${hookCount} Charthouse hook${hookCount === 1 ? "" : "s"} in ${settingsPath} (a backup is kept)`);
lines.push("It does not change any repository.");
process.stdout.write(`${lines.join("\n")}\n`);

if (!assumeYes) {
  if (!process.stdin.isTTY) {
    process.stdout.write("Nothing changed. Run again with --yes (PowerShell: -Yes) to remove it without a prompt.\n");
    process.exit(1);
  }
  if (!await confirmed()) {
    process.stdout.write("Nothing changed.\n");
    process.exit(0);
  }
}

// Hooks go first so that no open session calls a runtime that is already gone.
const backup = hookCount ? writeClaudeSettings(settingsPath, settings) : null;
for (const path of [...skills, ...leftovers, ...runtimes]) rmSync(path, { recursive: true, force: true });
process.stdout.write("Removed Charthouse. Restart open coding-agent sessions.\n");
if (backup) process.stdout.write(`Settings backup: ${backup}\n`);
