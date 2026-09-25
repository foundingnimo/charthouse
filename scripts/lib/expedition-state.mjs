import { readdirSync } from "node:fs";
import { EXPEDITION_SCHEMA_VERSION, PATHS, SURVEY_REPORT_ROLES } from "./constants.mjs";
import { ensureDir, exists, readJson, repoPath, writeJson, writeText } from "./fs.mjs";

const OPEN_STATUSES = new Set(["surveying", "ready-for-synthesis", "awaiting-approval", "approved", "publishing"]);
const EXPEDITION_ID = /^E-(\d{4,})$/;

function fail(message) {
  throw new Error(`Invalid Expedition: ${message}`);
}

function validTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value) {
  return value === null || typeof value === "string";
}

// Keep this shape in step with schemas/expedition.schema.json. Every read and
// write passes through here, so a malformed record never propagates.
function requireShape(value, path, fields, optional = []) {
  if (!isObject(value)) fail(`${path} must be an object.`);
  for (const field of Object.keys(value)) {
    if (!fields.includes(field) && !optional.includes(field)) fail(`${path}.${field} is not part of the Expedition schema.`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) fail(`${path}.${field} is required.`);
  }
}

export function validateExpedition(value) {
  requireShape(value, "record", ["schema_version", "id", "status", "created_at", "updated_at", "baseline", "draft_root", "surveys", "events"]);
  if (value.schema_version !== EXPEDITION_SCHEMA_VERSION) fail(`schema_version must be ${EXPEDITION_SCHEMA_VERSION}.`);
  if (!EXPEDITION_ID.test(value.id || "")) fail("id must use E-0001 form.");
  if (![...OPEN_STATUSES, "published", "invalidated", "failed", "abandoned"].includes(value.status)) fail(`unsupported status ${value.status || "missing"}.`);
  if (!validTime(value.created_at) || !validTime(value.updated_at)) fail("created_at and updated_at must be timestamps.");
  requireShape(value.baseline, "baseline", ["commit", "dirty", "canonical_ref", "canonical_commit", "config_digest", "map_generated_at"]);
  if (!nullableString(value.baseline.commit)) fail("baseline.commit must be a string or null.");
  if (typeof value.baseline.dirty !== "boolean") fail("baseline.dirty must be boolean.");
  if (typeof value.baseline.canonical_ref !== "string" || !value.baseline.canonical_ref) fail("baseline.canonical_ref is required.");
  if (!nullableString(value.baseline.canonical_commit)) fail("baseline.canonical_commit must be a string or null.");
  if (!/^sha256:[0-9a-f]{64}$/.test(value.baseline.config_digest || "")) fail("baseline.config_digest is invalid.");
  if (!validTime(value.baseline.map_generated_at)) fail("baseline.map_generated_at must be a timestamp.");
  if (typeof value.draft_root !== "string" || value.draft_root !== `${PATHS.drafts}/${value.id}`) fail("draft_root does not match the Expedition id.");
  requireShape(value.surveys, "surveys", SURVEY_REPORT_ROLES);
  for (const role of SURVEY_REPORT_ROLES) {
    const survey = value.surveys[role];
    requireShape(survey, `surveys.${role}`, ["role", "status", "report_path", "report_digest", "validated_at", "attempts", "validation_errors"]);
    if (survey.role !== role) fail(`surveys.${role} has the wrong role.`);
    if (!["missing", "invalid", "valid"].includes(survey.status)) fail(`surveys.${role}.status is invalid.`);
    if (survey.report_path !== `${value.draft_root}/surveys/${role}.json`) fail(`surveys.${role}.report_path is not isolated.`);
    if (!nullableString(survey.report_digest)) fail(`surveys.${role}.report_digest must be a string or null.`);
    if (survey.validated_at !== null && !validTime(survey.validated_at)) fail(`surveys.${role}.validated_at must be a timestamp or null.`);
    if (!Number.isInteger(survey.attempts) || survey.attempts < 0) fail(`surveys.${role}.attempts is invalid.`);
    if (!Array.isArray(survey.validation_errors)) fail(`surveys.${role}.validation_errors must be an array.`);
    survey.validation_errors.forEach((error, index) => {
      const path = `surveys.${role}.validation_errors[${index}]`;
      requireShape(error, path, ["code", "path", "message"]);
      if (![error.code, error.path, error.message].every((item) => typeof item === "string")) fail(`${path} fields must be strings.`);
    });
    if (survey.status === "valid" && (!/^sha256:[0-9a-f]{64}$/.test(survey.report_digest || "") || !validTime(survey.validated_at))) {
      fail(`surveys.${role} needs a digest and validation time.`);
    }
  }
  if (!Array.isArray(value.events)) fail("events must be an array.");
  value.events.forEach((event, index) => {
    const path = `events[${index}]`;
    requireShape(event, path, ["at", "type"], ["role", "detail"]);
    if (!validTime(event.at)) fail(`${path}.at must be a timestamp.`);
    if (typeof event.type !== "string") fail(`${path}.type must be a string.`);
    if (Object.hasOwn(event, "role") && !SURVEY_REPORT_ROLES.includes(event.role)) fail(`${path}.role is not a survey role.`);
    if (Object.hasOwn(event, "detail") && typeof event.detail !== "string") fail(`${path}.detail must be a string.`);
  });
  return value;
}

