import { PATHS, SCHEMA_VERSION } from "./constants.mjs";
import { exists, readJson, repoPath, writeJson } from "./fs.mjs";
import { withProjectLock } from "./lock.mjs";

export const TOOL_GAP_CANDIDATE_OCCURRENCES = 3;
export const TOOL_GAP_CANDIDATE_VOYAGES = 2;

const STATUSES = new Set(["observed", "candidate", "dismissed", "resolved"]);
const FALLBACK_KINDS = new Set(["system-utility", "temporary-script", "manual"]);
const STATUS_ORDER = { candidate: 0, observed: 1, resolved: 2, dismissed: 3 };
const LOG_FIELDS = ["schema_version", "next_id", "gaps"];
const GAP_FIELDS = [
  "id", "key", "need", "existing_tools_checked", "fallback_kind",
  "fallback_summary", "input_shape", "output_shape", "first_seen",
  "last_seen", "occurrences", "voyages", "reporters", "observation_keys",
  "expeditions", "status", "resolved_by", "dismissal"
];

export function emptyToolGapLog() {
  return { schema_version: SCHEMA_VERSION, next_id: 1, gaps: [] };
}

function fail(message) {
  throw new Error(`Invalid Charthouse Tool Gap Log: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be a non-empty string.`);
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) fail(`${label} must be an array of non-empty strings.`);
  return value;
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail(`${label} contains unknown field ${unknown}.`);
}

function timestamp(value, label) {
  const text = string(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) || Number.isNaN(Date.parse(text))) fail(`${label} must be an ISO date-time.`);
}

