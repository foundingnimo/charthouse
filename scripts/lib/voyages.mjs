import { readdirSync } from "node:fs";
import { posix } from "node:path";
import { PATHS, SCHEMA_VERSION } from "./constants.mjs";
import { ensureDir, exists, readJson, repoPath, toPosix, writeJson } from "./fs.mjs";
import { gitBaseline, gitHead } from "./git.mjs";
import { withProjectLock } from "./lock.mjs";
import { impact } from "./query.mjs";
import { loadState } from "./state.mjs";
import { assertCanonicalCurrent } from "./freshness.mjs";

const STATUSES = new Set(["planning", "active", "completed", "abandoned"]);
const EVENTS = new Set(["created", "activated", "resumed", "completed", "abandoned"]);
const VOYAGE_FIELDS = [
  "schema_version", "id", "objective", "status", "created_at", "updated_at",
  "baseline", "allow_behind", "plan_path", "proposed_paths", "leased_paths",
  "navigators", "scope_source", "activated_at", "closed_at", "final_commit",
  "abandonment_reason", "history"
];

function fail(message) {
  throw new Error(`Invalid Voyage: ${message}`);
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail(`${label} contains unknown field ${unknown}.`);
}

function timestamp(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail(`${label} must be an ISO date-time${nullable ? " or null" : ""}.`);
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) fail(`${label} must be an array of non-empty strings.`);
  if (new Set(value).size !== value.length) fail(`${label} must not contain duplicates.`);
}

export function validateVoyage(value) {
  exactKeys(value, VOYAGE_FIELDS, "record");
  for (const field of VOYAGE_FIELDS) if (!(field in value)) fail(`record is missing ${field}.`);
  if (value.schema_version !== SCHEMA_VERSION) fail(`schema_version must be ${SCHEMA_VERSION}.`);
  if (!/^V-\d{4,}$/.test(value.id)) fail("id must use V-0001 form.");
  if (typeof value.objective !== "string" || !value.objective || value.objective.length > 500 || /[\r\n\0]/.test(value.objective)) fail("objective must be one line and 500 characters or fewer.");
  if (!STATUSES.has(value.status)) fail("status is invalid.");
  timestamp(value.created_at, "created_at");
  timestamp(value.updated_at, "updated_at");
  exactKeys(value.baseline, ["commit", "dirty", "canonical_ref", "canonical_commit"], "baseline");
  if (value.baseline.commit !== null && (typeof value.baseline.commit !== "string" || !/^[a-f0-9]{7,40}$/.test(value.baseline.commit))) fail("baseline.commit must be a Git commit or null.");
  if (typeof value.baseline.dirty !== "boolean") fail("baseline.dirty must be boolean.");
  if (value.baseline.canonical_ref !== undefined && value.baseline.canonical_ref !== null && (typeof value.baseline.canonical_ref !== "string" || !value.baseline.canonical_ref)) fail("baseline.canonical_ref must be a non-empty string or null.");
  if (value.baseline.canonical_commit !== undefined && value.baseline.canonical_commit !== null && (typeof value.baseline.canonical_commit !== "string" || !/^[a-f0-9]{7,40}$/.test(value.baseline.canonical_commit))) fail("baseline.canonical_commit must be a Git commit or null.");
  if (typeof value.allow_behind !== "boolean") fail("allow_behind must be boolean.");
  if (value.plan_path !== `${PATHS.chronicles}/${value.id}/plan.md`) fail("plan_path must point to the Voyage Chronicle directory.");
  for (const field of ["proposed_paths", "leased_paths", "navigators"]) stringArray(value[field], field);
  if (![null, "predicted", "explicit"].includes(value.scope_source)) fail("scope_source is invalid.");
  timestamp(value.activated_at, "activated_at", true);
  timestamp(value.closed_at, "closed_at", true);
  if (value.final_commit !== null && (typeof value.final_commit !== "string" || !/^[a-f0-9]{7,40}$/.test(value.final_commit))) fail("final_commit must be a Git commit or null.");
  if (value.abandonment_reason !== null && (typeof value.abandonment_reason !== "string" || !value.abandonment_reason || value.abandonment_reason.length > 500 || /[\r\n\0]/.test(value.abandonment_reason))) fail("abandonment_reason must be one line and 500 characters or fewer.");
  if (!Array.isArray(value.history)) fail("history must be an array.");
  for (const [index, event] of value.history.entries()) {
    exactKeys(event, ["event", "at"], `history[${index}]`);
    if (!EVENTS.has(event.event)) fail(`history[${index}].event is invalid.`);
    timestamp(event.at, `history[${index}].at`);
  }
  if (value.status === "planning" && (value.activated_at !== null || value.closed_at !== null || value.leased_paths.length)) fail("a planning Voyage cannot hold or close a lease.");
  if (value.status === "active" && (!value.activated_at || value.closed_at !== null || !value.leased_paths.length)) fail("an active Voyage needs an open path lease.");
  if ((value.status === "completed" || value.status === "abandoned") && value.closed_at === null) fail("a closed Voyage needs closed_at.");
  if (value.status === "completed" && value.abandonment_reason !== null) fail("a completed Voyage cannot have an abandonment reason.");
  if (value.status === "abandoned" && value.abandonment_reason === null) fail("an abandoned Voyage needs a reason.");
  return value;
}

