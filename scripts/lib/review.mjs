import { statSync } from "node:fs";
import { posix } from "node:path";
import { PATHS } from "./constants.mjs";
import { exists, fingerprintPath, repoPath, toPosix, watchPathspec, writeJson } from "./fs.mjs";
import { documentDrift } from "./check.mjs";
import { gitCommitReachable, gitDiffSince, gitHead, gitLogSince, gitUntracked } from "./git.mjs";
import { createGitignoredPolicy, documentFingerprintPolicy } from "./policy.mjs";
import { loadState, verificationContext, verificationStamp } from "./state.mjs";
import { withProjectLock } from "./lock.mjs";
import { assertCanonicalCurrent, canonicalRefStatus } from "./freshness.mjs";

export const DIFF_LIMIT = 200 * 1024;
export const COMMIT_LIMIT = 50;

function isHistorical(document) {
  return document.status === "historical" || document.criticality === "historical";
}

function packet(root, id, document, entry) {
  const pathspecs = [...new Set((document.watches || []).map(watchPathspec))];
  const commit = document.verified_commit || null;
  const reachable = gitCommitReachable(root, commit);
  const result = {
    id,
    path: document.path,
    kind: document.kind || "document",
    ownership: document.ownership || null,
    scope: document.scope || null,
    providers: document.providers || [],
    parent: document.parent || null,
    criticality: document.criticality,
    status: document.status,
    changed_watches: entry.changed,
    base: { commit, verified_at: document.verified_at || null, dirty: document.verified_dirty === true, reachable },
    mode: "full",
    reason: null,
    diff: null,
    diff_truncated: false,
    commits: [],
    untracked: []
  };
  if (!commit) {
    result.reason = "No verification commit is recorded. Review the whole document against the current code.";
  } else if (!reachable) {
    result.reason = `The verification commit ${commit} is not in the history of HEAD. Review the whole document against the current code.`;
  } else if (!entry.changed.length) {
    result.reason = `The document is declared ${document.status}. Review the whole document against the current code.`;
  } else {
    const diff = gitDiffSince(root, commit, pathspecs, DIFF_LIMIT);
    result.mode = "diff";
    result.diff = diff.text;
    result.diff_truncated = diff.truncated;
    result.commits = gitLogSince(root, commit, pathspecs, COMMIT_LIMIT);
    result.untracked = gitUntracked(root, pathspecs);
    if (result.base.dirty) result.reason = "The fingerprint was taken on a dirty tree, so the diff can include changes that were already reviewed.";
  }
  return result;
}

// One packet per document that needs a review: a watch changed, or a person
// declared it suspect or stale. Read-only.
export function reviewPackets(root, { id = null } = {}) {
  const state = loadState(root);
  const documents = state.manifest.documents || {};
  if (id && !documents[id]) throw new Error(`Unknown document: ${id}`);
  const drift = documentDrift(root, state);
  const selected = Object.entries(documents)
    .filter(([key]) => !id || key === id)
    .filter(([, document]) => !isHistorical(document))
    .filter(([key, document]) => drift[key].changed.length > 0 || document.status === "suspect" || document.status === "stale");
  return {
    head: gitHead(root),
    canonical: canonicalRefStatus(root, state.config),
    documents: selected.map(([key, document]) => packet(root, key, document, drift[key]))
  };
}

export function renderReview(result) {
  const plural = (count, word, suffix = "s") => `${count} ${word}${count === 1 ? "" : suffix}`;
  const lines = [`Documents to review: ${result.documents.length}${result.head ? ` (HEAD ${result.head.slice(0, 7)})` : ""}`];
  for (const item of result.documents) {
    const detail = item.mode === "diff"
      ? `diff since ${item.base.commit.slice(0, 7)}, ${plural(item.changed_watches.length, "changed watch", "es")}, ${plural(item.commits.length, "commit")}`
      : `full review: ${item.reason}`;
    lines.push(`- ${item.id} [${item.criticality}] ${item.path}: ${detail}`);
  }
  if (result.documents.length) lines.push("", `Run \`charthouse docs review --json\` for the review packets. Record each verdict under ${PATHS.chronicles}/reviews/.`);
  return `${lines.join("\n")}\n`;
}

// Records a review verdict of `holds`. The evidence file is the audit trail: a
// flag that clears itself is never looked at again, so no confirmation happens
// without a recorded review.
function confirmDocumentUnlocked(root, id, evidence, { allowBehind = false } = {}) {
  const state = loadState(root);
  assertCanonicalCurrent(root, { config: state.config, action: "document confirmation", allowBehind });
  const document = state.manifest.documents?.[id];
  if (!document) throw new Error(`Unknown document: ${id}`);
  if (isHistorical(document)) throw new Error(`${id} is historical. A historical document is never reviewed or confirmed.`);
  if (typeof evidence !== "string" || !evidence) {
    throw new Error("docs confirm requires --evidence <file>: the Chronicle file that records the review verdict.");
  }
  const normalized = posix.normalize(toPosix(evidence));
  if (!normalized.startsWith(`${PATHS.chronicles}/`)) {
    throw new Error(`The evidence must be a file under ${PATHS.chronicles}/: ${evidence}`);
  }
  const absolute = repoPath(root, normalized);
  if (!exists(absolute) || !statSync(absolute).isFile()) {
    throw new Error(`The evidence file does not exist: ${normalized}`);
  }

  const ignoredPolicy = createGitignoredPolicy(root, state.config);
  const refreshed = {};
  for (const path of document.watches || []) {
    const policy = documentFingerprintPolicy(document, path, state.config, state.map, root, ignoredPolicy);
    refreshed[path] = fingerprintPath(root, path, policy.excludes, policy.options);
  }
  const confirmed = { ...document, ...verificationStamp(document.watches || [], verificationContext(root)), verified_evidence: normalized };
  if (confirmed.status === "suspect" || confirmed.status === "stale") confirmed.status = "current";

  writeJson(repoPath(root, PATHS.fingerprints), { ...state.fingerprints, documents: { ...state.fingerprints.documents, [id]: refreshed } });
  writeJson(repoPath(root, PATHS.manifest), { ...state.manifest, documents: { ...state.manifest.documents, [id]: confirmed } });
  return { id, path: document.path, status: confirmed.status, verified_commit: confirmed.verified_commit, verified_evidence: normalized, watches: Object.keys(refreshed).length };
}

export function confirmDocument(root, id, evidence, options = {}) {
  return withProjectLock(root, "confirm document review", () => confirmDocumentUnlocked(root, id, evidence, options));
}
