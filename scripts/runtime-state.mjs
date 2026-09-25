#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The installers and the uninstaller delete the folder at the runtime path, so
// they first ask what it holds. Run directly, this prints the state of one path:
//   node scripts/runtime-state.mjs <path>

const PACKAGE_NAME = "@foundingnimo/charthouse";

// An installed runtime has the package name, the executable, and an install
// stamp. A source checkout also has the package name, so Git metadata rules it out.
export function isCharthouseRuntime(directory) {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    return manifest.name === PACKAGE_NAME
      && existsSync(join(directory, "bin", "charthouse"))
      && existsSync(join(directory, ".install.json"))
      && !existsSync(join(directory, ".git"));
  } catch {
    return false;
  }
}

// Returns "missing", "empty", "runtime", or "other". Only "other" is unsafe to delete.
export function runtimeFolderState(path) {
  if (!existsSync(path)) return "missing";
  if (isCharthouseRuntime(path)) return "runtime";
  try {
    if (statSync(path).isDirectory() && readdirSync(path).length === 0) return "empty";
  } catch {
    // An unreadable folder is not safe to replace.
  }
  return "other";
}

function runDirectly() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runDirectly()) {
  if (!process.argv[2]) {
    process.stderr.write("Usage: node scripts/runtime-state.mjs <path>\n");
    process.exit(1);
  }
  process.stdout.write(runtimeFolderState(resolve(process.argv[2])));
}