function cleanText(value, label, maximum = 500) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const text = value.trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maximum || /[\r\n\0]/.test(text)) throw new Error(`${label} must be one line and ${maximum} characters or fewer.`);
  return text;
}

export function normalizeVoyagePath(value) {
  const text = cleanText(value, "A Voyage path", 300);
  const portable = toPosix(text).replace(/\\/g, "/");
  if (portable.startsWith("/") || portable.startsWith("~/") || /^[A-Za-z]:/.test(portable)) {
    throw new Error(`Voyage paths must be repository-relative: ${text}`);
  }
  if (portable.split("/").includes("..")) throw new Error(`Voyage paths must stay inside the repository: ${text}`);
  const normalized = posix.normalize(portable).replace(/\/$/, "");
  if (!normalized || normalized === "." || normalized === "**") return "**";
  return normalized;
}

function fixedSegments(pattern) {
  if (pattern === "**") return { segments: [], wildcard: true };
  const segments = pattern.split("/");
  const index = segments.findIndex((segment) => /[*?]/.test(segment));
  return index === -1 ? { segments, wildcard: false } : { segments: segments.slice(0, index), wildcard: true };
}

export function voyagePathsOverlap(first, second) {
  const left = fixedSegments(normalizeVoyagePath(first));
  const right = fixedSegments(normalizeVoyagePath(second));
  if (!left.segments.length || !right.segments.length) return true;
  const common = Math.min(left.segments.length, right.segments.length);
  for (let index = 0; index < common; index += 1) {
    if (left.segments[index] !== right.segments[index]) return false;
  }
  if (!left.wildcard && !right.wildcard && left.segments.length === right.segments.length) return true;
  return true;
}

function directory(root) {
  return repoPath(root, PATHS.voyages);
}

function voyagePath(root, id) {
  if (!/^V-\d{4,}$/.test(id || "")) throw new Error(`Invalid Voyage ID: ${id || "missing"}`);
  return repoPath(root, `${PATHS.voyages}/${id}.json`);
}

function readVoyages(root) {
  const path = directory(root);
  if (!exists(path)) return [];
  return readdirSync(path)
    .filter((name) => /^V-\d{4,}\.json$/.test(name))
    .sort()
    .map((name) => validateVoyage(readJson(repoPath(root, `${PATHS.voyages}/${name}`))));
}

function writeVoyage(root, voyage) {
  validateVoyage(voyage);
  ensureDir(directory(root));
  writeJson(voyagePath(root, voyage.id), voyage);
  return voyage;
}

function nextId(voyages) {
  const maximum = voyages.reduce((value, voyage) => {
    const number = BigInt(voyage.id.slice(2));
    return number > value ? number : value;
  }, 0n);
  return `V-${String(maximum + 1n).padStart(4, "0")}`;
}

function event(voyage, name, at) {
  return { ...voyage, updated_at: at, history: [...voyage.history, { event: name, at }] };
}

export function listVoyages(root, { openOnly = false } = {}) {
  return readVoyages(root).filter((voyage) => !openOnly || voyage.status === "planning" || voyage.status === "active");
}

export function getVoyage(root, id) {
  const path = voyagePath(root, id);
  if (!exists(path)) throw new Error(`Unknown Voyage: ${id}`);
  return validateVoyage(readJson(path));
}

export function createVoyage(root, objective, { allowBehind = false } = {}) {
  return withProjectLock(root, "create Voyage", () => {
    const state = loadState(root);
    const canonical = assertCanonicalCurrent(root, { config: state.config, action: "Voyage plan", allowBehind });
    const voyages = readVoyages(root);
    const id = nextId(voyages);
    const proposal = cleanText(objective, "A Voyage objective");
    const predicted = impact(root, proposal);
    const proposedPaths = [...new Set(predicted.capabilities.flatMap((capability) => capability.primary_paths || []).map(normalizeVoyagePath))].sort();
    const now = new Date().toISOString();
    return writeVoyage(root, {
      schema_version: SCHEMA_VERSION,
      id,
      objective: proposal,
      status: "planning",
      created_at: now,
      updated_at: now,
      baseline: {
        ...gitBaseline(root),
        canonical_ref: canonical.ref,
        canonical_commit: canonical.canonical_commit
      },
      allow_behind: Boolean(allowBehind),
      plan_path: `${PATHS.chronicles}/${id}/plan.md`,
      proposed_paths: proposedPaths,
      leased_paths: [],
      navigators: [...new Set(predicted.navigators)].sort(),
      scope_source: null,
      activated_at: null,
      closed_at: null,
      final_commit: null,
      abandonment_reason: null,
      history: [{ event: "created", at: now }]
    });
  });
}

