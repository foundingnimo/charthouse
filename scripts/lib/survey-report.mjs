import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { relative, sep } from "node:path";
import { SURVEY_REPORT_ROLES } from "./constants.mjs";
import { exclusionMatch, repoPath, toPosix } from "./fs.mjs";
import { repositoryReconciliationStatus } from "./state.mjs";

export const SURVEY_REPORT_SCHEMA_VERSION = 1;
export { SURVEY_REPORT_ROLES };
export const SURVEY_REPORT_SCHEMA_PATH = "schemas/survey-report.schema.json";

const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const COMMON_FIELDS = ["schema_version", "role", "baseline", "summary", "findings", "unresolved", "tool_gaps"];
const ROLE_FIELDS = Object.freeze({
  structure: ["units", "dependencies", "entrypoints", "tests"],
  capability: ["capabilities"],
  documentation: ["documents", "instruction_contracts"],
  duplication: ["duplicate_groups"]
});
const TOOL_GAP_FIELDS = [
  "key", "need", "existing_tools_checked", "fallback_kind",
  "fallback_summary", "input_shape", "output_shape"
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finding(code, path, message) {
  return { code, path, message };
}

function rejectUnknownFields(value, allowed, path, errors) {
  if (!isObject(value)) return;
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) errors.push(finding("unknown-field", `${path}.${field}`, `${path}.${field} is not part of this survey contract.`));
  }
}

function requireObject(value, path, errors) {
  if (isObject(value)) return true;
  errors.push(finding("type", path, `${path} must be an object.`));
  return false;
}

function requireArray(value, path, errors) {
  if (Array.isArray(value)) return true;
  errors.push(finding("type", path, `${path} must be an array.`));
  return false;
}

function requireString(value, path, errors) {
  if (typeof value === "string" && value.trim()) return true;
  errors.push(finding("type", path, `${path} must be a non-empty string.`));
  return false;
}

function requireConfidence(value, path, errors) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) return true;
  errors.push(finding("confidence", path, `${path} must be a number from 0 to 1.`));
  return false;
}

function stableId(value, path, errors) {
  if (!requireString(value, path, errors)) return false;
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return true;
  errors.push(finding("stable-id", path, `${path} must use lowercase words separated by hyphens.`));
  return false;
}

function repositoryPath(value, path, errors, { glob = false } = {}) {
  if (!requireString(value, path, errors)) return false;
  const normalized = toPosix(value);
  const segments = normalized.split("/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || segments.includes("..")) {
    errors.push(finding("repository-path", path, `${path} must stay inside the repository.`));
    return false;
  }
  if (value.includes("\\")) {
    errors.push(finding("repository-path", path, `${path} must use forward slashes.`));
    return false;
  }
  if (glob && /[{}[\]]/.test(normalized)) {
    errors.push(finding("unsupported-glob", path, `${path} can use only literal text, *, **, and ? globs. Brace and character-class globs are not supported.`));
    return false;
  }
  if (!glob && /[*?{}[\]]/.test(normalized)) {
    errors.push(finding("exact-path", path, `${path} must be an exact repository-relative path.`));
    return false;
  }
  return true;
}

function stringArray(value, path, errors, validate = requireString) {
  if (!requireArray(value, path, errors)) return false;
  value.forEach((item, index) => validate(item, `${path}[${index}]`, errors));
  return true;
}

function uniqueValues(values, path, errors) {
  const seen = new Set();
  values.forEach((value, index) => {
    if (seen.has(value)) errors.push(finding("duplicate", `${path}[${index}]`, `${path} contains duplicate value ${value}.`));
    seen.add(value);
  });
}

function evidenceState(value, state) {
  const map = state.map;
  const contracts = map.instruction_contracts || [];
  if (contracts.some((contract) => contract.path === value)) return "mapped";
  if (exclusionMatch(value)?.source === "hard") return "excluded";
  const omittedRoots = map.scan_summary?.omitted_unit_roots || [];
  if (omittedRoots.some((root) => root === "." || value === root || value.startsWith(`${root}/`))) return "excluded";
  const perimeter = map.perimeter_regions || [];
  if (perimeter.some((region) => value === region.path || value.startsWith(`${region.path}/`))) return "excluded";
  if ((map.excluded_tracked_paths || []).some((item) => item.path === value)) return "excluded";
  if ((map.files || []).some((file) => file.path === value || file.path.startsWith(`${value.replace(/\/$/, "")}/`))) return "mapped";
  if ((map.documents || []).some((document) => document.path === value)) return "mapped";
  if ((map.units || []).some((unit) => unit.root === value || unit.manifest === value || (unit.manifests || []).includes(value))) return "mapped";
  return "unmapped";
}

