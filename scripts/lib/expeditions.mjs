import { copyFileSync, lstatSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { PATHS, SURVEY_REPORT_ROLES } from "./constants.mjs";
import {
  expeditionIsOpen, listExpeditions, readExpedition, recordApprovals,
  recordSurveyValidation, recordSynthesisStaged, recordSynthesisStarted
} from "./expedition-state.mjs";
import { digestJson, exists, fingerprintFile, readJson, repoPath, writeJson } from "./fs.mjs";
import { withProjectLock } from "./lock.mjs";
import { beginPublication, finishPendingPublication, finishPublication, plannedWrites } from "./publication.mjs";
import { applyMapUpdate, buildMapUpdate, loadState, repositoryReconciliationStatus } from "./state.mjs";
import { validateSurveyReport } from "./survey-report.mjs";

const TERMINAL_STATUSES = ["published", "invalidated", "failed", "abandoned"];
// Drafts that the synthesizer writes beside the draft Map. Approval covers
// them, and publication copies them to docs/charthouse/.
const DRAFT_DOCUMENTS = ["documentation-map.md", "anomalies.md"];

// A report whose file still matches its valid checkpoint is revalidated as
// accepted; any other report must match the current Map exactly.
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
  const digest = fingerprintFile(absolute);
  const accepted = survey.status === "valid" && digest === survey.report_digest;
  const validation = validateSurveyReport(root, state, { role, file: survey.report_path, accepted });
  return { ...validation, digest };
}

function fileChanged(root, path, digest) {
  const absolute = repoPath(root, path);
  return !exists(absolute) || lstatSync(absolute).isSymbolicLink() || fingerprintFile(absolute) !== digest;
}

// The synthesizer builds on repository units and capability boundaries. File
// contents and the scan time stay out of this digest, so an edit or a `map
// update` that keeps the structure does not force a new synthesis.
function mapDigest(map) {
  return digestJson({ units: map.units, capabilities: map.capabilities });
}

// An approval covers one capability definition. The approval fields stay out,
// so a draft that copies an approved boundary compares by its content.
function capabilityDigest(capability) {
  const { approved, provenance, ...definition } = capability;
  return digestJson(definition);
}

function synthesisInputs(state, expedition) {
  return {
    commit: state.map.baseline?.commit || null,
    config_digest: state.fingerprints.config_digest,
    map_digest: mapDigest(state.map),
    reports: Object.fromEntries(SURVEY_REPORT_ROLES.map((role) => [role, expedition.surveys[role].report_digest]))
  };
}

function draftDocumentPath(expedition, name) {
  return `${posix.dirname(expedition.synthesis.draft_path)}/${name}`;
}

function fileState(root, path) {
  const absolute = repoPath(root, path);
  if (!exists(absolute)) return null;
  return lstatSync(absolute).isSymbolicLink() ? "symbolic-link" : fingerprintFile(absolute);
}

// The staged digest covers the draft Map and each draft document, so that an
// approval covers everything that publication writes from the draft.
function draftDigest(root, expedition) {
  return digestJson(Object.fromEntries([
    ["map.json", fileState(root, expedition.synthesis.draft_path)],
    ...DRAFT_DOCUMENTS.map((name) => [name, fileState(root, draftDocumentPath(expedition, name))])
  ]));
}

function readDraftDocuments(root, expedition) {
  const documents = [];
  for (const name of DRAFT_DOCUMENTS) {
    const path = draftDocumentPath(expedition, name);
    const absolute = repoPath(root, path);
    if (!exists(absolute)) continue;
    if (lstatSync(absolute).isSymbolicLink()) throw new Error(`A draft document must be a regular file, not a symbolic link: ${path}`);
    documents.push({ path: `${PATHS.docs}/${name}`, text: readFileSync(absolute, "utf8") });
  }
  return documents;
}

// What moved since synthesis started: the scan configuration, the Map
// structure, an accepted survey report, or the staged draft.
function synthesisDrift(root, state, expedition) {
  const { inputs, staged } = expedition.synthesis;
  const moved = [];
  if (state.fingerprints.config_digest !== inputs.config_digest) moved.push("scan configuration");
  if (mapDigest(state.map) !== inputs.map_digest) moved.push("Map units or capability boundaries");
  for (const role of SURVEY_REPORT_ROLES) {
    if (fileChanged(root, expedition.surveys[role].report_path, inputs.reports[role])) moved.push(`${role} report`);
  }
  return { inputs: moved, draft: staged !== null && draftDigest(root, expedition) !== staged.digest };
}

