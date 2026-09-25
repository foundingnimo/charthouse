#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const claudeDirectory = process.argv[2] ? resolve(process.argv[2]) : null;
const runtimeDirectory = process.argv[3] ? resolve(process.argv[3]) : null;
if (!claudeDirectory) {
  process.stderr.write("A Claude configuration directory is required.\n");
  process.exit(1);
}
if (!runtimeDirectory) {
  process.stderr.write("A Charthouse runtime directory is required.\n");
  process.exit(1);
}

mkdirSync(claudeDirectory, { recursive: true });
const settingsPath = join(claudeDirectory, "settings.json");
let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    process.stderr.write(`Charthouse did not change ${settingsPath}: ${error.message}\n`);
    process.exit(1);
  }
}
if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
  process.stderr.write(`Charthouse did not change ${settingsPath}: the settings root must be an object.\n`);
  process.exit(1);
}

const executable = join(runtimeDirectory, "bin", "charthouse");
const quotedExecutable = executable.replace(/\\/g, "/").replace(/"/g, "\\\"");
const commands = {
  SessionStart: `node "${quotedExecutable}" hook session-start`,
  PostToolUse: `node "${quotedExecutable}" hook changed`,
  Stop: `node "${quotedExecutable}" hook stop`
};
const groups = {
  SessionStart: { hooks: [{ type: "command", command: commands.SessionStart, timeout: 120 }] },
  PostToolUse: { matcher: "Edit|Write|MultiEdit|NotebookEdit", hooks: [{ type: "command", command: commands.PostToolUse, timeout: 10 }] },
  Stop: { hooks: [{ type: "command", command: commands.Stop, timeout: 120 }] }
};

settings.hooks ||= {};
if (typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
  process.stderr.write(`Charthouse did not change ${settingsPath}: hooks must be an object.\n`);
  process.exit(1);
}
for (const [event, group] of Object.entries(groups)) {
  settings.hooks[event] ||= [];
  if (!Array.isArray(settings.hooks[event])) {
    process.stderr.write(`Charthouse did not change ${settingsPath}: hooks.${event} must be an array.\n`);
    process.exit(1);
  }
  // Replace hooks from the former ~/.claude/charthouse runtime as well as an older
  // neutral runtime path. Preserve unrelated commands, including commands that
  // happen to share the same hook group.
  settings.hooks[event] = settings.hooks[event]
    .map((candidate) => {
      if (!Array.isArray(candidate?.hooks)) return candidate;
      return {
        ...candidate,
        hooks: candidate.hooks.filter((hook) => {
          const command = String(hook?.command || "").replace(/\\/g, "/");
          const charthouseLifecycleCommand = /\/bin\/charthouse["']?\s+hook\s+(?:session-start|changed|stop)\b/.test(command);
          return !charthouseLifecycleCommand;
        })
      };
    })
    .filter((candidate) => !Array.isArray(candidate?.hooks) || candidate.hooks.length > 0);
  settings.hooks[event].push(group);
}

if (existsSync(settingsPath)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(settingsPath, `${settingsPath}.charthouse-backup-${stamp}`);
}
const temporary = `${settingsPath}.charthouse-${process.pid}.tmp`;
writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
renameSync(temporary, settingsPath);
process.stdout.write(`Installed Charthouse hooks in ${settingsPath}.\n`);