function validateEvidence(value, path, errors, state) {
  const valid = stringArray(value, path, errors, (item, itemPath, itemErrors) => {
    if (!repositoryPath(item, itemPath, itemErrors)) return;
    const status = evidenceState(item, state);
    if (status === "excluded") itemErrors.push(finding("evidence-excluded", itemPath, `${itemPath} names evidence that the deterministic Map excluded.`));
    if (status === "unmapped") itemErrors.push(finding("evidence-unmapped", itemPath, `${itemPath} is not admitted evidence in the deterministic Map.`));
  });
  if (valid && value.length === 0) {
    errors.push(finding("evidence", path, `${path} must contain repository evidence.`));
  }
}

function validateFindings(items, path, errors, state) {
  if (!requireArray(items, path, errors)) return;
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!requireObject(item, itemPath, errors)) return;
    rejectUnknownFields(item, ["kind", "summary", "evidence", "confidence"], itemPath, errors);
    stableId(item.kind, `${itemPath}.kind`, errors);
    requireString(item.summary, `${itemPath}.summary`, errors);
    validateEvidence(item.evidence, `${itemPath}.evidence`, errors, state);
    requireConfidence(item.confidence, `${itemPath}.confidence`, errors);
  });
}

function validateToolGaps(items, errors) {
  if (!requireArray(items, "tool_gaps", errors)) return;
  items.forEach((item, index) => {
    const path = `tool_gaps[${index}]`;
    if (!requireObject(item, path, errors)) return;
    for (const field of Object.keys(item)) {
      if (!TOOL_GAP_FIELDS.includes(field)) errors.push(finding("unknown-field", `${path}.${field}`, `${path}.${field} is not part of the Tool Gap contract.`));
    }
    stableId(item.key, `${path}.key`, errors);
    for (const field of TOOL_GAP_FIELDS.filter((field) => !["key", "existing_tools_checked"].includes(field))) {
      requireString(item[field], `${path}.${field}`, errors);
    }
    stringArray(item.existing_tools_checked, `${path}.existing_tools_checked`, errors);
  });
}

// `accepted` revalidates a report that an Expedition already accepted against
// the Map of its time. A newer Map time or commit alone does not make it stale:
// the role checks still compare it with the current Map's structure, and a new
// scan configuration still fails.
function validateBaseline(baseline, state, errors, { accepted = false } = {}) {
  if (!requireObject(baseline, "baseline", errors)) return;
  for (const field of Object.keys(baseline)) {
    if (!["commit", "config_digest", "map_generated_at"].includes(field)) errors.push(finding("unknown-field", `baseline.${field}`, `baseline.${field} is not part of the survey baseline.`));
  }
  if (!requireString(baseline.commit, "baseline.commit", errors)) return;
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(baseline.commit)) {
    errors.push(finding("commit", "baseline.commit", "baseline.commit must be a full Git commit hash."));
  }
  if (!requireString(baseline.config_digest, "baseline.config_digest", errors)) return;
  if (!/^sha256:[0-9a-f]{64}$/.test(baseline.config_digest)) {
    errors.push(finding("digest", "baseline.config_digest", "baseline.config_digest must be a SHA-256 digest."));
  }
  if (!accepted && baseline.commit !== state.map.baseline?.commit) {
    errors.push(finding("stale-baseline", "baseline.commit", "The survey commit does not match the deterministic Map baseline."));
  }
  if (baseline.config_digest !== state.fingerprints.config_digest) {
    errors.push(finding("stale-config", "baseline.config_digest", "The survey configuration does not match the current scan configuration."));
  }
  if (!requireString(baseline.map_generated_at, "baseline.map_generated_at", errors)) return;
  if (!accepted && baseline.map_generated_at !== state.map.generated_at) {
    errors.push(finding("stale-map", "baseline.map_generated_at", "The survey report does not match the current deterministic Map."));
  }
}

