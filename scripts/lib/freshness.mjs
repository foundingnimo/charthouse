import { execFileSync } from "node:child_process";

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function count(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function dirty(root) {
  const output = git(root, ["status", "--porcelain"]);
  return output === null ? null : Boolean(output);
}

export function canonicalBranchCandidates(root) {
  const output = git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]);
  if (!output) return [];
  const current = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return [...new Set(output.split("\n").filter((ref) => ref && !ref.endsWith("/HEAD")))]
    .sort((left, right) => (left === current ? -1 : right === current ? 1 : left.localeCompare(right)));
}

/**
 * Describe this checkout against the repository's accepted-history reference.
 * The repository must pin one exact local or remote-tracking branch. Charthouse
 * never contacts the network, follows a symbolic default, or guesses a name.
 */
export function canonicalRefStatus(root, config = {}) {
  const ref = config?.git?.canonical_ref || null;
  const repository = git(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const result = {
    configured_ref: ref,
    ref,
    source: ref ? "configured" : "unconfigured",
    branch,
    head,
    full_ref: null,
    symbolic_target: null,
    canonical_commit: null,
    behind: null,
    ahead: null,
    dirty: repository ? dirty(root) : null,
    relationship: !repository ? "not-git" : !head ? "no-head" : !ref ? "unpinned" : "unknown"
  };

  if (!repository || !ref || !head) return result;
  const canonicalCommit = git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (!canonicalCommit) return { ...result, relationship: "missing" };
  const possibleRefs = ref.startsWith("refs/") ? [ref] : [`refs/heads/${ref}`, `refs/remotes/${ref}`];
  const configuredSymbolicTarget = possibleRefs.map((candidate) => git(root, ["symbolic-ref", "--quiet", candidate])).find(Boolean) || null;
  if (configuredSymbolicTarget) {
    return { ...result, canonical_commit: canonicalCommit, symbolic_target: configuredSymbolicTarget, relationship: "symbolic" };
  }
  const fullRef = git(root, ["rev-parse", "--symbolic-full-name", ref]);
  if (!fullRef || (!fullRef.startsWith("refs/heads/") && !fullRef.startsWith("refs/remotes/"))) {
    return { ...result, canonical_commit: canonicalCommit, full_ref: fullRef, relationship: "not-branch" };
  }
  const counts = git(root, ["rev-list", "--left-right", "--count", `${ref}...HEAD`]);
  if (!counts) return { ...result, canonical_commit: canonicalCommit, full_ref: fullRef };
  const [behindValue, aheadValue] = counts.split(/\s+/);
  const behind = count(behindValue);
  const ahead = count(aheadValue);
  if (behind === null || ahead === null) return { ...result, canonical_commit: canonicalCommit, full_ref: fullRef };
  const relationship = !branch
    ? "detached"
    : behind > 0 && ahead > 0
      ? "diverged"
      : behind > 0
        ? "behind"
        : ahead > 0
          ? "ahead"
          : "current";
  return { ...result, canonical_commit: canonicalCommit, full_ref: fullRef, behind, ahead, relationship };
}

function plural(value, word) {
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}

/**
 * Trust-changing operations must be based on accepted history. Local work may
 * be ahead, but a missing configured ref, detached HEAD, or unseen canonical
 * commits requires a person to decide how to update the checkout.
 */
export function assertCanonicalPinned(root, { config = {}, action = "operation" } = {}) {
  const status = canonicalRefStatus(root, config);
  const choices = canonicalBranchCandidates(root);
  const available = choices.length ? ` Available branches: ${choices.join(", ")}.` : "";
  if (status.relationship === "not-git") {
    throw new Error(`Charthouse ${action} requires a Git repository with an explicit canonical branch.`);
  }
  if (status.relationship === "no-head") {
    throw new Error(`Charthouse ${action} requires at least one Git commit before the canonical branch can be pinned.`);
  }
  if (status.relationship === "unpinned") {
    throw new Error(`Charthouse ${action} requires git.canonical_ref to name one exact local or remote-tracking branch.${available} Ask the user which branch represents accepted history; do not infer it.`);
  }
  if (status.relationship === "missing") {
    throw new Error(`The configured canonical branch ${status.ref} is not available locally. Fetch it or change git.canonical_ref in .charthouse/config.json.${available}`);
  }
  if (status.relationship === "not-branch") {
    throw new Error(`The configured canonical ref ${status.ref} is not a branch. Pin git.canonical_ref to one exact local or remote-tracking branch.${available}`);
  }
  if (status.relationship === "symbolic") {
    throw new Error(`The configured canonical ref ${status.ref} is symbolic${status.symbolic_target ? ` and points to ${status.symbolic_target}` : ""}. Pin the exact target branch instead.`);
  }
  return status;
}

export function assertCanonicalCurrent(root, { config = {}, action = "operation", allowBehind = false } = {}) {
  const status = assertCanonicalPinned(root, { config, action });
  if (allowBehind) return status;
  const override = "Pass --allow-behind to continue deliberately without changing Git state.";
  if (status.relationship === "detached") {
    throw new Error(`HEAD is detached while the canonical branch is ${status.ref}. A ${action} changes trusted Charthouse state, so select the intended working branch first. ${override}`);
  }
  if (status.relationship === "behind" || status.relationship === "diverged") {
    const behind = plural(status.behind, "commit");
    const ahead = status.ahead ? ` and ${plural(status.ahead, "commit")} ahead` : "";
    const verb = status.relationship === "diverged" ? "has diverged from" : "is behind";
    throw new Error(`${status.branch} ${verb} canonical branch ${status.ref}: ${behind} behind${ahead}. A ${action} changes trusted Charthouse state, so update the branch from canonical history first. ${override}`);
  }
  if (status.relationship === "unknown") {
    throw new Error(`Charthouse could not compare HEAD with canonical ${status.ref}. Verify the local Git history before this ${action}, or pass --allow-behind to continue deliberately.`);
  }
  return status;
}

// Compatibility exports for integrations written before canonical refs were
// introduced. They now report and enforce the canonical relationship.
export function upstreamDrift(root, config = {}) {
  return canonicalRefStatus(root, config);
}

export function assertBranchCurrent(root, options = {}) {
  return assertCanonicalCurrent(root, options);
}
