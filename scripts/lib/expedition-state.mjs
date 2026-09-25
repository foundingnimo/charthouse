import { readdirSync } from "node:fs";
import { EXPEDITION_SCHEMA_VERSION, PATHS, SURVEY_REPORT_ROLES } from "./constants.mjs";
import { ensureDir, exists, readJson, repoPath, writeJson, writeText } from "./fs.mjs";

const OPEN_STATUSES = new Set(["surveying", "ready-for-synthesis", "synthesizing", "awaiting-approval", "approved", "publishing"]);
// A synthesis record exists from `expedition synthesize` until publication.
// Before a draft Map is staged the status is synthesizing; after, it waits for approval.
const SYNTHESIS_STATUSES = new Set(["synthesizing", "awaiting-approval", "approved"]);
const DIGEST = /^sha256:[0-9a-f]{64}$/;
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

// A publication record exists from the moment the publisher commits to a staged
// plan. `completed_at` stays null until every planned write has landed.
function validatePublication(value, expedition) {
  const publication = value ?? null;
  if (expedition.status === "publishing" && (!publication || publication.completed_at !== null)) fail("a publishing Expedition needs an unfinished publication record.");
  if (!publication) return;
  requireShape(publication, "publication", ["started_at", "plan_digest", "completed_at", "written", "removed"]);
  if (!validTime(publication.started_at)) fail("publication.started_at must be a timestamp.");
  if (!DIGEST.test(publication.plan_digest || "")) fail("publication.plan_digest is invalid.");
  if (publication.completed_at !== null && !validTime(publication.completed_at)) fail("publication.completed_at must be a timestamp or null.");
  if (publication.completed_at !== null && expedition.status !== "published") fail("a finished publication belongs to a published Expedition.");
  for (const field of ["written", "removed"]) {
    if (!Number.isInteger(publication[field]) || publication[field] < 0) fail(`publication.${field} must be a non-negative integer.`);
  }
}

function validateSynthesis(value, expedition) {
  const synthesis = value ?? null;
  if ((SYNTHESIS_STATUSES.has(expedition.status) || expedition.status === "publishing") && !synthesis) fail(`a ${expedition.status} Expedition needs a synthesis record.`);
  if (["surveying", "ready-for-synthesis"].includes(expedition.status) && synthesis) fail(`a ${expedition.status} Expedition cannot have a synthesis record.`);
  if (!synthesis) return;
  requireShape(synthesis, "synthesis", ["started_at", "draft_path", "inputs", "staged", "approvals", "approved_digest"]);
  if (!validTime(synthesis.started_at)) fail("synthesis.started_at must be a timestamp.");
  if (synthesis.draft_path !== `${expedition.draft_root}/synthesis/map.json`) fail("synthesis.draft_path is not isolated.");
  requireShape(synthesis.inputs, "synthesis.inputs", ["commit", "config_digest", "map_digest", "reports"]);
  if (!nullableString(synthesis.inputs.commit)) fail("synthesis.inputs.commit must be a string or null.");
  if (!DIGEST.test(synthesis.inputs.config_digest || "")) fail("synthesis.inputs.config_digest is invalid.");
  if (!DIGEST.test(synthesis.inputs.map_digest || "")) fail("synthesis.inputs.map_digest is invalid.");
  requireShape(synthesis.inputs.reports, "synthesis.inputs.reports", SURVEY_REPORT_ROLES);
  for (const role of SURVEY_REPORT_ROLES) {
    if (!DIGEST.test(synthesis.inputs.reports[role] || "")) fail(`synthesis.inputs.reports.${role} is invalid.`);
  }
  if (expedition.status === "synthesizing" && synthesis.staged !== null) fail("a synthesizing Expedition has no staged draft yet.");
  if (["awaiting-approval", "approved"].includes(expedition.status) && synthesis.staged === null) fail(`a ${expedition.status} Expedition needs a staged draft.`);
  if (synthesis.staged !== null) {
    requireShape(synthesis.staged, "synthesis.staged", ["at", "digest", "capabilities"]);
    if (!validTime(synthesis.staged.at)) fail("synthesis.staged.at must be a timestamp.");
    if (!DIGEST.test(synthesis.staged.digest || "")) fail("synthesis.staged.digest is invalid.");
    if (!Number.isInteger(synthesis.staged.capabilities) || synthesis.staged.capabilities < 1) fail("synthesis.staged.capabilities must be a positive integer.");
  }
  if (!Array.isArray(synthesis.approvals)) fail("synthesis.approvals must be an array.");
  const approved = new Set();
  synthesis.approvals.forEach((approval, index) => {
    const path = `synthesis.approvals[${index}]`;
    requireShape(approval, path, ["capability", "digest", "at"]);
    if (typeof approval.capability !== "string" || !approval.capability) fail(`${path}.capability is required.`);
    if (approved.has(approval.capability)) fail(`${path}.capability is a duplicate.`);
    approved.add(approval.capability);
    if (!DIGEST.test(approval.digest || "")) fail(`${path}.digest is invalid.`);
    if (!validTime(approval.at)) fail(`${path}.at must be a timestamp.`);
  });
  if (synthesis.approved_digest !== null && !DIGEST.test(synthesis.approved_digest || "")) fail("synthesis.approved_digest is invalid.");
  if (expedition.status === "approved" && synthesis.approved_digest !== synthesis.staged?.digest) fail("an approved Expedition must approve its staged draft.");
}