export function expeditionRecordPath(root, id) {
  if (!EXPEDITION_ID.test(id || "")) fail("id must use E-0001 form.");
  return repoPath(root, `${PATHS.expeditions}/${id}.json`);
}

function expeditionIds(root) {
  const directory = repoPath(root, PATHS.expeditions);
  if (!exists(directory)) return [];
  return readdirSync(directory)
    .map((name) => name.replace(/\.json$/, ""))
    .filter((name) => EXPEDITION_ID.test(name))
    .sort((left, right) => Number(left.slice(2)) - Number(right.slice(2)));
}

function nextExpeditionId(root) {
  const last = expeditionIds(root).at(-1);
  return `E-${String(last ? Number(last.slice(2)) + 1 : 1).padStart(4, "0")}`;
}

export function listExpeditions(root) {
  return expeditionIds(root).map((id) => validateExpedition(readJson(expeditionRecordPath(root, id))));
}

export function readExpedition(root, id = null) {
  const records = listExpeditions(root);
  const selected = id
    ? records.find((item) => item.id === id)
    : [...records].reverse().find((item) => OPEN_STATUSES.has(item.status)) || records.at(-1);
  if (!selected) {
    if (id) throw new Error(`Unknown Expedition: ${id}`);
    throw new Error("No Expedition transaction exists. Run `charthouse init`.");
  }
  return selected;
}

export function createExpeditionCheckpoint(root, { map, fingerprints, canonical }) {
  const open = listExpeditions(root).find((item) => OPEN_STATUSES.has(item.status));
  if (open) throw new Error(`${open.id} is already ${open.status}. Resume it before starting another Expedition.`);
  const id = nextExpeditionId(root);
  const now = new Date().toISOString();
  const draftRoot = `${PATHS.drafts}/${id}`;
  ensureDir(repoPath(root, PATHS.expeditions));
  ensureDir(repoPath(root, `${draftRoot}/surveys`));
  ensureDir(repoPath(root, `${draftRoot}/receipts`));
  ensureDir(repoPath(root, `${draftRoot}/synthesis`));
  ensureDir(repoPath(root, `${draftRoot}/publication`));
  writeText(repoPath(root, `${PATHS.drafts}/.gitignore`), "*\n!.gitignore\n");
  const surveys = Object.fromEntries(SURVEY_REPORT_ROLES.map((role) => [role, {
    role,
    status: "missing",
    report_path: `${draftRoot}/surveys/${role}.json`,
    report_digest: null,
    validated_at: null,
    attempts: 0,
    validation_errors: []
  }]));
  const expedition = {
    schema_version: EXPEDITION_SCHEMA_VERSION,
    id,
    status: "surveying",
    created_at: now,
    updated_at: now,
    baseline: {
      commit: map.baseline?.commit || null,
      dirty: Boolean(map.baseline?.dirty),
      canonical_ref: canonical.ref,
      canonical_commit: canonical.canonical_commit || null,
      config_digest: fingerprints.config_digest,
      map_generated_at: map.generated_at
    },
    draft_root: draftRoot,
    surveys,
    events: [{ at: now, type: "started", detail: "The deterministic Expedition scaffold is ready." }]
  };
  validateExpedition(expedition);
  writeJson(expeditionRecordPath(root, id), expedition);
  return expedition;
}

export function writeExpedition(root, expedition) {
  validateExpedition(expedition);
  writeJson(expeditionRecordPath(root, expedition.id), expedition);
  return expedition;
}

export function recordSurveyValidation(root, expedition, role, validation, reportDigest) {
  if (!SURVEY_REPORT_ROLES.includes(role)) throw new Error(`Unknown Expedition survey role: ${role}`);
  const previous = expedition.surveys[role];
  if (validation.valid && previous.status === "valid" && previous.report_digest === reportDigest) return expedition;
  const now = new Date().toISOString();
  const next = structuredClone(expedition);
  next.surveys[role] = {
    ...previous,
    status: validation.valid ? "valid" : "invalid",
    report_digest: reportDigest,
    validated_at: now,
    attempts: previous.attempts + 1,
    validation_errors: validation.errors || []
  };
  next.status = SURVEY_REPORT_ROLES.every((item) => next.surveys[item].status === "valid")
    ? "ready-for-synthesis"
    : "surveying";
  next.updated_at = now;
  next.events.push({
    at: now,
    type: validation.valid ? "survey-accepted" : "survey-rejected",
    role,
    detail: validation.valid ? "The report passed deterministic validation." : `${validation.errors?.length || 0} validation error(s).`
  });
  return writeExpedition(root, next);
}

export function recordExpeditionPublished(root, expedition, detail = "Approved Map and Navigator views published.") {
  if (!expedition || expedition.status === "published") return expedition || null;
  const now = new Date().toISOString();
  const next = structuredClone(expedition);
  next.status = "published";
  next.updated_at = now;
  next.events.push({ at: now, type: "published", detail });
  return writeExpedition(root, next);
}

export function expeditionIsOpen(expedition) {
  return OPEN_STATUSES.has(expedition.status);
}
