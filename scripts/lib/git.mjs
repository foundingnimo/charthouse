import { execFileSync } from "node:child_process";

function git(root, args, fallback = null) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trimEnd();
  } catch {
    return fallback;
  }
}

export function gitBaseline(root) {
  const commit = git(root, ["rev-parse", "HEAD"]);
  const changes = git(root, ["status", "--porcelain"], "");
  return { commit, dirty: Boolean(changes) };
}

export function gitChangedPaths(root, base = null) {
  const args = base
    ? ["diff", "--name-only", "--diff-filter=ACMRTUXB", `${base}...HEAD`]
    : ["status", "--porcelain", "--untracked-files=all"];
  const output = git(root, args, "");
  if (!output) return [];
  if (base) return [...new Set(output.split("\n").filter(Boolean))].sort();
  return [...new Set(output.split("\n").flatMap((line) => {
    const value = line.slice(3);
    return value.includes(" -> ") ? value.split(" -> ") : [value];
  }).filter(Boolean))].sort();
}

export function gitMergeBase(root, target = "HEAD") {
  const originHead = git(root, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  const candidates = [originHead, "origin/main", "main", "origin/master", "master"].filter(Boolean);
  for (const candidate of candidates) {
    const base = git(root, ["merge-base", target, candidate]);
    if (base) return base;
  }
  return null;
}

export function gitHead(root) {
  return git(root, ["rev-parse", "HEAD"]);
}

export function gitTrackedFiles(root) {
  const output = gitOutput(root, ["ls-files", "-z"]);
  if (!output) return [];
  return output.split("\0").filter(Boolean).sort();
}

export function gitIgnoredRegions(root) {
  if (git(root, ["rev-parse", "--is-inside-work-tree"], "false") !== "true") return [];
  try {
    const output = execFileSync("git", [
      "-C", root, "ls-files", "--others", "--ignored", "--exclude-standard",
      "--directory", "-z"
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024
    });
    return output.split("\0").filter(Boolean).map((value) => ({
      path: value.endsWith("/") ? value.slice(0, -1) : value,
      kind: value.endsWith("/") ? "directory" : "file"
    }));
  } catch {
    throw new Error("Charthouse could not enumerate Git-ignored paths safely. No repository content was scanned.");
  }
}

// `git()` above caps output at Node's default buffer and trims it. A diff can
// be large and its trailing newline matters, so read it raw with a wide buffer.
function gitOutput(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024
    });
  } catch {
    return null;
  }
}

// True only for a commit that exists and is an ancestor of HEAD. A commit lost
// to a force-push or a branch switch cannot anchor a diff.
export function gitCommitReachable(root, commit) {
  if (typeof commit !== "string" || !/^[0-9a-f]{7,40}$/.test(commit)) return false;
  if (git(root, ["cat-file", "-e", `${commit}^{commit}`]) === null) return false;
  return git(root, ["merge-base", "--is-ancestor", commit, "HEAD"]) !== null;
}

// Diff from the commit to the working tree, so uncommitted edits are included.
export function gitDiffSince(root, commit, pathspecs, limit) {
  const output = gitOutput(root, ["diff", "--no-color", "--no-ext-diff", commit, "--", ...pathspecs]);
  if (output === null) return { text: null, truncated: false };
  if (Buffer.byteLength(output) <= limit) return { text: output, truncated: false };
  let text = Buffer.from(output).subarray(0, limit).toString("utf8");
  while (Buffer.byteLength(text) > limit) text = text.slice(0, -1);
  return { text, truncated: true };
}

export function gitLogSince(root, commit, pathspecs, max) {
  const output = gitOutput(root, ["log", `--max-count=${max}`, "--format=%h%x09%s", `${commit}..HEAD`, "--", ...pathspecs]);
  if (!output) return [];
  return output.split("\n").filter(Boolean).map((line) => {
    const [hash, ...subject] = line.split("\t");
    return { hash, subject: subject.join("\t") };
  });
}

export function gitUntracked(root, pathspecs) {
  const output = gitOutput(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspecs]);
  if (!output) return [];
  return output.split("\0").filter(Boolean).sort();
}