function validateStructure(report, state, errors) {
  for (const field of ROLE_FIELDS.structure) requireArray(report[field], field, errors);
  if (!Array.isArray(report.units)) return;
  const ids = [];
  report.units.forEach((item, index) => {
    const path = `units[${index}]`;
    if (!requireObject(item, path, errors)) return;
    rejectUnknownFields(item, ["id", "name", "root", "purpose", "evidence", "confidence"], path, errors);
    if (stableId(item.id, `${path}.id`, errors)) ids.push(item.id);
    requireString(item.name, `${path}.name`, errors);
    repositoryPath(item.root, `${path}.root`, errors);
    requireString(item.purpose, `${path}.purpose`, errors);
    validateEvidence(item.evidence, `${path}.evidence`, errors, state);
    requireConfidence(item.confidence, `${path}.confidence`, errors);
  });
  coverage(ids, state.map.units.map((unit) => unit.id), "units", errors);
  const knownUnits = new Set(state.map.units.map((unit) => unit.id));
  validateEdges(report.dependencies, "dependencies", knownUnits, state.map.dependencies, errors, state);
  validateLocatedItems(report.entrypoints, "entrypoints", knownUnits, errors, state);
  validateLocatedItems(report.tests, "tests", knownUnits, errors, state);
}

function validateEdges(items, path, knownUnits, expectedEdges, errors, state) {
  if (!Array.isArray(items)) return;
  const observed = new Set();
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!requireObject(item, itemPath, errors)) return;
    rejectUnknownFields(item, ["from", "to", "kind", "evidence", "confidence"], itemPath, errors);
    stableId(item.from, `${itemPath}.from`, errors);
    stableId(item.to, `${itemPath}.to`, errors);
    if (typeof item.from === "string" && !knownUnits.has(item.from)) errors.push(finding("unit-unknown", `${itemPath}.from`, `${itemPath}.from is not a deterministic Map unit.`));
    if (typeof item.to === "string" && !knownUnits.has(item.to)) errors.push(finding("unit-unknown", `${itemPath}.to`, `${itemPath}.to is not a deterministic Map unit.`));
    requireString(item.kind, `${itemPath}.kind`, errors);
    if (typeof item.from === "string" && typeof item.to === "string" && typeof item.kind === "string") observed.add(`${item.from}\0${item.to}\0${item.kind}`);
    validateEvidence(item.evidence, `${itemPath}.evidence`, errors, state);
    requireConfidence(item.confidence, `${itemPath}.confidence`, errors);
  });
  for (const edge of expectedEdges || []) {
    if (!observed.has(`${edge.from}\0${edge.to}\0${edge.kind}`)) {
      errors.push(finding("coverage-missing", path, `${path} does not include deterministic edge ${edge.from} -> ${edge.to} (${edge.kind}).`));
    }
  }
}

function validateLocatedItems(items, path, knownUnits, errors, state) {
  if (!Array.isArray(items)) return;
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!requireObject(item, itemPath, errors)) return;
    rejectUnknownFields(item, ["path", "unit", "purpose", "evidence", "confidence"], itemPath, errors);
    repositoryPath(item.path, `${itemPath}.path`, errors);
    stableId(item.unit, `${itemPath}.unit`, errors);
    if (typeof item.unit === "string" && !knownUnits.has(item.unit)) errors.push(finding("unit-unknown", `${itemPath}.unit`, `${itemPath}.unit is not a deterministic Map unit.`));
    requireString(item.purpose, `${itemPath}.purpose`, errors);
    validateEvidence(item.evidence, `${itemPath}.evidence`, errors, state);
    requireConfidence(item.confidence, `${itemPath}.confidence`, errors);
  });
}

function coverage(actual, expected, path, errors) {
  uniqueValues(actual, path, errors);
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  for (const id of expectedSet) {
    if (!actualSet.has(id)) errors.push(finding("coverage-missing", path, `${path} does not cover ${id}.`));
  }
  for (const id of actualSet) {
    if (!expectedSet.has(id)) errors.push(finding("coverage-unknown", path, `${path} contains unknown identifier ${id}.`));
  }
}