function assertSynthesisCurrent(root, state, expedition, { draft = false } = {}) {
  const drift = synthesisDrift(root, state, expedition);
  if (drift.inputs.length) {
    throw new Error(`The synthesis inputs of ${expedition.id} changed: ${drift.inputs.join(", ")}. Run \`charthouse expedition resume ${expedition.id}\` for the next step.`);
  }
  if (draft && drift.draft) {
    throw new Error(`The draft Map of ${expedition.id} changed after staging. Run \`charthouse expedition stage ${expedition.id}\` again.`);
  }
}

function readDraftMap(root, expedition) {
  const path = expedition.synthesis.draft_path;
  const absolute = repoPath(root, path);
  if (!exists(absolute)) throw new Error(`The draft Map does not exist: ${path}`);
  if (lstatSync(absolute).isSymbolicLink()) throw new Error(`The draft Map must be a regular file, not a symbolic link: ${path}`);
  try {
    return readJson(absolute);
  } catch (error) {
    throw new Error(`The draft Map is not valid JSON: ${path}: ${error.message}`);
  }
}

function stringArray(value, { nonEmpty = false } = {}) {
  return Array.isArray(value) && (!nonEmpty || value.length > 0) && value.every((item) => typeof item === "string" && item.length > 0);
}

// The synthesizer decides capability boundaries and semantic findings. The
// deterministic scan decides repository units, so a draft cannot change them.
function draftMapErrors(draft, canonical) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return ["The draft Map must be a JSON object."];
  const errors = [];
  const units = Array.isArray(draft.units) ? new Set(draft.units.map((unit) => unit?.id)) : null;
  if (!units || units.size !== canonical.units.length || canonical.units.some((unit) => !units.has(unit.id))) {
    errors.push("units must match the deterministic Map. The synthesizer must not add or remove repository units.");
  }
  for (const field of ["documents", "duplicate_groups", "anomalies", "unresolved"]) {
    if (draft[field] !== undefined && !Array.isArray(draft[field])) errors.push(`${field} must be an array.`);
  }
  if (!Array.isArray(draft.capabilities) || !draft.capabilities.length) {
    errors.push("capabilities must be a non-empty array.");
    return errors;
  }
  const ids = new Set();
  draft.capabilities.forEach((capability, index) => {
    const path = `capabilities[${index}]`;
    if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    for (const field of ["id", "name", "purpose"]) {
      if (typeof capability[field] !== "string" || !capability[field].trim()) errors.push(`${path}.${field} is required.`);
    }
    if (ids.has(capability.id)) errors.push(`${path}.id ${capability.id} is a duplicate.`);
    ids.add(capability.id);
    if (!stringArray(capability.primary_paths, { nonEmpty: true })) errors.push(`${path}.primary_paths must be a non-empty array of paths.`);
    if (capability.secondary_paths !== undefined && !stringArray(capability.secondary_paths)) errors.push(`${path}.secondary_paths must be an array of paths.`);
    if (typeof capability.confidence !== "number" || capability.confidence < 0 || capability.confidence > 1) errors.push(`${path}.confidence must be a number from 0 to 1.`);
    if (!stringArray(capability.evidence)) errors.push(`${path}.evidence must be an array of strings.`);
  });
  return errors;
}

