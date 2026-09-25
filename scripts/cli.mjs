import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALIASES, CHARTHOUSE_VERSION, PATHS, PUBLIC_COMMANDS } from "./lib/constants.mjs";
import { assertSafeRoot, exists, findProjectRoot, readJson, repoPath } from "./lib/fs.mjs";
import { gitChangedPaths, gitHead, gitMergeBase } from "./lib/git.mjs";
import { help } from "./lib/help.mjs";
import { checkRepository, statusSummary } from "./lib/check.mjs";
import { impact, knowledge, matchingNavigators, where, who, why } from "./lib/query.mjs";
import { renderPrContext } from "./lib/render.mjs";
import { nextSteps, renderNext } from "./lib/next.mjs";
import { confirmDocument, renderReview, reviewPackets } from "./lib/review.mjs";
import { assertCanonicalCurrent } from "./lib/freshness.mjs";
import { initialize, isInitialized, loadState, pluginRootFrom, previewReconciliation, reconcile, repositoryMigrationStatus, updateMap } from "./lib/state.mjs";
import { runHook } from "./hook.mjs";
import { charterState, REQUIRED_CHARTER_HEADINGS, requireCharter } from "./lib/charter.mjs";
import { describeTool, listTools, runTool } from "./lib/toolbox.mjs";
import { dismissToolGap, exportToolGap, listToolGaps, recordToolGap, resolveToolGap, showToolGap } from "./lib/tool-gaps.mjs";
import { clearStaleProjectLock, projectLockStatus } from "./lib/lock.mjs";
import { abandonVoyage, activateVoyage, createVoyage, finishVoyage, getVoyage, listVoyages, resumeVoyage, summarizeVoyages } from "./lib/voyages.mjs";
import { buildBrief, renderBrief } from "./lib/brief.mjs";
import { adapterStatus } from "./lib/adapters.mjs";
import { clearStaleContributionLock, contributionLockStatus, contributionStatePath, dismissContribution, listContributions, markContributionSubmitted, previewContribution, recordContribution, showContribution } from "./lib/contributions.mjs";
import { acceptExpeditionReport, approveExpedition, expeditionStatus, publishNavigators, resumeExpedition, stageExpeditionMap, startSurvey, synthesizeExpedition } from "./lib/expeditions.mjs";

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  args.splice(index, value && !value.startsWith("--") ? 2 : 1);
  return value || true;
}

function requiredOption(args, name) {
  const value = option(args, name);
  if (!value || value === true) throw new Error(`${name} requires a value.`);
  return value;
}

function repeatedOption(args, name) {
  const values = [];
  while (args.includes(name)) {
    const value = option(args, name);
    if (!value || value === true) throw new Error(`${name} requires a value.`);
    values.push(value);
  }
  return values;
}

function rejectArguments(args, usage) {
  if (args.length) throw new Error(`Usage: ${usage}`);
}

function output(value, json = false) {
  if (typeof value === "string") process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
  else if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${format(value)}\n`);
}

function format(value, indent = "") {
  if (value === null || value === undefined) return `${indent}None`;
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}None`;
    return value.map((item) => typeof item === "object" ? `${indent}-\n${format(item, `${indent}  `)}` : `${indent}- ${item}`).join("\n");
  }
  if (typeof value === "object") {
    return Object.entries(value).map(([key, item]) => {
      if (item && typeof item === "object") return `${indent}${key}:\n${format(item, `${indent}  `)}`;
      return `${indent}${key}: ${item}`;
    }).join("\n");
  }
  return `${indent}${value}`;
}

function printCheck(report, json) {
  if (json) return output({ ok: report.ok, current: report.current, publication: report.publication, errors: report.errors, warnings: report.warnings, findings: report.findings }, true);
  const result = report.ok ? (report.current ? "PASS" : "REVIEW") : "FAIL";
  output(`Map publication: ${report.publication.state}\nBearing check: ${result}\nErrors: ${report.errors}\nWarnings: ${report.warnings}${report.information ? `\nInformation: ${report.information}` : ""}`);
  for (const item of report.findings) {
    output(`${item.level.toUpperCase()} ${item.code}: ${item.message}${item.path ? ` [${item.path}]` : ""}`);
  }
}