export function validateExpedition(value) {
  requireShape(value, "record", ["schema_version", "id", "status", "created_at", "updated_at", "baseline", "draft_root", "surveys", "events"], ["synthesis", "publication"]);
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
    requireShape(survey, `surveys.${role}`, ["role", "status", "report_path", "report_digest", "validated_at", "attempts", "validation_errors"], ["window"]);
    const window = survey.window ?? null;
    if (window !== null) {
      requireShape(window, `surveys.${role}.window`, ["started_at", "head_commit", "signature", "proof"]);
      if (!validTime(window.started_at)) fail(`surveys.${role}.window.started_at must be a timestamp.`);
      if (!nullableString(window.head_commit)) fail(`surveys.${role}.window.head_commit must be a string or null.`);
      if (!DIGEST.test(window.signature || "")) fail(`surveys.${role}.window.signature is invalid.`);
      if (!DIGEST.test(window.proof || "")) fail(`surveys.${role}.window.proof is invalid.`);
    }
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
  validateSynthesis(value.synthesis, value);
  validatePublication(value.publication, value);
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
    validation_errors: [],
    window: null
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
    synthesis: null,
    publication: null,
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
  // An unchanged re-accept changes nothing, unless it also closes an open window.
  if (validation.valid && previous.status === "valid" && previous.report_digest === reportDigest && !previous.window) return expedition;
  const now = new Date().toISOString();
  const next = structuredClone(expedition);
  // Acceptance or rejection closes the survey window. Another run needs a new one.
  next.surveys[role] = {
    ...previous,
    status: validation.valid ? "valid" : "invalid",
    report_digest: reportDigest,
    validated_at: now,
    attempts: previous.attempts + 1,
    validation_errors: validation.errors || [],
    window: null
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
  // A synthesis used the earlier reports, so a changed report discards it.
  if (next.synthesis) {
    next.synthesis = null;
    next.events.push({ at: now, type: "synthesis-discarded", role, detail: "A survey report changed after synthesis started." });
  }
  return writeExpedition(root, next);
}

// A survey window records the repository state before a survey agent starts,
// so that acceptance can reject a report whose survey wrote repository files.
// `proof` binds that state to a token that only the caller holds.
export function recordSurveyStarted(root, expedition, role, { head_commit: headCommit, signature, proof }) {
  if (!SURVEY_REPORT_ROLES.includes(role)) throw new Error(`Unknown Expedition survey role: ${role}`);
  const now = new Date().toISOString();
  const next = structuredClone(expedition);
  next.surveys[role] = { ...next.surveys[role], window: { started_at: now, head_commit: headCommit, signature, proof } };
  next.updated_at = now;
  next.events.push({ at: now, type: "survey-started", role, detail: "The repository state before the survey is recorded." });
  return writeExpedition(root, next);
}

function allApproved(approvals, capabilities) {
  const approved = new Set(approvals.map((approval) => approval.capability));
  return capabilities.every((capability) => approved.has(capability.id));
}

// Approvals stay in the Expedition until publication. Each boundary approval
// covers one capability definition, and approved_digest records the staged
// draft that a person approved as a whole. A restart keeps each boundary
// approval; staging keeps only those whose capability is unchanged. Any change
// to the staged draft needs a new approval, even when every boundary held.
export function recordSynthesisStarted(root, expedition, inputs) {
  const now = new Date().toISOString();
  const next = structuredClone(expedition);
  const restart = Boolean(expedition.synthesis);
  next.synthesis = {
    started_at: now,
    draft_path: `${expedition.draft_root}/synthesis/map.json`,
    inputs,
    staged: null,
    approvals: expedition.synthesis?.approvals || [],
    approved_digest: null
  };
  next.status = "synthesizing";
  next.updated_at = now;
  next.events.push({ at: now, type: restart ? "synthesis-restarted" : "synthesis-started", detail: "The synthesis inputs are recorded." });
  return writeExpedition(root, next);
}

// capabilities: [{ id, digest }] from the staged draft Map.
export function recordSynthesisStaged(root, expedition, { digest, capabilities }) {
  const now = new Date().toISOString();
  const next = structuredClone(expedition);
  const current = new Map(capabilities.map((capability) => [capability.id, capability.digest]));
  const kept = expedition.synthesis.approvals.filter((approval) => current.get(approval.capability) === approval.digest);
  const dropped = expedition.synthesis.approvals.filter((approval) => !kept.includes(approval)).map((approval) => approval.capability);
  next.synthesis.staged = { at: now, digest, capabilities: capabilities.length };
  next.synthesis.approvals = kept;
  if (next.synthesis.approved_digest !== digest) next.synthesis.approved_digest = null;
  next.status = allApproved(kept, capabilities) && next.synthesis.approved_digest === digest ? "approved" : "awaiting-approval";
  next.updated_at = now;
  next.events.push({ at: now, type: "draft-staged", detail: `${capabilities.length} capability boundaries staged for approval.` });
  if (dropped.length) next.events.push({ at: now, type: "approvals-dropped", detail: `Changed or removed: ${dropped.join(", ")}.` });
  return { expedition: writeExpedition(root, next), dropped };
}

// approvals: [{ capability, digest }]; capabilities: [{ id }] from the staged draft Map.
export function recordApprovals(root, expedition, approvals, capabilities) {
  const now = new Date().toISOString();
  const next = structuredClone(expedition);
  const byCapability = new Map(next.synthesis.approvals.map((approval) => [approval.capability, approval]));
  for (const approval of approvals) byCapability.set(approval.capability, { ...approval, at: now });
  next.synthesis.approvals = [...byCapability.values()].sort((left, right) => left.capability.localeCompare(right.capability));
  const complete = allApproved(next.synthesis.approvals, capabilities);
  next.synthesis.approved_digest = complete ? next.synthesis.staged.digest : null;
  next.status = complete ? "approved" : "awaiting-approval";
  next.updated_at = now;
  next.events.push({ at: now, type: "capabilities-approved", detail: approvals.map((approval) => approval.capability).join(", ") });
  return writeExpedition(root, next);
}

// The commit point of a publication: the staged plan is complete, so any later
// writer can finish it without a new decision.
export function recordPublicationStarted(root, expedition, planDigest) {
  const now = new Date().toISOString();
  const next = structuredClone(expedition);
  next.status = "publishing";
  next.publication = { started_at: now, plan_digest: planDigest, completed_at: null, written: 0, removed: 0 };
  next.updated_at = now;
  next.events.push({ at: now, type: "publication-started", detail: "The approved Map and its views are staged for publication." });
  return writeExpedition(root, next);
}

export function recordPublicationFinished(root, expedition, { written, removed }) {
  const now = new Date().toISOString();
  const next = structuredClone(expedition);
  next.status = "published";
  next.publication = { ...next.publication, completed_at: now, written, removed };
  next.updated_at = now;
  next.events.push({ at: now, type: "published", detail: `Approved Map and Navigator views published: ${written} written, ${removed} removed.` });
  return writeExpedition(root, next);
}

export function expeditionIsOpen(expedition) {
  return OPEN_STATUSES.has(expedition.status);
}