function surveyCheckpoints(root, expedition, state) {
  const surveys = {};
  const reusable = [];
  const nextRoles = [];
  for (const role of SURVEY_REPORT_ROLES) {
    const checkpoint = expedition.surveys[role];
    if (checkpoint.status !== "valid" || !state) {
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
  return { surveys, reusable, nextRoles };
}

function assertNotPublishing(expedition) {
  if (expedition.status === "publishing") {
    throw new Error(`${expedition.id} is publishing. Run \`charthouse navigator regenerate all\` to finish the publication first.`);
  }
}

function surveyInstructions(expedition, roles) {
  return roles.map((role) => `Store the ${role} report at ${expedition.surveys[role].report_path}, then run \`charthouse expedition accept-report ${expedition.id} --role ${role} --file ${expedition.surveys[role].report_path}\`.`);
}

// After synthesis starts, the accepted reports are fixed inputs. Check that
// they and the Map structure are unchanged. Do not revalidate each report
// against a Map that a later `map update` rewrote.
function summarizeSynthesis(root, expedition, state) {
  const { id, synthesis } = expedition;
  // A publication in progress already passed every check. Only finishing it is left.
  const drift = state && expedition.status !== "publishing" ? synthesisDrift(root, state, expedition) : { inputs: [], draft: false };
  const current = drift.inputs.length === 0;
  // A restart needs survey reports that are valid for the current Map.
  const checkpoints = current || !state
    ? surveyCheckpoints(root, expedition, null)
    : surveyCheckpoints(root, expedition, state);
  let next;
  if (expedition.status === "publishing") {
    next = [`Publication of ${id} was interrupted. Run \`charthouse navigator regenerate all\` to finish it. The approved result does not change.`];
  } else if (!current) {
    next = [
      `The synthesis inputs changed: ${drift.inputs.join(", ")}.`,
      ...surveyInstructions(expedition, checkpoints.nextRoles),
      `Then run \`charthouse expedition synthesize ${id} --restart\`.`
    ];
  } else if (expedition.status === "synthesizing") {
    next = [`Run the Map synthesizer with the four accepted reports. It writes the draft Map to ${synthesis.draft_path}. Then run \`charthouse expedition stage ${id}\`.`];
  } else if (drift.draft) {
    next = [`The draft Map changed after staging. Run \`charthouse expedition stage ${id}\` again.`];
  } else if (expedition.status === "awaiting-approval") {
    next = [`Show the staged draft Map at the Map gate. ${synthesis.approvals.length} of ${synthesis.staged.capabilities} capability boundaries are approved, and the draft needs approval as a whole. After explicit approval, run \`charthouse expedition approve ${id} --all\`, or approve single boundaries with --capability <id>.`];
  } else {
    next = ["Every staged capability boundary is approved. Run `charthouse navigator regenerate all` to publish."];
  }
  return {
    id,
    checkpoint_status: expedition.status,
    status: expedition.status,
    baseline: expedition.baseline,
    draft_root: expedition.draft_root,
    surveys: checkpoints.surveys,
    reusable_roles: checkpoints.reusable,
    next_roles: checkpoints.nextRoles,
    synthesis: {
      ...synthesis,
      approvals: synthesis.approvals.map((approval) => approval.capability),
      current,
      changed_inputs: drift.inputs,
      draft_changed: drift.draft
    },
    next
  };
}

function summarize(root, expedition, { verify = true } = {}) {
  const terminal = TERMINAL_STATUSES.includes(expedition.status);
  const state = verify && !terminal ? loadState(root) : null;
  if (expedition.synthesis && !terminal) return summarizeSynthesis(root, expedition, state);
  const { surveys, reusable, nextRoles } = surveyCheckpoints(root, expedition, state);
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
    synthesis: expedition.synthesis ?? null,
    next: terminal
      ? [`${expedition.id} is ${expedition.status}.`]
      : nextRoles.length
      ? surveyInstructions(expedition, nextRoles)
      : [`All four survey checkpoints are valid. Run \`charthouse expedition synthesize ${expedition.id}\`, then run the Map synthesizer with these exact reports.`]
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
    if (!expeditionIsOpen(expedition)) {
      throw new Error(`${id} is ${expedition.status}; it cannot accept a survey report.`);
    }
    assertNotPublishing(expedition);
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

// Record the synthesis inputs and give the synthesizer a copy of the current
// Map as its starting draft. Every survey must be valid for the current Map.
export function synthesizeExpedition(root, id, { restart = false } = {}) {
  return withProjectLock(root, `start synthesis for ${id}`, () => {
    const expedition = readExpedition(root, id);
    if (!expeditionIsOpen(expedition)) throw new Error(`${id} is ${expedition.status}; it cannot start synthesis.`);
    assertNotPublishing(expedition);
    if (expedition.synthesis && !restart) {
      return { outcome: "Synthesis already started", started: false, expedition: summarize(root, expedition) };
    }
    const state = loadState(root);
    // Accepted reports tolerate a pending edit, but synthesis starts from a current Map.
    const reconciliation = repositoryReconciliationStatus(root, state.config);
    if (reconciliation.required) {
      throw new Error(`${id} cannot start synthesis while repository changes are not reconciled: ${reconciliation.reasons.join(", ")}. Run \`charthouse reconcile\` first.`);
    }
    const { nextRoles } = surveyCheckpoints(root, expedition, state);
    if (nextRoles.length) {
      throw new Error(`${id} cannot start synthesis until each survey report is valid for the current Map. Not ready: ${nextRoles.join(", ")}. Run \`charthouse expedition resume ${id}\`.`);
    }
    const draftPath = `${expedition.draft_root}/synthesis/map.json`;
    // A restart starts from the current Map. The earlier draft stays beside it
    // so that the synthesizer can reuse boundaries that still hold.
    if (expedition.synthesis && exists(repoPath(root, draftPath))) {
      copyFileSync(repoPath(root, draftPath), repoPath(root, `${expedition.draft_root}/synthesis/previous-map.json`));
    }
    writeJson(repoPath(root, draftPath), state.map);
    const updated = recordSynthesisStarted(root, expedition, synthesisInputs(state, expedition));
    return {
      outcome: expedition.synthesis ? "Synthesis restarted" : "Synthesis started",
      started: true,
      draft_path: draftPath,
      expedition: summarize(root, updated)
    };
  });
}

function requireSynthesis(expedition, statuses) {
  if (!expeditionIsOpen(expedition)) throw new Error(`${expedition.id} is ${expedition.status}; it has no open synthesis.`);
  assertNotPublishing(expedition);
  if (!expedition.synthesis) throw new Error(`${expedition.id} has not started synthesis. Run \`charthouse expedition synthesize ${expedition.id}\`.`);
  if (!statuses.includes(expedition.status)) {
    throw new Error(`${expedition.id} is ${expedition.status}. Run \`charthouse expedition stage ${expedition.id}\` first.`);
  }
}

export function stageExpeditionMap(root, id) {
  return withProjectLock(root, `stage the draft Map for ${id}`, () => {
    const expedition = readExpedition(root, id);
    requireSynthesis(expedition, ["synthesizing", "awaiting-approval", "approved"]);
    const state = loadState(root);
    assertSynthesisCurrent(root, state, expedition);
    const draft = readDraftMap(root, expedition);
    const errors = draftMapErrors(draft, state.map);
    if (errors.length) throw new Error(`The draft Map cannot be staged:\n- ${errors.join("\n- ")}`);
    const capabilities = draft.capabilities.map((capability) => ({ id: capability.id, digest: capabilityDigest(capability) }));
    readDraftDocuments(root, expedition);
    const digest = draftDigest(root, expedition);
    const { expedition: updated, dropped } = recordSynthesisStaged(root, expedition, { digest, capabilities });
    return {
      outcome: "Draft Map staged",
      capabilities: capabilities.map((capability) => capability.id),
      approvals_dropped: dropped,
      expedition: summarize(root, updated)
    };
  });
}

export function approveExpedition(root, id, { capabilities = [], all = false } = {}) {
  if (all === capabilities.length > 0) throw new Error("Pass --all or one or more --capability <id> values, not both.");
  return withProjectLock(root, `approve capability boundaries for ${id}`, () => {
    const expedition = readExpedition(root, id);
    requireSynthesis(expedition, ["awaiting-approval", "approved"]);
    const state = loadState(root);
    assertSynthesisCurrent(root, state, expedition, { draft: true });
    const draft = readDraftMap(root, expedition);
    const byId = new Map(draft.capabilities.map((capability) => [capability.id, capability]));
    const unknown = capabilities.filter((capability) => !byId.has(capability));
    if (unknown.length) throw new Error(`Not in the staged draft Map: ${unknown.join(", ")}.`);
    const selected = all ? draft.capabilities : [...new Set(capabilities)].map((capability) => byId.get(capability));
    const updated = recordApprovals(root, expedition, selected.map((capability) => ({ capability: capability.id, digest: capabilityDigest(capability) })), draft.capabilities);
    const approved = new Set(updated.synthesis.approvals.map((approval) => approval.capability));
    return {
      outcome: updated.status === "approved" ? "Every capability boundary approved" : "Capability boundaries approved",
      approved: selected.map((capability) => capability.id),
      remaining: draft.capabilities.filter((capability) => !approved.has(capability.id)).map((capability) => capability.id),
      expedition: summarize(root, updated)
    };
  });
}

// A checkpoint supports publication only while it is valid and its report is
// still the exact file that Charthouse accepted.
function unpublishableRoles(root, expedition) {
  return SURVEY_REPORT_ROLES.filter((role) => {
    const survey = expedition.surveys[role];
    return survey.status !== "valid" || fileChanged(root, survey.report_path, survey.report_digest);
  });
}

function assertApproved(capabilities, remedy = "") {
  const preliminary = capabilities.filter((item) => item.approved !== true);
  if (capabilities.length && !preliminary.length) return;
  const count = `${preliminary.length} preliminary capability ${preliminary.length === 1 ? "boundary remains" : "boundaries remain"}`;
  const names = preliminary.length ? `: ${preliminary.map((item) => item.id).join(", ")}` : "";
  throw new Error(`Navigator publication requires every capability boundary to be human-approved. ${count}${names}.${remedy ? ` ${remedy}` : ""}`);
}

// While an Expedition is open, its approved draft is the only source of
// boundary decisions. Canonical state changes only when publication succeeds.
function approvedDraft(root, state, expedition) {
  if (expedition.status !== "approved") {
    throw new Error(`Navigator publication requires every capability boundary to be human-approved in the Expedition. ${expedition.id} is ${expedition.status}. Run \`charthouse expedition resume ${expedition.id}\` for the next step.`);
  }
  assertSynthesisCurrent(root, state, expedition, { draft: true });
  if (expedition.synthesis.approved_digest !== expedition.synthesis.staged.digest) {
    throw new Error(`The staged draft Map of ${expedition.id} is not the draft that was approved. Run \`charthouse expedition resume ${expedition.id}\` for the next step.`);
  }
  const draft = readDraftMap(root, expedition);
  const approvals = new Map(expedition.synthesis.approvals.map((approval) => [approval.capability, approval.digest]));
  const unapproved = draft.capabilities.filter((capability) => approvals.get(capability.id) !== capabilityDigest(capability));
  if (unapproved.length) {
    throw new Error(`Navigator publication requires every capability boundary to be human-approved. Not approved in ${expedition.id}: ${unapproved.map((capability) => capability.id).join(", ")}.`);
  }
  return { ...draft, capabilities: draft.capabilities.map((capability) => ({ ...capability, approved: true, provenance: "human-approved" })) };
}

// Refuse to replace a published result with a partial one. A rescan that lost
// a unit or most files usually means a checkout in progress or an unreadable
// directory, not an intended change.
function assertComplete(map, previous, remedy) {
  const units = new Set(map.units.map((unit) => unit.id));
  const lost = previous.units.filter((unit) => !units.has(unit.id)).map((unit) => unit.id);
  if (lost.length) {
    throw new Error(`Publication refused: the rescan lost ${lost.length === 1 ? "a unit" : "units"} that the approved Map describes: ${lost.join(", ")}. ${remedy}`);
  }
  const before = previous.files?.length || 0;
  if (before && map.files.length * 2 < before) {
    throw new Error(`Publication refused: the rescan found ${map.files.length} files, fewer than half of the ${before} files that the approved Map describes. ${remedy}`);
  }
}

// Check the approvals, the survey checkpoints, and the rescanned candidate
// under one lock, and write nothing until all pass. A package added after
// approval appears in the candidate as a new preliminary boundary. An
// Expedition publishes through a staged plan that a later writer can finish.
export function publishNavigators(root, name = "all") {
  return withProjectLock(root, "publish Navigator views", () => {
    const recovered = finishPendingPublication(root);
    if (recovered) return { recovered: true, manifest: loadState(root).manifest, expedition: recovered };
    const state = loadState(root);
    const expedition = [...listExpeditions(root)].reverse().find(expeditionIsOpen) || null;
    if (!expedition) assertApproved(state.map.capabilities);
    if (name !== "all" && !state.manifest.navigators[name]) throw new Error(`Unknown Navigator: ${name}`);
    let semantic = null;
    if (expedition) {
      const roles = unpublishableRoles(root, expedition);
      if (roles.length) {
        throw new Error(`${expedition.id} cannot publish until each survey checkpoint is valid and its report is unchanged. Not ready: ${roles.join(", ")}. Run \`charthouse expedition resume ${expedition.id}\`.`);
      }
      semantic = approvedDraft(root, state, expedition);
    }
    const update = buildMapUpdate(root, { semantic });
    assertApproved(update.map.capabilities, expedition
      ? `The repository changed after approval. Run \`charthouse map update\`, then \`charthouse expedition resume ${expedition.id}\` for the next step.`
      : "The repository changed after approval. Run `charthouse map update`, review each new boundary, and approve it before you publish.");
    assertComplete(update.map, semantic || update.current.map, expedition
      ? `If the change is intended, run \`charthouse map update\`, then \`charthouse expedition synthesize ${expedition.id} --restart\`.`
      : "If the change is intended, run `charthouse map update` first.");
    if (!expedition) return { ...applyMapUpdate(root, update), expedition: null };
    const writes = plannedWrites();
    const result = applyMapUpdate(root, update, writes);
    for (const document of readDraftDocuments(root, expedition)) writes.write(document.path, document.text);
    const started = beginPublication(root, expedition, writes.entries.values());
    return { ...result, expedition: finishPublication(root, started) };
  });
}

export function expeditionSurveyPath(id, role) {
  if (!SURVEY_REPORT_ROLES.includes(role)) throw new Error(`Unknown Expedition survey role: ${role}`);
  return `${PATHS.drafts}/${id}/surveys/${role}.json`;
}