function navigatorsForPaths(state, paths) {
  return Object.entries(state.manifest.navigators || {})
    .filter(([, navigator]) => [...(navigator.primary_paths || []), ...(navigator.secondary_paths || [])]
      .some((navigatorPath) => paths.some((path) => voyagePathsOverlap(navigatorPath, path))))
    .map(([id]) => id)
    .sort();
}

export function activateVoyage(root, id, requestedPaths = [], { allowBehind = false } = {}) {
  return withProjectLock(root, "activate Voyage", () => {
    const state = loadState(root);
    assertCanonicalCurrent(root, { config: state.config, action: "Voyage activation", allowBehind });
    const voyage = getVoyage(root, id);
    if (voyage.status !== "planning") throw new Error(`${id} is ${voyage.status}; only a planning Voyage can activate.`);
    const paths = [...new Set((requestedPaths.length ? requestedPaths : voyage.proposed_paths).map(normalizeVoyagePath))].sort();
    if (!paths.length) throw new Error(`${id} has no predicted path scope. Pass one or more --path values from the approved plan.`);
    const active = readVoyages(root).filter((candidate) => candidate.status === "active" && candidate.id !== id);
    for (const candidate of active) {
      for (const path of paths) {
        const other = candidate.leased_paths.find((leased) => voyagePathsOverlap(path, leased));
        if (other) throw new Error(`${id} cannot activate: ${path} overlaps active ${candidate.id} at ${other}. Finish or abandon ${candidate.id}, or approve a non-overlapping scope.`);
      }
    }
    const now = new Date().toISOString();
    const activated = event({
      ...voyage,
      status: "active",
      allow_behind: voyage.allow_behind || Boolean(allowBehind),
      leased_paths: paths,
      navigators: navigatorsForPaths(state, paths),
      scope_source: requestedPaths.length ? "explicit" : "predicted",
      activated_at: now
    }, "activated", now);
    return writeVoyage(root, activated);
  });
}

export function resumeVoyage(root, id, { allowBehind = false } = {}) {
  return withProjectLock(root, "resume Voyage", () => {
    const state = loadState(root);
    assertCanonicalCurrent(root, { config: state.config, action: "Voyage resume", allowBehind });
    const voyage = getVoyage(root, id);
    if (voyage.status !== "planning" && voyage.status !== "active") throw new Error(`${id} is ${voyage.status} and cannot resume.`);
    const now = new Date().toISOString();
    return writeVoyage(root, event({ ...voyage, allow_behind: voyage.allow_behind || Boolean(allowBehind) }, "resumed", now));
  });
}

export function finishVoyage(root, id, { allowBehind = false } = {}) {
  return withProjectLock(root, "finish Voyage", () => {
    const state = loadState(root);
    assertCanonicalCurrent(root, { config: state.config, action: "Voyage finish", allowBehind });
    const voyage = getVoyage(root, id);
    if (voyage.status !== "active") throw new Error(`${id} is ${voyage.status}; only an active Voyage can finish.`);
    const now = new Date().toISOString();
    const completed = event({ ...voyage, status: "completed", allow_behind: voyage.allow_behind || Boolean(allowBehind), closed_at: now, final_commit: gitHead(root) }, "completed", now);
    return writeVoyage(root, completed);
  });
}

export function abandonVoyage(root, id, reason) {
  return withProjectLock(root, "abandon Voyage", () => {
    const voyage = getVoyage(root, id);
    if (voyage.status !== "planning" && voyage.status !== "active") throw new Error(`${id} is ${voyage.status} and cannot be abandoned.`);
    const why = cleanText(reason, "An abandonment reason");
    const now = new Date().toISOString();
    const abandoned = event({ ...voyage, status: "abandoned", closed_at: now, final_commit: gitHead(root), abandonment_reason: why }, "abandoned", now);
    return writeVoyage(root, abandoned);
  });
}

export function summarizeVoyages(root) {
  const voyages = readVoyages(root);
  return {
    total: voyages.length,
    planning: voyages.filter((item) => item.status === "planning").length,
    active: voyages.filter((item) => item.status === "active").length,
    completed: voyages.filter((item) => item.status === "completed").length,
    abandoned: voyages.filter((item) => item.status === "abandoned").length
  };
}