function validateCapabilities(report, state, errors) {
  if (!requireArray(report.capabilities, "capabilities", errors)) return;
  const ids = [];
  const assignedUnits = [];
  report.capabilities.forEach((item, index) => {
    const path = `capabilities[${index}]`;
    if (!requireObject(item, path, errors)) return;
    rejectUnknownFields(item, [
      "id", "name", "purpose", "units", "primary_paths", "secondary_paths",
      "entrypoints", "dependencies", "consumers", "tests", "documents",
      "invariants", "shared_ownership", "unresolved_ownership", "evidence", "confidence"
    ], path, errors);
    if (stableId(item.id, `${path}.id`, errors)) ids.push(item.id);
    requireString(item.name, `${path}.name`, errors);
    requireString(item.purpose, `${path}.purpose`, errors);
    if (stringArray(item.units, `${path}.units`, errors, stableId)) assignedUnits.push(...item.units);
    if (Array.isArray(item.units) && item.units.length === 0) errors.push(finding("capability-units", `${path}.units`, "A capability must own at least one deterministic Map unit."));
    if (stringArray(item.primary_paths, `${path}.primary_paths`, errors, (value, valuePath, valueErrors) => repositoryPath(value, valuePath, valueErrors, { glob: true })) && item.primary_paths.length === 0) {
      errors.push(finding("capability-paths", `${path}.primary_paths`, "A capability must have at least one primary path."));
    }
    stringArray(item.secondary_paths, `${path}.secondary_paths`, errors, (value, valuePath, valueErrors) => repositoryPath(value, valuePath, valueErrors, { glob: true }));
    for (const field of ["entrypoints", "tests", "documents"]) {
      if (item[field] !== undefined) stringArray(item[field], `${path}.${field}`, errors, repositoryPath);
    }
    for (const field of ["dependencies", "consumers", "invariants", "shared_ownership", "unresolved_ownership"]) {
      if (item[field] !== undefined) stringArray(item[field], `${path}.${field}`, errors);
    }
    validateEvidence(item.evidence, `${path}.evidence`, errors, state);
    requireConfidence(item.confidence, `${path}.confidence`, errors);
  });
  uniqueValues(ids, "capabilities", errors);
  coverage(assignedUnits, state.map.units.map((unit) => unit.id), "capabilities.units", errors);
}

function validateDocuments(report, state, errors) {
  if (requireArray(report.documents, "documents", errors)) {
    const ids = [];
    const paths = [];
    report.documents.forEach((item, index) => {
      const path = `documents[${index}]`;
      if (!requireObject(item, path, errors)) return;
      rejectUnknownFields(item, ["id", "path", "classification", "criticality", "claims", "watches", "evidence", "confidence"], path, errors);
      if (stableId(item.id, `${path}.id`, errors)) ids.push(item.id);
      if (repositoryPath(item.path, `${path}.path`, errors)) paths.push(item.path);
      requireString(item.classification, `${path}.classification`, errors);
      requireString(item.criticality, `${path}.criticality`, errors);
      stringArray(item.claims, `${path}.claims`, errors);
      stringArray(item.watches, `${path}.watches`, errors, (value, valuePath, valueErrors) => repositoryPath(value, valuePath, valueErrors, { glob: true }));
      validateEvidence(item.evidence, `${path}.evidence`, errors, state);
      requireConfidence(item.confidence, `${path}.confidence`, errors);
    });
    uniqueValues(ids, "documents.ids", errors);
    const instructionPaths = new Set((state.map.instruction_contracts || []).map((contract) => contract.path));
    coverage(paths, state.map.documents.map((document) => document.path).filter((path) => !instructionPaths.has(path)), "documents", errors);
  }
  if (requireArray(report.instruction_contracts, "instruction_contracts", errors)) {
    const ids = [];
    report.instruction_contracts.forEach((item, index) => {
      const path = `instruction_contracts[${index}]`;
      if (!requireObject(item, path, errors)) return;
      rejectUnknownFields(item, ["id", "path", "providers", "scope", "parent", "precedence", "evidence", "confidence"], path, errors);
      if (requireString(item.id, `${path}.id`, errors)) ids.push(item.id);
      repositoryPath(item.path, `${path}.path`, errors);
      stringArray(item.providers, `${path}.providers`, errors);
      if (Array.isArray(item.providers) && item.providers.length === 0) errors.push(finding("instruction-providers", `${path}.providers`, "An Instruction Contract must name at least one provider."));
      repositoryPath(item.scope, `${path}.scope`, errors);
      if (item.parent !== null) requireString(item.parent, `${path}.parent`, errors);
      requireString(item.precedence, `${path}.precedence`, errors);
      validateEvidence(item.evidence, `${path}.evidence`, errors, state);
      requireConfidence(item.confidence, `${path}.confidence`, errors);
    });
    coverage(ids, (state.map.instruction_contracts || []).map((contract) => contract.id), "instruction_contracts", errors);
  }
}

function validateDuplicateGroups(report, state, errors) {
  if (!requireArray(report.duplicate_groups, "duplicate_groups", errors)) return;
  const observed = new Set();
  report.duplicate_groups.forEach((item, index) => {
    const path = `duplicate_groups[${index}]`;
    if (!requireObject(item, path, errors)) return;
    rejectUnknownFields(item, ["kind", "paths", "evidence", "confidence"], path, errors);
    stableId(item.kind, `${path}.kind`, errors);
    stringArray(item.paths, `${path}.paths`, errors, repositoryPath);
    if (Array.isArray(item.paths)) uniqueValues(item.paths, `${path}.paths`, errors);
    if (Array.isArray(item.paths) && item.paths.length < 2) errors.push(finding("duplicate-size", `${path}.paths`, "A duplicate group must contain at least two paths."));
    if (Array.isArray(item.paths)) observed.add([...item.paths].sort().join("\0"));
    validateEvidence(item.evidence, `${path}.evidence`, errors, state);
    requireConfidence(item.confidence, `${path}.confidence`, errors);
  });
  for (const group of state.map.duplicate_groups || []) {
    if (!observed.has([...group.paths].sort().join("\0"))) {
      errors.push(finding("coverage-missing", "duplicate_groups", `duplicate_groups does not include deterministic group ${group.id || group.paths.join(", ")}.`));
    }
  }
}

