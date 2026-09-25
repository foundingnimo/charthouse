import { ALIASES, PUBLIC_COMMANDS } from "./constants.mjs";

const DETAILS = {
  brief: "Build ranked, bounded implementation context for an objective without starting a Voyage.",
  charter: "Create, show, update, diff, or validate the human-owned Charter. `validate` reports template, partial, or complete.",
  check: "Run a read-only Bearing check for stale knowledge and generated context.",
  contribute: "Record, preview, dismiss, or mark an upstream Charthouse improvement as submitted.",
  docs: "Show document state, run freshness checks, build review packets for suspect documents, or confirm a reviewed document.",
  doctor: "Validate the Charthouse installation and project state, or safely clear a proven stale local lock.",
  expedition: "Inspect or resume the current Expedition, accept mapper reports, and stage and approve the draft Map.",
  help: "Show general help or help for one command.",
  impact: "Rank likely capabilities and Navigators for a proposed change.",
  init: "Pin the user-selected canonical branch, then run the first Expedition.",
  knowledge: "Show, search, propose, verify, update, or retire Logbook records.",
  map: "Show, find, update, or verify the observed repository Map.",
  navigator: "List, show, regenerate, or request a specialist review.",
  next: "List what Charthouse found and suggest the next steps, each with its command.",
  pr: "Preview, check, or update bounded pull-request context.",
  reconcile: "Refresh derived repository context when observed files changed.",
  refit: "Propose a repository reorganization. This command does not move code.",
  run: "Create, activate, resume, finish, abandon, or inspect a development Voyage.",
  status: "Show Map publication, Bearing health, Expedition, knowledge, and Voyage state.",
  tool: "List, describe, or run a trusted tool, and maintain the project Tool Gap Log.",
  where: "Find code, documents, and knowledge for a concept.",
  who: "Find the responsible Navigator for a path.",
  why: "Explain applicable rationale for a path, symbol, or knowledge ID."
};

const USAGE = {
  brief: "charthouse brief <objective> [--json]",
  charter: "charthouse charter <create|show|update|diff|validate>",
  check: "charthouse check [--json]",
  contribute: "charthouse contribute <record|list|show|preview|dismiss|submitted|doctor> [arguments] [--json]",
  docs: "charthouse docs <status|check|review [id] [--allow-behind]|confirm <id> --evidence <file> [--allow-behind]> [--json]",
  doctor: "charthouse doctor [--clear-stale-lock]",
  expedition: "charthouse expedition <status [id]|resume [id]|accept-report <id> --role <role> --file <path>|synthesize <id> [--restart]|stage <id>|approve <id> (--all|--capability <id>...)>",
  help: "charthouse help [command]",
  impact: "charthouse impact <proposed change>",
  init: "charthouse init --canonical-ref <branch> [--root <repository>]",
  knowledge: "charthouse knowledge <show|search|propose|verify|update|retire|history> [value]",
  map: "charthouse map <show|find|update|verify> [value]",
  next: "charthouse next [--json]",
  navigator: "charthouse navigator <list|show|regenerate|review> [value]",
  pr: "charthouse pr <preview|check|update|reviewers> [--base <ref>]",
  reconcile: "charthouse reconcile [--force] [--dry-run] [--json]",
  refit: "charthouse refit propose [scope]",
  run: "charthouse run <objective> [--allow-behind] | status [id] | activate <id> [--path <path>]... [--allow-behind] | resume <id> [--allow-behind] | finish <id> [--allow-behind] | abandon <id> --reason <reason>",
  status: "charthouse status [--json]",
  tool: "charthouse tool <list|describe|run|gaps|gap> [action] [--json]",
  where: "charthouse where <concept>",
  who: "charthouse who <repository path>",
  why: "charthouse why <path[:symbol]|K-0001>"
};

export function help(command = null) {
  if (command && DETAILS[command]) {
    return `Charthouse ${command}\n\n${DETAILS[command]}\n\nUsage: ${USAGE[command]}\n`;
  }
  const aliases = Object.entries(ALIASES).map(([alias, name]) => `${alias}=${name}`).join(", ");
  const lines = [
    "Charthouse maps a repository and maintains verified context for coding agents.",
    "",
    "Usage: charthouse <command> [arguments] [--root <repository>]",
    "",
    "Commands:"
  ];
  for (const commandName of PUBLIC_COMMANDS) {
    lines.push(`  ${commandName.padEnd(11)} ${DETAILS[commandName]}`);
  }
  lines.push("", `Frequent aliases: ${aliases}`, "", "Use `charthouse help <command>` for command help.");
  return `${lines.join("\n")}\n`;
}