export function validateToolGapLog(value) {
  const log = object(value, "log");
  exactKeys(log, LOG_FIELDS, "log");
  if (log.schema_version !== SCHEMA_VERSION) fail(`schema_version must be ${SCHEMA_VERSION}.`);
  if (!Number.isInteger(log.next_id) || log.next_id < 1) fail("next_id must be a positive integer.");
  if (!Array.isArray(log.gaps)) fail("gaps must be an array.");
  const ids = new Set();
  const keys = new Set();
  for (const [index, raw] of log.gaps.entries()) {
    const gap = object(raw, `gaps[${index}]`);
    const prefix = `gaps[${index}]`;
    if (gap.expeditions === undefined) gap.expeditions = [];
    exactKeys(gap, GAP_FIELDS, prefix);
    if (!/^TG-\d{4,}$/.test(string(gap.id, `${prefix}.id`))) fail(`${prefix}.id must use TG-0001 form.`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(string(gap.key, `${prefix}.key`))) fail(`${prefix}.key must be a lowercase slug.`);
    for (const field of ["need", "fallback_summary", "input_shape", "output_shape"]) safeText(gap[field], `${prefix}.${field}`);
    timestamp(gap.first_seen, `${prefix}.first_seen`);
    timestamp(gap.last_seen, `${prefix}.last_seen`);
    stringArray(gap.existing_tools_checked, `${prefix}.existing_tools_checked`);
    stringArray(gap.voyages, `${prefix}.voyages`);
    stringArray(gap.expeditions, `${prefix}.expeditions`);
    stringArray(gap.reporters, `${prefix}.reporters`);
    stringArray(gap.observation_keys, `${prefix}.observation_keys`);
    if (!FALLBACK_KINDS.has(gap.fallback_kind)) fail(`${prefix}.fallback_kind is invalid.`);
    if (!STATUSES.has(gap.status)) fail(`${prefix}.status is invalid.`);
    if (!Number.isInteger(gap.occurrences) || gap.occurrences < 1 || gap.occurrences !== gap.observation_keys.length) {
      fail(`${prefix}.occurrences must equal the number of observation_keys.`);
    }
    for (const field of ["existing_tools_checked", "voyages", "expeditions", "reporters", "observation_keys"]) {
      if (new Set(gap[field]).size !== gap[field].length) fail(`${prefix}.${field} must not contain duplicates.`);
    }
    if (gap.observation_keys.some((item) => !/^[A-Za-z0-9][A-Za-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item))) {
      fail(`${prefix}.observation_keys must use <voyage>:<reporter> form.`);
    }
    if (gap.resolved_by !== null) {
      const resolution = object(gap.resolved_by, `${prefix}.resolved_by`);
      exactKeys(resolution, ["tool", "version", "resolved_at"], `${prefix}.resolved_by`);
      for (const field of ["tool", "version"]) string(resolution[field], `${prefix}.resolved_by.${field}`);
      timestamp(resolution.resolved_at, `${prefix}.resolved_by.resolved_at`);
    }
    if (gap.dismissal !== null) {
      const dismissal = object(gap.dismissal, `${prefix}.dismissal`);
      exactKeys(dismissal, ["reason", "dismissed_at"], `${prefix}.dismissal`);
      safeText(dismissal.reason, `${prefix}.dismissal.reason`);
      timestamp(dismissal.dismissed_at, `${prefix}.dismissal.dismissed_at`);
    }
    if ((gap.status === "resolved") !== (gap.resolved_by !== null)) fail(`${prefix}.resolved_by must match resolved status.`);
    if ((gap.status === "dismissed") !== (gap.dismissal !== null)) fail(`${prefix}.dismissal must match dismissed status.`);
    const observedContexts = new Set(gap.observation_keys.map((item) => item.split(":", 1)[0]));
    const observedReporters = new Set(gap.observation_keys.map((item) => item.slice(item.indexOf(":") + 1)));
    const declaredContexts = new Set([...gap.voyages, ...gap.expeditions]);
    if ([...declaredContexts].some((item) => !observedContexts.has(item)) || observedContexts.size !== declaredContexts.size) fail(`${prefix}.voyages and ${prefix}.expeditions must match observation_keys.`);
    if (gap.reporters.some((item) => !observedReporters.has(item)) || observedReporters.size !== gap.reporters.length) fail(`${prefix}.reporters must match observation_keys.`);
    if (gap.status === "candidate" && (gap.occurrences < TOOL_GAP_CANDIDATE_OCCURRENCES || gap.voyages.length < TOOL_GAP_CANDIDATE_VOYAGES)) {
      fail(`${prefix}.candidate status needs repeated evidence.`);
    }
    if (ids.has(gap.id)) fail(`duplicate id ${gap.id}.`);
    if (keys.has(gap.key)) fail(`duplicate key ${gap.key}.`);
    ids.add(gap.id);
    keys.add(gap.key);
  }
  const lastId = log.gaps.reduce((maximum, gap) => Math.max(maximum, Number(gap.id.slice(3))), 0);
  if (log.next_id <= lastId) fail("next_id must be greater than every allocated id.");
  return log;
}

function requireInitialized(root) {
  if (!exists(repoPath(root, PATHS.config)) || !exists(repoPath(root, PATHS.map))) {
    throw new Error("Charthouse is not initialized. Run `charthouse init`.");
  }
}

export function loadToolGapLog(root) {
  requireInitialized(root);
  const path = repoPath(root, PATHS.toolGaps);
  return exists(path) ? validateToolGapLog(readJson(path)) : emptyToolGapLog();
}

function saveToolGapLog(root, log) {
  validateToolGapLog(log);
  writeJson(repoPath(root, PATHS.toolGaps), log);
}

function safeText(value, label, maximum = 500) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const text = value.trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  if (/\r|\n|\0/.test(text)) throw new Error(`${label} must be one line.`);
  if (/(^|\s)(?:\/[^\s]|~[\\/]|[A-Za-z]:[\\/]|\\\\[^\s])/.test(text)) {
    throw new Error(`${label} must not contain an absolute path.`);
  }
  return text;
}

function identifier(value, label) {
  const text = safeText(value, label, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text)) throw new Error(`${label} must use letters, numbers, dots, underscores, or hyphens.`);
  return text;
}