function validateParsedReport(report, expectedRole, state, options = {}) {
  const errors = [];
  const warnings = [];
  if (!requireObject(report, "report", errors)) return { errors, warnings };
  const role = SURVEY_REPORT_ROLES.includes(report.role) ? report.role : expectedRole;
  const allowedFields = new Set([...COMMON_FIELDS, ...(ROLE_FIELDS[role] || [])]);
  for (const field of Object.keys(report)) {
    if (!allowedFields.has(field)) errors.push(finding("unknown-field", field, `${field} is not part of the ${role} survey contract.`));
  }
  if (report.schema_version !== SURVEY_REPORT_SCHEMA_VERSION) {
    errors.push(finding("schema-version", "schema_version", `schema_version must be ${SURVEY_REPORT_SCHEMA_VERSION}.`));
  }
  if (!SURVEY_REPORT_ROLES.includes(report.role)) {
    errors.push(finding("role", "role", `role must be one of: ${SURVEY_REPORT_ROLES.join(", ")}.`));
  } else if (report.role !== expectedRole) {
    errors.push(finding("role-mismatch", "role", `Expected a ${expectedRole} report but found ${report.role}. The output file may have been overwritten.`));
  }
  validateBaseline(report.baseline, state, errors, options);
  requireString(report.summary, "summary", errors);
  validateFindings(report.findings, "findings", errors, state);
  validateFindings(report.unresolved, "unresolved", errors, state);
  validateToolGaps(report.tool_gaps, errors);
  if (role === "structure") validateStructure(report, state, errors);
  if (role === "capability") validateCapabilities(report, state, errors);
  if (role === "documentation") validateDocuments(report, state, errors);
  if (role === "duplication") validateDuplicateGroups(report, state, errors);
  return { errors, warnings };
}

export function validateSurveyReport(root, state, { role, file, accepted = false }) {
  const absolute = repoPath(root, file);
  if (!existsSync(absolute)) throw new Error(`Survey report does not exist: ${file}`);
  const real = realpathSync(absolute);
  const rel = relative(root, real);
  if (rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`Survey report leaves the repository: ${file}`);
  const stat = statSync(real);
  if (!stat.isFile()) throw new Error(`Survey report is not a file: ${file}`);
  if (stat.size > MAX_REPORT_BYTES) {
    return {
      valid: false,
      role,
      file,
      bytes: stat.size,
      errors: [finding("report-size", "report", `Survey report exceeds the ${MAX_REPORT_BYTES}-byte limit.`)],
      warnings: [],
      counts: {}
    };
  }
  let report;
  try {
    report = JSON.parse(readFileSync(real, "utf8"));
  } catch (error) {
    return {
      valid: false,
      role,
      file,
      bytes: stat.size,
      errors: [finding("invalid-json", "report", `Survey report is not valid JSON: ${error.message}`)],
      warnings: [],
      counts: {}
    };
  }
  const { errors, warnings } = validateParsedReport(report, role, state, { accepted });
  // A new report must match a reconciled Map. An edit after acceptance is
  // checked through the Map once reconciliation records it.
  const reconciliation = accepted ? { required: false } : repositoryReconciliationStatus(root, state.config);
  if (reconciliation.required) {
    errors.push(finding("repository-changed", "baseline", `Repository evidence changed during the surveys: ${reconciliation.reasons.join(", ")}. Reconcile and rerun the affected surveys.`));
  }
  const counts = Object.fromEntries((ROLE_FIELDS[role] || []).map((field) => [field, Array.isArray(report[field]) ? report[field].length : 0]));
  counts.findings = Array.isArray(report.findings) ? report.findings.length : 0;
  counts.unresolved = Array.isArray(report.unresolved) ? report.unresolved.length : 0;
  counts.tool_gaps = Array.isArray(report.tool_gaps) ? report.tool_gaps.length : 0;
  return { valid: errors.length === 0, role, file, bytes: stat.size, errors, warnings, counts };
}