function requireValue(args, label) {
  const value = args.join(" ").trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function charterCommand(root, action, args, json) {
  const path = repoPath(root, PATHS.charter);
  const charter = charterState(root);
  if (action === "show") return output(readFileSync(path, "utf8"));
  if (action === "validate") {
    // A Charter with every heading and no intent is not valid. The headings are
    // the template's, so validity means the prompts were replaced.
    const valid = charter.missing_headings.length === 0 && charter.state === "complete";
    output({ valid, state: charter.state, missing_headings: charter.missing_headings, template_sections: charter.template_sections, required_headings: REQUIRED_CHARTER_HEADINGS }, json);
    if (!valid) process.exitCode = 1;
    return;
  }
  if ((action === "create" || !action) && charter.state === "complete") {
    return output("The Charter is complete. Use `charthouse charter update \"<change>\"` so the diff shows what changes. Do not overwrite human intent.");
  }
  if (action === "update" && charter.state === "template") {
    return output("The Charter still holds the template prompts. Use `charthouse charter create` to draft it from the Map and the repository guides.");
  }
  const hint = charter.state === "partial" ? ` Sections still holding template prompts: ${charter.template_sections.join(", ")}.` : "";
  output(`Charter ${action || "create"} needs a coding-agent proposal. Show the draft and diff. Apply it only after user approval.${hint}`);
}

function mapCommand(root, action, args, json) {
  if (!action || action === "show") {
    return output(readJson(repoPath(root, PATHS.map)), json);
  }
  if (action === "find") {
    const query = requireValue(args, "A capability query");
    return output(where(root, query).capabilities, json);
  }
  if (action === "update") {
    const result = updateMap(root);
    return output({ outcome: "Map updated", files: result.map.files.length, units: result.map.units.length, stubs: result.map.scan_summary.stub_units, omitted_units: result.map.scan_summary.omitted_units, perimeter_regions: result.map.scan_summary.perimeter_regions, review_required_regions: result.map.scan_summary.review_required_regions, capabilities: result.map.capabilities.length, note: "Charthouse preserved semantic capability decisions. A Map synthesizer must review new or removed units and flagged perimeter regions. Restart agent sessions that cache repository skills or agents." }, json);
  }
  if (action === "verify") {
    const report = checkRepository(root);
    printCheck(report, json);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown map action: ${action}`);
}

function docsCommand(root, action, args, json) {
  if (action === "review") {
    const allowBehind = option(args, "--allow-behind");
    if (allowBehind !== null && allowBehind !== true) throw new Error("--allow-behind does not take a value.");
    assertCanonicalCurrent(root, { config: loadState(root).config, action: "document review", allowBehind: Boolean(allowBehind) });
    const result = reviewPackets(root, { id: args.join(" ").trim() || null });
    return output(json ? result : renderReview(result), json);
  }
  if (action === "confirm") {
    const allowBehind = option(args, "--allow-behind");
    if (allowBehind !== null && allowBehind !== true) throw new Error("--allow-behind does not take a value.");
    const evidence = option(args, "--evidence");
    const id = requireValue(args, "A document id");
    return output(confirmDocument(root, id, evidence === true ? null : evidence, { allowBehind: Boolean(allowBehind) }), json);
  }
  const report = checkRepository(root);
  if (action === "check") {
    printCheck(report, json);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  const documents = Object.entries(report.state.manifest.documents || {}).map(([id, document]) => ({
    id,
    path: document.path,
    declared_status: document.status,
    findings: report.findings.filter((item) => item.path === document.path).map((item) => item.code)
  }));
  output(documents, json);
}

function navigatorCommand(root, action, args, json) {
  const state = loadState(root);
  if (!action || action === "list") return output(state.manifest.navigators, json);
  if (action === "show") {
    const name = requireValue(args, "A Navigator name");
    const navigator = state.manifest.navigators[name];
    if (!navigator) throw new Error(`Unknown Navigator: ${name}`);
    return output({ name, ...navigator }, json);
  }
  if (action === "regenerate") {
    const name = args.join(" ").trim() || "all";
    const result = publishNavigators(root, name);
    return output({ outcome: result.recovered ? "Interrupted publication finished" : "Navigator views regenerated", requested: name, generated: Object.keys(result.manifest.navigators).length, expedition: result.expedition ? { id: result.expedition.id, status: result.expedition.status } : null, note: "Charthouse preserved semantic capability decisions. Restart agent sessions that cache repository skills or agents." }, json);
  }
  output(`Navigator ${action} needs semantic review. Use the Map as evidence and regenerate only the affected view.`);
}

function expeditionCommand(root, action, args, json) {
  if (!action || action === "status") {
    const id = args.shift() || null;
    rejectArguments(args, "charthouse expedition status [id]");
    return output(expeditionStatus(root, id), json);
  }
  if (action === "resume") {
    const id = args.shift() || null;
    rejectArguments(args, "charthouse expedition resume [id]");
    return output(resumeExpedition(root, id), json);
  }
  if (action === "start-survey") {
    const usage = "charthouse expedition start-survey <id> --role <role>";
    const id = args.shift();
    if (!id) throw new Error(`Usage: ${usage}`);
    const role = requiredOption(args, "--role");
    rejectArguments(args, usage);
    return output(startSurvey(root, id, role), json);
  }
  if (action === "accept-report") {
    const id = args.shift();
    const usage = "charthouse expedition accept-report <id> --role <role> --file <path> [--window <token>]";
    if (!id) throw new Error(`Usage: ${usage}`);
    const role = requiredOption(args, "--role");
    const file = requiredOption(args, "--file");
    const window = option(args, "--window");
    if (window === true) throw new Error("--window requires the token that start-survey returned.");
    rejectArguments(args, usage);
    const result = acceptExpeditionReport(root, id, { role, file, window });
    output(result, json);
    if (!result.accepted) process.exitCode = 1;
    return;
  }
  if (action === "synthesize") {
    const usage = "charthouse expedition synthesize <id> [--restart]";
    const id = args.shift();
    if (!id) throw new Error(`Usage: ${usage}`);
    const restart = option(args, "--restart");
    if (restart !== null && restart !== true) throw new Error("--restart does not take a value.");
    rejectArguments(args, usage);
    return output(synthesizeExpedition(root, id, { restart: Boolean(restart) }), json);
  }
  if (action === "stage") {
    const id = args.shift();
    if (!id) throw new Error("Usage: charthouse expedition stage <id>");
    rejectArguments(args, "charthouse expedition stage <id>");
    return output(stageExpeditionMap(root, id), json);
  }
  if (action === "approve") {
    const usage = "charthouse expedition approve <id> (--all | --capability <id>...)";
    const id = args.shift();
    if (!id) throw new Error(`Usage: ${usage}`);
    const all = option(args, "--all");
    if (all !== null && all !== true) throw new Error("--all does not take a value.");
    const capabilities = repeatedOption(args, "--capability");
    rejectArguments(args, usage);
    return output(approveExpedition(root, id, { capabilities, all: Boolean(all) }), json);
  }
  throw new Error(`Unknown expedition action: ${action}`);
}

function toolCommand(root, action, args, json) {
  if (!action) return output(listTools(), json);
  if (action === "list") {
    if (args.length) throw new Error("Usage: charthouse tool list");
    return output(listTools(), json);
  }
  if (action === "describe") {
    const name = args.shift();
    if (!name || args.length) throw new Error("Usage: charthouse tool describe <name>");
    return output(describeTool(name), json);
  }
  if (action === "run") {
    const name = args.shift();
    if (!name) throw new Error("Usage: charthouse tool run <name> [--option <value>]");
    const result = runTool(root, name, args);
    output(result, json);
    if (result.result?.valid === false) process.exitCode = 1;
    return;
  }
  if (action === "gaps") return toolGapCommand(root, "list", args, json);
  if (action === "gap") return toolGapCommand(root, args.shift() || "list", args, json);
  throw new Error(`Unknown tool action: ${action}`);
}

function toolGapCommand(root, action, args, json) {
  if (action === "list") {
    const status = option(args, "--status");
    if (status === true) throw new Error("--status requires a value.");
    rejectArguments(args, "charthouse tool gap list [--status <status>]");
    return output(listToolGaps(root, status || "all"), json);
  }
  if (action === "show") {
    const id = args.shift();
    if (!id) throw new Error("Usage: charthouse tool gap show <id>");
    rejectArguments(args, "charthouse tool gap show <id>");
    return output(showToolGap(root, id), json);
  }
  if (action === "record") {
    const checkedValues = repeatedOption(args, "--checked");
    if (!checkedValues.length) throw new Error("--checked requires a value. Use the flag more than once or pass a comma-separated list.");
    const voyage = option(args, "--voyage");
    const expedition = option(args, "--expedition");
    if (voyage === true) throw new Error("--voyage requires a value.");
    if (expedition === true) throw new Error("--expedition requires a value.");
    if (Boolean(voyage) === Boolean(expedition)) throw new Error("Tool Gap recording requires exactly one of --voyage or --expedition.");
    const input = {
      key: requiredOption(args, "--key"),
      need: requiredOption(args, "--need"),
      existing_tools_checked: checkedValues.flatMap((value) => value.split(",")).map((item) => item.trim()).filter((item) => item && item !== "none"),
      fallback_kind: requiredOption(args, "--fallback"),
      fallback_summary: requiredOption(args, "--summary"),
      input_shape: requiredOption(args, "--input"),
      output_shape: requiredOption(args, "--output"),
      voyage,
      expedition,
      reporter: option(args, "--reporter") || "charthouse"
    };
    if (input.reporter === true) throw new Error("--reporter requires a value.");
    rejectArguments(args, "charthouse tool gap record --key <key> --need <need> --checked <tools|none> --fallback <kind> --summary <summary> --input <shape> --output <shape> (--voyage <id> | --expedition <id>) [--reporter <name>]");
    return output(recordToolGap(root, input, listTools().map((tool) => tool.name)), json);
  }
  if (action === "dismiss") {
    const id = args.shift();
    if (!id) throw new Error("Usage: charthouse tool gap dismiss <id> --reason <reason>");
    const reason = requiredOption(args, "--reason");
    rejectArguments(args, "charthouse tool gap dismiss <id> --reason <reason>");
    return output(dismissToolGap(root, id, reason), json);
  }
  if (action === "resolve") {
    const id = args.shift();
    if (!id) throw new Error("Usage: charthouse tool gap resolve <id> --tool <name> [--version <version>]");
    const name = requiredOption(args, "--tool");
    const requestedVersion = option(args, "--version");
    if (requestedVersion === true) throw new Error("--version requires a value.");
    rejectArguments(args, "charthouse tool gap resolve <id> --tool <name> [--version <version>]");
    const descriptor = describeTool(name);
    if (requestedVersion && requestedVersion !== descriptor.version) {
      throw new Error(`${name} is installed at version ${descriptor.version}, not ${requestedVersion}.`);
    }
    return output(resolveToolGap(root, id, descriptor.name, descriptor.version), json);
  }
  if (action === "export") {
    const id = args.shift();
    if (!id) throw new Error("Usage: charthouse tool gap export <id>");
    rejectArguments(args, "charthouse tool gap export <id>");
    const result = exportToolGap(root, id);
    return output(json ? result : result.body, json);
  }
  throw new Error(`Unknown tool gap action: ${action}`);
}

function prCommand(root, action, args) {
  requireCharter(root, "Pull-request context");
  const baseOption = option(args, "--base");
  const base = baseOption && baseOption !== true ? baseOption : gitMergeBase(root);
  const paths = [...new Set([...gitChangedPaths(root, base), ...gitChangedPaths(root)])].sort();
  const state = loadState(root);
  const navigators = paths.flatMap((path) => matchingNavigators(state, path));
  const report = checkRepository(root);
  if (action === "reviewers") return output([...new Set(navigators)].sort());
  const block = renderPrContext({ base, head: gitHead(root), paths, navigators, status: report.current ? "current" : "needs attention" });
  output(block);
  if (action === "update") output("The local tool does not write to the pull request. The host agent must show the final block and use an authorized GitHub operation.");
  if (action === "check" && !report.ok) process.exitCode = 1;
}

function contributeCommand(action, args, json) {
  if (!action || action === "list" || action === "status") {
    const status = option(args, "--status");
    if (status === true) throw new Error("--status requires a value.");
    rejectArguments(args, "charthouse contribute list [--status <candidate|dismissed|submitted>]");
    return output(listContributions(status || "all"), json);
  }
  if (action === "doctor") {
    const clearLock = option(args, "--clear-stale-lock");
    if (clearLock !== null && clearLock !== true) throw new Error("--clear-stale-lock does not take a value.");
    rejectArguments(args, "charthouse contribute doctor [--clear-stale-lock]");
    const lockCleanup = clearLock ? clearStaleContributionLock() : null;
    return output({ state_path: contributionStatePath(), lock_cleanup: lockCleanup, contribution_lock: contributionLockStatus() }, json);
  }
  if (action === "record") {
    const result = recordContribution({
      key: requiredOption(args, "--key"),
      type: requiredOption(args, "--type"),
      title: requiredOption(args, "--title"),
      observed: requiredOption(args, "--observed"),
      expected: requiredOption(args, "--expected"),
      source: requiredOption(args, "--source")
    });
    rejectArguments(args, "charthouse contribute record --key <slug> --type <bug|enhancement> --title <text> --observed <text> --expected <text> --source <ambient|tool-gap|user>");
    return output(result, json);
  }
  if (action === "show") {
    const id = args.shift();
    if (!id) throw new Error("Usage: charthouse contribute show <MI-0001>");
    rejectArguments(args, "charthouse contribute show <MI-0001>");
    return output(showContribution(id), json);
  }
  if (action === "preview") {
    const id = args.shift();
    if (!id) throw new Error("Usage: charthouse contribute preview <MI-0001> --as <suggestion|pr>");
    const format = requiredOption(args, "--as");
    rejectArguments(args, "charthouse contribute preview <MI-0001> --as <suggestion|pr>");
    const preview = previewContribution(id, format);
    return output(json ? preview : `${preview.title}\n\n${preview.body}`, json);
  }
  if (action === "dismiss") {
    const id = args.shift();
    if (!id) throw new Error("Usage: charthouse contribute dismiss <MI-0001> --reason <reason>");
    const reason = requiredOption(args, "--reason");
    rejectArguments(args, "charthouse contribute dismiss <MI-0001> --reason <reason>");
    return output(dismissContribution(id, reason), json);
  }
  if (action === "submitted") {
    const id = args.shift();
    if (!id) throw new Error("Usage: charthouse contribute submitted <MI-0001> --as <suggestion|pr> --url <url>");
    const format = requiredOption(args, "--as");
    const url = requiredOption(args, "--url");
    rejectArguments(args, "charthouse contribute submitted <MI-0001> --as <suggestion|pr> --url <url>");
    return output(markContributionSubmitted(id, format, url), json);
  }
  throw new Error(`Unknown contribute action: ${action}`);
}

// install.sh writes .install.json beside the runtime so a person can tell which
// checkout and commit an installation came from without diffing directories.
function installStamp(pluginRoot) {
  const path = resolve(pluginRoot, ".install.json");
  if (!exists(path)) return null;
  try { return readJson(path); } catch { return null; }
}

function installRevision(stamp) {
  const commit = stamp?.commit || "no commit";
  return stamp?.dirty === true ? `${commit}-dirty` : commit;
}

function doctor(root, pluginRoot, json, args = []) {
  const clearLock = option(args, "--clear-stale-lock");
  if (clearLock !== null && clearLock !== true) throw new Error("--clear-stale-lock does not take a value.");
  rejectArguments(args, "charthouse doctor [--clear-stale-lock]");
  const lockCleanup = clearLock ? clearStaleProjectLock(root) : null;
  const files = [".claude-plugin/plugin.json", "skills/charthouse/SKILL.md", "skills/charthouse/agents/openai.yaml", "skills/charthouse-context/SKILL.md", "hooks/hooks.json", "bin/charthouse", "scripts/lib/toolbox.mjs", "scripts/lib/tool-gaps.mjs", "scripts/lib/lock.mjs", "scripts/lib/voyages.mjs", "scripts/lib/expedition-state.mjs", "scripts/lib/expeditions.mjs", "scripts/lib/publication.mjs", "schemas/voyage.schema.json", "schemas/expedition.schema.json"];
  const installation = files.map((path) => ({ path, present: exists(resolve(pluginRoot, path)) }));
  const install = installStamp(pluginRoot);
  const adapters = adapterStatus(pluginRoot, install);
  const result = { version: CHARTHOUSE_VERSION, install, tool: installation, adapters, project_initialized: isInitialized(root), migration: repositoryMigrationStatus(root), lock_cleanup: lockCleanup, project_lock: projectLockStatus(root) };
  if (result.project_initialized) {
    const summary = statusSummary(root);
    result.charter = summary.charter;
    result.bearing = summary.bearing;
    result.publication = summary.publication;
    result.git = summary.git;
    result.instructions = summary.instructions;
    result.reconciliation = summary.reconciliation;
    result.expedition = summary.expedition;
  }
  output(result, json);
  if (installation.some((item) => !item.present) || !adapters.healthy) process.exitCode = 1;
}

function requireVoyageId(args, usage) {
  const id = args.shift();
  if (!id) throw new Error(`Usage: ${usage}`);
  return id;
}

function runCommand(root, action, args, json) {
  if (!action || action === "status") {
    const id = args.shift();
    rejectArguments(args, "charthouse run status [voyage-id]");
    return output(id ? getVoyage(root, id) : { summary: summarizeVoyages(root), voyages: listVoyages(root) }, json);
  }
  if (action === "activate") {
    const id = requireVoyageId(args, "charthouse run activate <voyage-id> [--path <path>]...");
    const paths = repeatedOption(args, "--path");
    const allowBehind = option(args, "--allow-behind");
    if (allowBehind !== null && allowBehind !== true) throw new Error("--allow-behind does not take a value.");
    rejectArguments(args, "charthouse run activate <voyage-id> [--path <path>]... [--allow-behind]");
    return output({ outcome: "Voyage activated", voyage: activateVoyage(root, id, paths, { allowBehind: Boolean(allowBehind) }), note: "The approved path lease is active. Finish or abandon the Voyage to release it." }, json);
  }
  if (action === "resume") {
    const id = requireVoyageId(args, "charthouse run resume <voyage-id>");
    const allowBehind = option(args, "--allow-behind");
    if (allowBehind !== null && allowBehind !== true) throw new Error("--allow-behind does not take a value.");
    rejectArguments(args, "charthouse run resume <voyage-id> [--allow-behind]");
    return output({ outcome: "Voyage resumed", voyage: resumeVoyage(root, id, { allowBehind: Boolean(allowBehind) }) }, json);
  }
  if (action === "finish") {
    const id = requireVoyageId(args, "charthouse run finish <voyage-id>");
    const allowBehind = option(args, "--allow-behind");
    if (allowBehind !== null && allowBehind !== true) throw new Error("--allow-behind does not take a value.");
    rejectArguments(args, "charthouse run finish <voyage-id> [--allow-behind]");
    return output({ outcome: "Voyage completed and path lease released", voyage: finishVoyage(root, id, { allowBehind: Boolean(allowBehind) }) }, json);
  }
  if (action === "abandon") {
    const id = requireVoyageId(args, "charthouse run abandon <voyage-id> --reason <reason>");
    const reason = requiredOption(args, "--reason");
    rejectArguments(args, "charthouse run abandon <voyage-id> --reason <reason>");
    return output({ outcome: "Voyage abandoned and path lease released", voyage: abandonVoyage(root, id, reason) }, json);
  }

  const allowBehind = option(args, "--allow-behind");
  if (allowBehind !== null && allowBehind !== true) throw new Error("--allow-behind does not take a value.");
  const objective = [action, ...args].join(" ").trim();
  const voyage = createVoyage(root, objective, { allowBehind: Boolean(allowBehind) });
  const report = checkRepository(root);
  return output({
    outcome: "Voyage created for planning",
    voyage,
    bearing: report.current ? "current" : "needs attention",
    charter: report.charter.state,
    required: report.charter.state === "complete"
      ? "Load the responsible Navigators and active knowledge before implementation."
      : "Load the responsible Navigators and active knowledge before implementation. The Charter is not complete, so state in the plan that no Charter constraint was checked.",
    next: [
      `Write the approved plan to ${voyage.plan_path}.`,
      voyage.proposed_paths.length
        ? `After plan approval, run \`charthouse run activate ${voyage.id}\` or pass explicit --path values.`
        : `After plan approval, run \`charthouse run activate ${voyage.id} --path <approved-path>\`.`
    ]
  }, json);
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = [...argv];
  const json = Boolean(option(args, "--json"));
  const rootOption = option(args, "--root");
  if (rootOption === true) throw new Error("--root requires a repository path.");
  let command = args.shift();
  if (command === "--help" || command === "-h") command = "help";
  if (command === "--version" || command === "-v" || command === "version") {
    const stamp = installStamp(pluginRootFrom(import.meta.url));
    return output(stamp ? `charthouse ${CHARTHOUSE_VERSION} (${installRevision(stamp)}, installed ${stamp.installed_at || "unknown"} from ${stamp.source || "unknown"})` : `charthouse ${CHARTHOUSE_VERSION}`);
  }
  command = ALIASES[command] || command || "help";
  if (args.includes("--help")) return output(help(command));
  if (command === "help") return output(help(ALIASES[args[0]] || args[0]));
  if (!PUBLIC_COMMANDS.includes(command) && command !== "hook") {
    process.exitCode = 1;
    return output(`Unknown command: ${command}\n\n${help()}`);
  }
  if (command === "hook") return runHook(args[0], rootOption && rootOption !== true ? resolve(rootOption) : process.cwd());

  const root = assertSafeRoot(rootOption && rootOption !== true ? resolve(rootOption) : findProjectRoot());
  const pluginRoot = pluginRootFrom(import.meta.url);
  if (command === "init" && root === pluginRoot && !rootOption) {
    throw new Error("Refusing to initialize the Charthouse source repository implicitly. Pass --root explicitly to confirm this target.");
  }
  if (command === "doctor") return doctor(root, pluginRoot, json, args);
  if (command === "tool") return toolCommand(root, args.shift(), args, json);
  if (command === "contribute") return contributeCommand(args.shift(), args, json);
  if (command === "init") {
    const canonicalRef = option(args, "--canonical-ref");
    if (canonicalRef === true) throw new Error("--canonical-ref requires a branch name.");
    rejectArguments(args, "charthouse init --canonical-ref <branch>");
    const result = initialize(root, pluginRoot, { canonicalRef });
    const instructionWarnings = result.map.instruction_file_warnings || [];
    const next = [
      "Review flagged perimeter regions.",
      `Run the four isolated Charthouse mapper agents. Store each report at its assigned path under ${result.expedition.draft_root}/surveys/ and accept it into ${result.expedition.id}.`,
      "Run `charthouse charter create`. The Charter holds the template prompts until then.",
      "Run `charthouse check`."
    ];
    if (instructionWarnings.length) next.unshift("Review oversized agent instruction files before relying on complete host context.");
    const instructionContracts = (result.map.instruction_contracts || []).map(({ id, path, kind, providers, scope, parent, over_limit }) => ({ id, path, kind, providers, scope, parent, over_limit }));
    return output({ outcome: "Expedition transaction started", root, canonical: result.canonical, expedition: { id: result.expedition.id, status: result.expedition.status, draft_root: result.expedition.draft_root, surveys: result.expedition.surveys }, files: result.map.files.length, units: result.map.units.length, stubs: result.map.scan_summary.stub_units, omitted_units: result.map.scan_summary.omitted_units, perimeter_regions: result.map.scan_summary.perimeter_regions, review_required_regions: result.map.scan_summary.review_required_regions, instruction_contracts: instructionContracts, instruction_file_warnings: instructionWarnings, capabilities: result.map.capabilities.length, next }, json);
  }
  if (!isInitialized(root)) throw new Error("Charthouse is not initialized. Run `charthouse init`.");

  const action = args.shift();
  if (command === "status") return output(statusSummary(root), json);
  if (command === "expedition") return expeditionCommand(root, action, args, json);
  if (command === "brief") {
    const brief = buildBrief(root, requireValue([action, ...args].filter(Boolean), "An objective"));
    return output(json ? brief : renderBrief(brief), json);
  }
  if (command === "reconcile") {
    const reconcileArgs = [action, ...args].filter(Boolean);
    const force = option(reconcileArgs, "--force");
    const dryRun = option(reconcileArgs, "--dry-run");
    if (force !== null && force !== true) throw new Error("--force does not take a value.");
    if (dryRun !== null && dryRun !== true) throw new Error("--dry-run does not take a value.");
    rejectArguments(reconcileArgs, "charthouse reconcile [--force] [--dry-run]");
    return output(dryRun ? previewReconciliation(root, { force: Boolean(force) }) : reconcile(root, { force: Boolean(force) }), json);
  }
  if (command === "check") {
    const report = checkRepository(root);
    printCheck(report, json);
    if (!report.ok || (report.warnings && report.state.config.mode === "enforce")) process.exitCode = 1;
    return;
  }
  if (command === "next") {
    const result = nextSteps(root);
    return output(json ? result : renderNext(result), json);
  }
  if (command === "map") return mapCommand(root, action, args, json);
  if (command === "docs") return docsCommand(root, action || "status", args, json);
  if (command === "charter") return charterCommand(root, action, args, json);
  if (command === "navigator") return navigatorCommand(root, action, args, json);
  if (command === "where") return output(where(root, requireValue([action, ...args].filter(Boolean), "A concept")), json);
  if (command === "who") return output(who(root, requireValue([action, ...args].filter(Boolean), "A repository path")), json);
  if (command === "why") return output(why(root, requireValue([action, ...args].filter(Boolean), "A target")), json);
  if (command === "impact") return output(impact(root, requireValue([action, ...args].filter(Boolean), "A proposed change")), json);
  if (command === "knowledge") {
    const result = knowledge(root, action || "list", args.join(" "));
    output(result, json);
    if (["propose", "verify", "update", "retire"].includes(action)) output("This operation needs a coding-agent proposal and context verification. The deterministic tool made no change.");
    return;
  }
  if (command === "pr") return prCommand(root, action || "preview", args);
  if (command === "run") return runCommand(root, action, args, json);
  if (command === "refit") {
    requireCharter(root, "A Refit");
    return output("A Refit is a proposal. Compare the Map with the Charter. Show moves, dependency effects, migration steps, and rollback steps. Do not move code without approval.");
  }
}
