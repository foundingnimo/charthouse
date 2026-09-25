import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { exists } from "./fs.mjs";

const HOOK_EVENTS = Object.freeze({
  SessionStart: "session-start",
  PostToolUse: "changed",
  Stop: "stop"
});

function canonical(path) {
  const absolute = resolve(path);
  try { return realpathSync.native(absolute); } catch { return absolute; }
}

function skillPair(directory) {
  const administration = join(directory, "charthouse", "SKILL.md");
  const context = join(directory, "charthouse-context", "SKILL.md");
  return {
    directory,
    administration: { path: administration, present: exists(administration) },
    context: { path: context, present: exists(context) },
    get complete() { return this.administration.present && this.context.present; }
  };
}

function hookStatus(claudeDirectory, runtimeDirectory, installedRuntime = null) {
  const settingsPath = join(claudeDirectory, "settings.json");
  if (!exists(settingsPath)) return { settings: settingsPath, configured: false, current: false, events: {}, error: null };
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    return { settings: settingsPath, configured: true, current: false, events: {}, error: error.message };
  }
  const executables = [...new Set([runtimeDirectory, installedRuntime].filter(Boolean)
    .map((directory) => join(directory, "bin", "charthouse").replace(/\\/g, "/")))];
  const events = {};
  for (const [event, action] of Object.entries(HOOK_EVENTS)) {
    const commands = Array.isArray(settings?.hooks?.[event])
      ? settings.hooks[event].flatMap((group) => Array.isArray(group?.hooks) ? group.hooks.map((hook) => String(hook?.command || "").replace(/\\/g, "/")) : [])
      : [];
    const managedPattern = new RegExp(`/bin/charthouse["']?\\s+hook\\s+${action}\\b`);
    events[event] = {
      current: commands.filter((command) => executables.some((executable) => command.includes(executable)) && command.includes(`hook ${action}`)).length,
      charthouse: commands.filter((command) => managedPattern.test(command)).length
    };
  }
  const configured = Object.values(events).some((event) => event.charthouse > 0);
  const current = Object.values(events).every((event) => event.current === 1 && event.charthouse === 1);
  return { settings: settingsPath, configured, current, events, error: null };
}

export function adapterStatus(pluginRoot, install = null, environment = process.env) {
  const home = environment.HOME || homedir();
  const runtime = canonical(pluginRoot);
  const neutralRuntime = canonical(environment.CHARTHOUSE_HOME || join(home, ".charthouse"));
  const claudeDirectory = canonical(environment.CLAUDE_CONFIG_DIR || join(home, ".claude"));
  const sharedSkillsDirectory = canonical(environment.AGENT_SKILLS_DIR || join(home, ".agents", "skills"));
  const claudeSkills = skillPair(join(claudeDirectory, "skills"));
  const sharedSkills = skillPair(sharedSkillsDirectory);
  const hooks = hookStatus(claudeDirectory, runtime, install?.runtime);
  const inferredHosts = install
    ? [claudeSkills.administration.present ? "claude" : null, sharedSkills.administration.present ? "shared" : null].filter(Boolean)
    : [];
  const selected = Array.isArray(install?.hosts) ? install.hosts : (inferredHosts.length ? inferredHosts : install ? ["claude"] : []);
  const expectsClaude = selected.includes("claude");
  const expectsShared = selected.includes("shared");
  const expectsHooks = expectsClaude && (install?.hooks === true || (install?.hooks === undefined && hooks.configured));
  const mode = install
    ? (runtime === neutralRuntime ? "standalone-neutral" : runtime === canonical(join(claudeDirectory, "charthouse")) ? "standalone-legacy" : "standalone-custom")
    : "plugin-or-source";
  const claudeHealthy = !expectsClaude || (claudeSkills.complete && (!expectsHooks || hooks.current));
  const sharedHealthy = !expectsShared || sharedSkills.complete;
  const runtimeCurrent = !install?.runtime || canonical(install.runtime) === runtime;
  return {
    healthy: runtimeCurrent && claudeHealthy && sharedHealthy,
    selected_hosts: selected,
    runtime: { path: runtime, mode, neutral_path: neutralRuntime, current: runtimeCurrent },
    claude: { expected: expectsClaude, healthy: claudeHealthy, skills: claudeSkills, hooks: { expected: expectsHooks, ...hooks } },
    shared: { expected: expectsShared, healthy: sharedHealthy, skills: sharedSkills }
  };
}
