import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { MANIFEST_SCHEMA_VERSION, CHARTHOUSE_VERSION, PATHS, SCHEMA_VERSION } from "./constants.mjs";
import { exists, fingerprintPath, repoPath, walkFiles } from "./fs.mjs";
import { charterMessage, charterState } from "./charter.mjs";
import { createGitignoredPolicy, documentFingerprintPolicy, fingerprintExcludes, fingerprintOptions } from "./policy.mjs";
import { loadState, repositoryMigrationStatus, repositoryReconciliationStatus } from "./state.mjs";
import { summarizeToolGaps } from "./tool-gaps.mjs";
import { summarizeVoyages } from "./voyages.mjs";
import { canonicalRefStatus } from "./freshness.mjs";
import { listExpeditions } from "./expedition-state.mjs";
import { expeditionStatus } from "./expeditions.mjs";

const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".go", ".h", ".hpp", ".java", ".js",
  ".jsx", ".kt", ".mjs", ".php", ".py", ".rb", ".rs", ".sh", ".sql",
  ".swift", ".ts", ".tsx", ".vue"
]);

function finding(level, code, message, path = null) {
  return { level, code, message, path };
}

function driftLevel(criticality) {
  return criticality === "binding" ? "error" : "warning";
}

function publicationState(state, errors, warnings) {
  const capabilities = state.map.capabilities || [];
  const map = capabilities.length > 0 && capabilities.every((capability) => capability.approved === true)
    ? "published"
    : "draft";
  const bearing = errors > 0 ? "blocked" : warnings > 0 ? "needs-review" : "healthy";
  return {
    map,
    bearing,
    state: map === "draft" ? "draft" : bearing === "healthy" ? "published" : "published_with_findings"
  };
}

function validateRelativePath(root, path, findings, code) {
  try {
    repoPath(root, path);
    return true;
  } catch (error) {
    findings.push(finding("error", code, error.message, path));
    return false;
  }
}

// Which watched paths of each document no longer match their fingerprints.
// The Bearing check reports these, and `charthouse docs review` builds its packets
// from the same answer, so the two can never disagree.
export function documentDrift(root, state) {
  const ignoredPolicy = createGitignoredPolicy(root, state.config);
  const drift = {};
  for (const [id, document] of Object.entries(state.manifest.documents || {})) {
    const entry = { changed: [], unfingerprinted: [], invalid: [] };
    // A historical document records past state, such as a dated status report
    // for people. Changed evidence cannot make it wrong, so it is never suspect.
    const historical = document.status === "historical" || document.criticality === "historical";
    for (const watched of historical ? [] : document.watches || []) {
      try {
        repoPath(root, watched);
      } catch (error) {
        entry.invalid.push({ path: watched, message: error.message });
        continue;
      }
      const expected = state.fingerprints.documents?.[id]?.[watched];
      const policy = documentFingerprintPolicy(document, watched, state.config, state.map, root, ignoredPolicy);
      const actual = fingerprintPath(root, watched, policy.excludes, policy.options);
      if (!expected) entry.unfingerprinted.push(watched);
      else if (actual !== expected) entry.changed.push(watched);
    }
    drift[id] = entry;
  }
  return drift;
}

