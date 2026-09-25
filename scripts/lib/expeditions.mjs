import { lstatSync } from "node:fs";
import { PATHS, SURVEY_REPORT_ROLES } from "./constants.mjs";
import { expeditionIsOpen, listExpeditions, readExpedition, recordExpeditionPublished, recordSurveyValidation } from "./expedition-state.mjs";
import { exists, fingerprintFile, repoPath } from "./fs.mjs";
import { withProjectLock } from "./lock.mjs";
import { applyMapUpdate, buildMapUpdate, loadState } from "./state.mjs";
import { validateSurveyReport } from "./survey-report.mjs";

function checkedReport(root, state, expedition, role) {
  const survey = expedition.surveys[role];
  const absolute = repoPath(root, survey.report_path);
  if (!exists(absolute)) {
    return {
      valid: false,
      role,
      file: survey.report_path,
      errors: [{ code: "report-missing", path: "report", message: `Survey report does not exist: ${survey.report_path}` }],
      warnings: [],
      counts: {},
      digest: null
    };
  }
  if (lstatSync(absolute).isSymbolicLink()) {
    return {
      valid: false,
      role,
      file: survey.report_path,
      errors: [{ code: "report-symlink", path: "report", message: "An Expedition report must be a regular file, not a symbolic link." }],
      warnings: [],
      counts: {},
      digest: null
    };
  }
  const validation = validateSurveyReport(root, state, { role, file: survey.report_path });
  return { ...validation, digest: fingerprintFile(absolute) };
}

function summarize(root, expedition, { verify = true } = {}) {
  const terminal = ["published", "invalidated", "failed", "abandoned"].includes(expedition.status);
  const verifyReports = verify && !terminal;
  const state = verifyReports ? loadState(root) : null;
  const surveys = {};
  const reusable = [];
  const nextRoles = [];
  for (const role of SURVEY_REPORT_ROLES) {
    const checkpoint = expedition.surveys[role];
    if (checkpoint.status !== "valid" || !verifyReports) {
      surveys[role] = { ...checkpoint, reusable: checkpoint.status === "valid" };
      if (checkpoint.status !== "valid") nextRoles.push(role);
      else reusable.push(role);
      continue;
    }
    const current = checkedReport(root, state, expedition, role);
    const unchanged = current.valid && current.digest === checkpoint.report_digest;
    surveys[role] = {
      ...checkpoint,
      status: unchanged ? "valid" : "invalid",
      reusable: unchanged,
      current_errors: unchanged ? [] : current.errors
    };
    if (unchanged) reusable.push(role);
    else nextRoles.push(role);
  }
  const effectiveStatus = terminal
    ? expedition.status
    : nextRoles.length === 0 ? "ready-for-synthesis" : "surveying";
  return {
    id: expedition.id,
    checkpoint_status: expedition.status,
    status: effectiveStatus,
    baseline: expedition.baseline,
    draft_root: expedition.draft_root,
    surveys,
    reusable_roles: reusable,
    next_roles: terminal ? [] : nextRoles,
    next: terminal
      ? [`${expedition.id} is ${expedition.status}.`]
      : nextRoles.length
      ? nextRoles.map((role) => `Store the ${role} report at ${expedition.surveys[role].report_path}, then run \`charthouse expedition accept-report ${expedition.id} --role ${role} --file ${expedition.surveys[role].report_path}\`.`)
      : ["All four survey checkpoints are valid. Run the Map synthesizer with these exact reports."]
  };
}

export function expeditionStatus(root, id = null) {
  return summarize(root, readExpedition(root, id));
}

export function resumeExpedition(root, id = null) {
  const result = expeditionStatus(root, id);
  return { outcome: `Resume ${result.id}`, ...result };
}

export function acceptExpeditionReport(root, id, { role, file }) {
  if (!SURVEY_REPORT_ROLES.includes(role)) {
    throw new Error(`--role must be one of: ${SURVEY_REPORT_ROLES.join(", ")}.`);
  }
  return withProjectLock(root, `accept ${role} report for ${id}`, () => {
    const expedition = readExpedition(root, id);
    if (!["surveying", "ready-for-synthesis"].includes(expedition.status)) {
      throw new Error(`${id} is ${expedition.status}; it cannot accept a survey report.`);
    }
    const expected = expedition.surveys[role].report_path;
    if (file !== expected) {
      throw new Error(`The ${role} report must use its isolated path: ${expected}`);
    }
    const state = loadState(root);
    const validation = checkedReport(root, state, expedition, role);
    const updated = recordSurveyValidation(root, expedition, role, validation, validation.digest);
    return {
      outcome: validation.valid ? "Survey checkpoint accepted" : "Survey checkpoint rejected",
      accepted: validation.valid,
      validation,
      expedition: summarize(root, updated)
    };
  });
}

// A checkpoint supports publication only while it is valid and its report is
// still the exact file that Charthouse accepted.
function unpublishableRoles(root, expedition) {
  return SURVEY_REPORT_ROLES.filter((role) => {
    const survey = expedition.surveys[role];
    if (survey.status !== "valid") return true;
    const absolute = repoPath(root, survey.report_path);
    return !exists(absolute) || lstatSync(absolute).isSymbolicLink() || fingerprintFile(absolute) !== survey.report_digest;
  });
}

function assertApproved(capabilities, remedy = "") {
  const preliminary = capabilities.filter((item) => item.approved !== true);
  if (capabilities.length && !preliminary.length) return;
  const count = `${preliminary.length} preliminary capability ${preliminary.length === 1 ? "boundary remains" : "boundaries remain"}`;
  const names = preliminary.length ? `: ${preliminary.map((item) => item.id).join(", ")}` : "";
  throw new Error(`Navigator publication requires every capability boundary to be human-approved. ${count}${names}.${remedy ? ` ${remedy}` : ""}`);
}

// Check the approved Map, the survey checkpoints, and the rescanned candidate
// under one lock, and write nothing until all three pass. A package added after
// approval appears in the candidate as a new preliminary boundary.
export function publishNavigators(root, name = "all") {
  return withProjectLock(root, "publish Navigator views", () => {
    const state = loadState(root);
    assertApproved(state.map.capabilities);
    if (name !== "all" && !state.manifest.navigators[name]) throw new Error(`Unknown Navigator: ${name}`);
    const expedition = [...listExpeditions(root)].reverse().find(expeditionIsOpen) || null;
    if (expedition) {
      const roles = unpublishableRoles(root, expedition);
      if (roles.length) {
        throw new Error(`${expedition.id} cannot publish until each survey checkpoint is valid and its report is unchanged. Not ready: ${roles.join(", ")}. Run \`charthouse expedition resume ${expedition.id}\`.`);
      }
    }
    const update = buildMapUpdate(root);
    assertApproved(update.map.capabilities, "The repository changed after approval. Run `charthouse map update`, review each new boundary, and approve it before you publish.");
    const result = applyMapUpdate(root, update);
    return { ...result, expedition: expedition ? recordExpeditionPublished(root, expedition) : null };
  });
}

export function expeditionSurveyPath(id, role) {
  if (!SURVEY_REPORT_ROLES.includes(role)) throw new Error(`Unknown Expedition survey role: ${role}`);
  return `${PATHS.drafts}/${id}/surveys/${role}.json`;
}