function versionIdentifier(value) {
  const text = safeText(value, "--version", 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/.test(text)) throw new Error("--version has an invalid format.");
  return text;
}

function gapKey(value) {
  const key = safeText(value, "--key", 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!key) throw new Error("--key must contain a letter or number.");
  return key;
}

function nextId(log) {
  const id = `TG-${String(log.next_id).padStart(4, "0")}`;
  log.next_id += 1;
  return id;
}

function now() {
  return new Date().toISOString();
}

function unique(values) {
  return [...new Set(values)];
}

function candidateReady(gap) {
  return gap.occurrences >= TOOL_GAP_CANDIDATE_OCCURRENCES && gap.voyages.length >= TOOL_GAP_CANDIDATE_VOYAGES;
}

function recordToolGapUnlocked(root, input, registeredTools = []) {
  const log = loadToolGapLog(root);
  const key = gapKey(input.key);
  const voyage = input.voyage ? identifier(input.voyage, "--voyage") : null;
  const expedition = input.expedition ? identifier(input.expedition, "--expedition") : null;
  if (Boolean(voyage) === Boolean(expedition)) throw new Error("Tool Gap recording requires exactly one Voyage or Expedition context.");
  const context = voyage || expedition;
  const reporter = identifier(input.reporter || "charthouse", "--reporter");
  const report = {
    need: safeText(input.need, "--need"),
    fallback_summary: safeText(input.fallback_summary, "--summary"),
    input_shape: safeText(input.input_shape, "--input"),
    output_shape: safeText(input.output_shape, "--output")
  };
  if (!FALLBACK_KINDS.has(input.fallback_kind)) {
    throw new Error(`--fallback must be one of: ${[...FALLBACK_KINDS].join(", ")}.`);
  }
  const known = new Set(registeredTools);
  const checked = unique(input.existing_tools_checked || []).map((name) => identifier(name, "--checked"));
  const unknown = checked.find((name) => !known.has(name));
  if (unknown) throw new Error(`Unknown registered tool in --checked: ${unknown}`);
  const observation = `${context}:${reporter}`;
  const timestamp = now();
  let gap = log.gaps.find((item) => item.key === key);

  if (gap?.status === "dismissed") return { recorded: false, outcome: "dismissed", gap };
  if (gap?.observation_keys.includes(observation)) return { recorded: false, outcome: "duplicate", gap };
  let reopened = false;
  if (gap?.status === "resolved") {
    if (!checked.includes(gap.resolved_by.tool)) {
      throw new Error(`${gap.id} is resolved by ${gap.resolved_by.tool}. Check that tool before recording the gap again.`);
    }
    gap.status = candidateReady(gap) ? "candidate" : "observed";
    gap.resolved_by = null;
    reopened = true;
  }

  if (!gap) {
    gap = {
      id: nextId(log),
      key,
      need: report.need,
      existing_tools_checked: checked,
      fallback_kind: input.fallback_kind,
      fallback_summary: report.fallback_summary,
      input_shape: report.input_shape,
      output_shape: report.output_shape,
      first_seen: timestamp,
      last_seen: timestamp,
      occurrences: 1,
      voyages: voyage ? [voyage] : [],
      expeditions: expedition ? [expedition] : [],
      reporters: [reporter],
      observation_keys: [observation],
      status: "observed",
      resolved_by: null,
      dismissal: null
    };
    log.gaps.push(gap);
  } else {
    gap.existing_tools_checked = unique([...gap.existing_tools_checked, ...checked]);
    gap.last_seen = timestamp;
    if (voyage) gap.voyages = unique([...gap.voyages, voyage]);
    if (expedition) gap.expeditions = unique([...gap.expeditions, expedition]);
    gap.reporters = unique([...gap.reporters, reporter]);
    gap.observation_keys.push(observation);
    gap.occurrences = gap.observation_keys.length;
  }
  const promoted = gap.status === "observed" && candidateReady(gap);
  if (promoted) gap.status = "candidate";
  saveToolGapLog(root, log);
  return { recorded: true, outcome: reopened ? "reopened" : gap.occurrences === 1 ? "created" : promoted ? "promoted" : "updated", gap };
}