export function checkRepository(root) {
  const state = loadState(root);
  const findings = [];
  const canonical = canonicalRefStatus(root, state.config);
  const ignoredPolicy = createGitignoredPolicy(root, state.config);
  const fingerprintOpts = fingerprintOptions(state.config, state.map, root, ignoredPolicy);
  const fingerprintExclusionPatterns = (watched = ".") => fingerprintExcludes(state.config, state.map, watched, ignoredPolicy);
  if (state.map.schema_version !== SCHEMA_VERSION) {
    findings.push(finding("error", "map-schema", `Map schema ${state.map.schema_version} is not supported.`));
  }
  // A patch release changes no Map shape, so only a major or minor difference
  // asks for a Map update. The exact version still shows in `status`.
  const minor = (version) => String(version || "").split(".").slice(0, 2).join(".");
  if (minor(state.map.charthouse_version) !== minor(CHARTHOUSE_VERSION)) {
    findings.push(finding("warning", "map-version", `Map version ${state.map.charthouse_version} differs from tool version ${CHARTHOUSE_VERSION}. Run \`charthouse map update\`.`));
  }
  if (state.fingerprints.schema_version !== SCHEMA_VERSION || !Number.isInteger(state.manifest.schema_version) || state.manifest.schema_version > MANIFEST_SCHEMA_VERSION || state.manifest.schema_version < 1) {
    findings.push(finding("error", "state-schema", "A Charthouse state file has an unsupported schema."));
  }
  const migration = repositoryMigrationStatus(root);
  const reconciliation = repositoryReconciliationStatus(root, state.config);
  if (!migration.supported) {
    findings.push(finding("error", "migration-unsupported", `Repository context cannot be migrated automatically: ${migration.reasons.join(", ")}.`));
  } else if (migration.required) {
    findings.push(finding("warning", "migration-required", `Repository context needs migration to manifest schema ${MANIFEST_SCHEMA_VERSION}. Run \`charthouse reconcile\`.`));
  }
  const reconciliationReasons = reconciliation.reasons.filter((reason) => reason !== "working-tree");
  if (reconciliationReasons.length) {
    findings.push(finding(
      "warning",
      "reconciliation-required",
      `Repository context needs reconciliation because ${reconciliationReasons.join(", ")} changed. Run \`charthouse reconcile\`.`
    ));
  }
  if (canonical.relationship === "not-git") {
    findings.push(finding("error", "canonical-branch-unavailable", "Charthouse requires a Git repository and one explicit canonical branch."));
  } else if (canonical.relationship === "no-head") {
    findings.push(finding("error", "canonical-branch-unavailable", "Charthouse requires at least one Git commit before a canonical branch can be pinned."));
  } else if (canonical.relationship === "unpinned") {
    findings.push(finding("error", "canonical-branch-unpinned", "git.canonical_ref must name one exact local or remote-tracking branch. Ask the user which branch represents accepted history; do not infer it."));
  } else if (canonical.relationship === "missing") {
    findings.push(finding("error", "canonical-branch-missing", `Configured canonical branch ${canonical.ref} is not available locally. Fetch it or change git.canonical_ref in .charthouse/config.json.`));
  } else if (canonical.relationship === "not-branch") {
    findings.push(finding("error", "canonical-ref-not-branch", `Configured canonical ref ${canonical.ref} does not resolve to a branch.`));
  } else if (canonical.relationship === "symbolic") {
    findings.push(finding("error", "canonical-branch-symbolic", `Configured canonical ref ${canonical.ref} is symbolic. Pin ${canonical.symbolic_target || "its exact target branch"} instead.`));
  } else if (canonical.ref && ["behind", "diverged", "detached", "unknown"].includes(canonical.relationship)) {
    const counts = canonical.behind === null ? "" : ` (${canonical.behind} behind, ${canonical.ahead} ahead)`;
    findings.push(finding("warning", `canonical-${canonical.relationship}`, `Checkout is ${canonical.relationship} relative to canonical ${canonical.ref}${counts}. Update the branch from canonical history, or use --allow-behind deliberately.`));
  }
  for (const contract of state.map.instruction_contracts || []) {
    const document = state.manifest.documents?.[contract.id];
    if (!document || document.kind !== "instruction-contract" || document.path !== contract.path) {
      findings.push(finding("error", "instruction-contract-unregistered", `${contract.path} is not registered as a binding Instruction Contract. Run \`charthouse reconcile\`.`, contract.path));
    }
  }
  for (const warning of state.map.instruction_file_warnings || []) {
    findings.push(finding(
      "warning",
      "instruction-file-oversized",
      `${warning.path} is ${warning.size_bytes} bytes, above the ${warning.warning_threshold_bytes}-byte host-context warning threshold. Split global rules from scoped guidance.`,
      warning.path
    ));
  }
  for (const group of state.map.instruction_duplicate_groups || []) {
    findings.push(finding(
      "information",
      "instruction-contract-duplicate",
      `Exact instruction text appears in ${group.paths.length} scopes: ${group.paths.join(", ")}. Review whether scoped guidance can inherit instead.`,
      group.paths[0]
    ));
  }
  for (const capability of state.map.capabilities || []) {
    if (capability.approved !== true) {
      findings.push(finding("information", "capability-preliminary", `${capability.id} needs human boundary review.`));
    }
  }

  const drift = documentDrift(root, state);
  for (const [id, document] of Object.entries(state.manifest.documents || {})) {
    if (!validateRelativePath(root, document.path, findings, "document-path")) continue;
    if (!exists(repoPath(root, document.path))) {
      findings.push(finding(driftLevel(document.criticality), "document-missing", `${id} is missing.`, document.path));
    }
    if (document.status === "suspect" || document.status === "stale") {
      findings.push(finding(driftLevel(document.criticality), `document-${document.status}`, `${id} is declared ${document.status}.`, document.path));
    }
    const entry = drift[id];
    for (const invalid of entry.invalid) findings.push(finding("error", "watch-path", invalid.message, invalid.path));
    for (const watched of entry.unfingerprinted) findings.push(finding("warning", "fingerprint-missing", `${id} has no fingerprint for ${watched}.`, document.path));
    for (const watched of entry.changed) findings.push(finding(driftLevel(document.criticality), "document-suspect", `${id} is suspect because ${watched} changed.`, document.path));
  }

  for (const [id, record] of Object.entries(state.manifest.knowledge || {})) {
    if (!validateRelativePath(root, record.source, findings, "knowledge-path")) continue;
    if (!exists(repoPath(root, record.source))) {
      findings.push(finding(record.status === "active" ? "error" : "warning", "knowledge-missing", `${id} has no source record.`, record.source));
    }
    if (record.status === "suspect" || record.status === "stale") {
      findings.push(finding("warning", `knowledge-${record.status}`, `${id} is declared ${record.status}.`, record.source));
    }
    for (const watched of record.paths || []) {
      if (!validateRelativePath(root, watched, findings, "knowledge-watch")) continue;
      const expected = state.fingerprints.records?.[id]?.[watched];
      const actual = fingerprintPath(root, watched, fingerprintExclusionPatterns(watched), fingerprintOpts);
      if (!expected || actual !== expected) {
        const level = record.status === "active" ? "warning" : "information";
        findings.push(finding(level, "knowledge-suspect", `${id} needs verification because ${watched} changed.`, record.source));
      }
    }
    if (record.status === "active" && !record.generated_rule) {
      findings.push(finding("error", "rule-unregistered", `${id} is active but has no generated Claude rule.`, record.source));
    } else if (record.generated_rule && !exists(repoPath(root, record.generated_rule))) {
      findings.push(finding("warning", "rule-missing", `${id} has no generated Claude rule.`, record.generated_rule));
    } else if (["stale", "superseded", "retired"].includes(record.status) && record.generated_rule) {
      findings.push(finding("warning", "rule-exposes-inactive-knowledge", `${id} is ${record.status}, but its generated rule is still registered.`, record.generated_rule));
    }
  }

  for (const [id, navigator] of Object.entries(state.manifest.navigators || {})) {
    for (const [kind, path] of [["source", navigator.source], ["Claude agent", navigator.generated_agent], ["Claude rule", navigator.generated_rule], ["portable skill", navigator.generated_skill]]) {
      if (!path && kind === "portable skill") {
        findings.push(finding("warning", "navigator-missing", `${id} has no portable skill registration.`));
        continue;
      }
      if (!validateRelativePath(root, path, findings, "navigator-path")) continue;
      if (!exists(repoPath(root, path))) {
        findings.push(finding("warning", "navigator-missing", `${id} has no ${kind} file.`, path));
      }
    }
  }

  const known = new Set(Object.entries(state.manifest.knowledge || {}).filter(([, record]) => record.status === "active").map(([id]) => id));
  for (const path of walkFiles(root, fingerprintExclusionPatterns(), fingerprintOpts)) {
    if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    const absolute = repoPath(root, path);
    let text;
    try {
      if (statSync(absolute).size > 2 * 1024 * 1024) continue;
      text = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    for (const match of text.matchAll(/CHARTHOUSE\[(K-\d{4,})\]/g)) {
      if (!known.has(match[1])) {
        findings.push(finding("warning", "marker-unresolved", `${match[1]} does not resolve to an active manifest record.`, path));
      }
    }
  }

  // The Charter is intent, not evidence, so its state never makes the Bearing
  // stale. It is reported as information so nobody mistakes a template for intent.
  const charter = charterState(root);
  const charterNote = charterMessage(charter);
  if (charterNote) findings.push(finding(charter.state === "missing" ? "error" : "information", `charter-${charter.state}`, charterNote, charter.path));
  const errors = findings.filter((item) => item.level === "error").length;
  const warnings = findings.filter((item) => item.level === "warning").length;
  const information = findings.filter((item) => item.level === "information").length;
  const publication = publicationState(state, errors, warnings);
  return { ok: errors === 0, current: errors === 0 && warnings === 0, errors, warnings, information, charter, migration, reconciliation, canonical, publication, findings, state };
}

export function statusSummary(root) {
  const report = checkRepository(root);
  const { state } = report;
  const knowledge = Object.values(state.manifest.knowledge || {});
  const instructions = state.map.instruction_contracts || [];
  const expeditionRecords = listExpeditions(root);
  const latestExpedition = expeditionRecords.length ? expeditionStatus(root) : null;
  return {
    initialized: true,
    mode: state.config.mode,
    publication: report.publication,
    reconciliation: report.reconciliation,
    git: report.canonical,
    baseline: state.map.baseline,
    files: state.map.files.length,
    units: state.map.units.length,
    scan: state.map.scan_summary,
    capabilities: state.map.capabilities.length,
    approved_capabilities: state.map.capabilities.filter((item) => item.approved === true).length,
    preliminary_capabilities: state.map.capabilities.filter((item) => item.approved !== true).length,
    navigators: Object.keys(state.manifest.navigators || {}).length,
    instructions: {
      total: instructions.length,
      human_owned: instructions.filter((item) => item.ownership === "human").length,
      over_limit: instructions.filter((item) => item.over_limit).length,
      providers: [...new Set(instructions.flatMap((item) => item.providers || []))].sort()
    },
    knowledge: {
      total: knowledge.length,
      active: knowledge.filter((item) => item.status === "active").length,
      suspect: knowledge.filter((item) => item.status === "suspect").length,
      stale: knowledge.filter((item) => item.status === "stale").length
    },
    tool_gaps: summarizeToolGaps(state.tool_gaps),
    voyages: summarizeVoyages(root),
    expedition: latestExpedition ? {
      id: latestExpedition.id,
      status: latestExpedition.status,
      checkpoint_status: latestExpedition.checkpoint_status,
      draft_root: latestExpedition.draft_root,
      reusable_roles: latestExpedition.reusable_roles,
      next_roles: latestExpedition.next_roles
    } : null,
    charter: report.charter.state,
    bearing: { ok: report.ok, current: report.current, errors: report.errors, warnings: report.warnings }
  };
}
