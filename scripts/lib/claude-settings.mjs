import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

// Match lifecycle hooks from any Charthouse runtime path, including the former
// ~/.claude/charthouse runtime, so unrelated commands in a shared group survive.
const LIFECYCLE_COMMAND = /\/bin\/charthouse["']?\s+hook\s+(?:session-start|changed|stop)\b/;

export function isCharthouseHookCommand(command) {
  return LIFECYCLE_COMMAND.test(String(command || "").replace(/\\/g, "/"));
}

export function readClaudeSettings(settingsPath) {
  if (!existsSync(settingsPath)) return {};
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("the settings root must be an object.");
  }
  return settings;
}

// Back up the current file, then replace it atomically. Returns the backup path.
export function writeClaudeSettings(settingsPath, settings) {
  let backup = null;
  if (existsSync(settingsPath)) {
    backup = `${settingsPath}.charthouse-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(settingsPath, backup);
  }
  const temporary = `${settingsPath}.charthouse-${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  renameSync(temporary, settingsPath);
  return backup;
}