export function recordToolGap(root, input, registeredTools = []) {
  return withProjectLock(root, "record Tool Gap", () => recordToolGapUnlocked(root, input, registeredTools));
}

export function listToolGaps(root, status = "all") {
  if (status !== "all" && !STATUSES.has(status)) throw new Error(`Unknown Tool Gap status: ${status}`);
  return loadToolGapLog(root).gaps
    .filter((gap) => status === "all" || gap.status === status)
    .sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || b.occurrences - a.occurrences || a.id.localeCompare(b.id));
}

export function showToolGap(root, id) {
  const gap = loadToolGapLog(root).gaps.find((item) => item.id === id);
  if (!gap) throw new Error(`Unknown Tool Gap: ${id}`);
  return gap;
}

function dismissToolGapUnlocked(root, id, reason) {
  const log = loadToolGapLog(root);
  const gap = log.gaps.find((item) => item.id === id);
  if (!gap) throw new Error(`Unknown Tool Gap: ${id}`);
  gap.status = "dismissed";
  gap.dismissal = { reason: safeText(reason, "--reason"), dismissed_at: now() };
  gap.resolved_by = null;
  saveToolGapLog(root, log);
  return gap;
}

export function dismissToolGap(root, id, reason) {
  return withProjectLock(root, "dismiss Tool Gap", () => dismissToolGapUnlocked(root, id, reason));
}

function resolveToolGapUnlocked(root, id, tool, version) {
  const log = loadToolGapLog(root);
  const gap = log.gaps.find((item) => item.id === id);
  if (!gap) throw new Error(`Unknown Tool Gap: ${id}`);
  gap.status = "resolved";
  gap.resolved_by = {
    tool: identifier(tool, "--tool"),
    version: versionIdentifier(version),
    resolved_at: now()
  };
  gap.dismissal = null;
  saveToolGapLog(root, log);
  return gap;
}

export function resolveToolGap(root, id, tool, version) {
  return withProjectLock(root, "resolve Tool Gap", () => resolveToolGapUnlocked(root, id, tool, version));
}

export function exportToolGap(root, id) {
  const gap = showToolGap(root, id);
  if (gap.status === "dismissed" || gap.status === "resolved") throw new Error(`${id} is ${gap.status} and is not an open Toolbox proposal.`);
  const body = [
    `# Toolbox candidate: ${gap.key}`,
    "",
    "## Need",
    "",
    gap.need,
    "",
    "## Contract",
    "",
    `- Input: ${gap.input_shape}`,
    `- Output: ${gap.output_shape}`,
    `- Existing tools checked: ${gap.existing_tools_checked.length ? gap.existing_tools_checked.join(", ") : "none"}`,
    "",
    "## Evidence",
    "",
    `- Occurrences: ${gap.occurrences}`,
    `- Distinct Voyages: ${gap.voyages.length}`,
    `- Distinct Expeditions: ${gap.expeditions.length}`,
    `- Fallback: ${gap.fallback_kind}`,
    `- Fallback summary: ${gap.fallback_summary}`,
    "",
    "## Safety requirements",
    "",
    "- Declare inputs, outputs, permissions, runtime, and subprocesses.",
    "- Keep repository access read-only unless a separate design is approved.",
    "- Do not use the network by default.",
    "- Bound output for the agent context window.",
    ""
  ].join("\n");
  return { id: gap.id, key: gap.key, title: `Toolbox: ${gap.need}`, body };
}

export function summarizeToolGaps(log) {
  const gaps = validateToolGapLog(log).gaps;
  return {
    total: gaps.length,
    observed: gaps.filter((gap) => gap.status === "observed").length,
    candidates: gaps.filter((gap) => gap.status === "candidate").length,
    resolved: gaps.filter((gap) => gap.status === "resolved").length,
    dismissed: gaps.filter((gap) => gap.status === "dismissed").length
  };
}
