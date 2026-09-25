import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { PATHS } from "./lib/constants.mjs";
import { findProjectRoot, readJson, repoPath, toPosix, writeJson } from "./lib/fs.mjs";
import { gitChangedPaths } from "./lib/git.mjs";
import { checkRepository } from "./lib/check.mjs";
import { isInitialized, reconcile } from "./lib/state.mjs";
import { withProjectLock } from "./lib/lock.mjs";
import { finishPendingPublication } from "./lib/publication.mjs";
import { summarizeVoyages } from "./lib/voyages.mjs";

function readInput() {
  try {
    const text = readFileSync(0, "utf8").trim();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function savePaths(root, additions) {
  return withProjectLock(root, "update changed-path queue", () => {
    // A pending publication replaces this queue, so finish it before adding to it.
    finishPendingPublication(root);
    const statePath = repoPath(root, PATHS.changes);
    let current = { schema_version: 1, paths: [] };
    try { current = readJson(statePath); } catch {}
    const paths = [...new Set([...(current.paths || []), ...additions])].filter(Boolean).sort();
    writeJson(statePath, { schema_version: 1, updated_at: new Date().toISOString(), paths });
  });
}

export function runHook(event, cwd = process.cwd()) {
  const root = findProjectRoot(cwd);
  if (!isInitialized(root)) return;
  if (event === "changed") {
    const input = readInput();
    const candidate = input.tool_input?.file_path || input.tool_input?.path || input.file_path;
    if (candidate) {
      let canonical = candidate;
      if (isAbsolute(candidate)) {
        try { canonical = realpathSync(candidate); } catch {}
      }
      const path = isAbsolute(canonical) ? toPosix(relative(root, canonical)) : toPosix(canonical);
      if (path && !path.startsWith("../")) savePaths(root, [path]);
    }
    return;
  }
  if (event === "stop") {
    reconcile(root, { observedPaths: gitChangedPaths(root) });
    return;
  }
  if (event === "session-start") {
    const refreshed = reconcile(root, { observedPaths: gitChangedPaths(root) });
    const report = checkRepository(root);
    const label = report.current ? "current" : "needs attention";
    const canonical = report.findings.find((item) => item.code.startsWith("canonical-"));
    const canonicalNote = canonical ? ` ${canonical.message}` : "";
    const charter = report.charter.state === "complete" ? "" : ` The Charter is ${report.charter.state === "partial" ? "partial" : report.charter.state}; run /charthouse charter ${report.charter.state === "partial" ? "update" : "create"}.`;
    const suspect = new Set(report.findings.filter((item) => item.code === "document-suspect").map((item) => item.path)).size;
    const review = suspect ? ` ${suspect} document${suspect === 1 ? " is" : "s are"} suspect; run /charthouse docs review.` : "";
    const navigatorCount = Object.keys(report.state.manifest.navigators || {}).length;
    const navigators = navigatorCount ? ` ${navigatorCount} project Navigator${navigatorCount === 1 ? " is" : "s are"} available; use /agents or /charthouse who <path>.` : "";
    const activeVoyages = summarizeVoyages(root).active;
    const voyages = activeVoyages ? ` ${activeVoyages} active Voyage${activeVoyages === 1 ? "" : "s"}; run /charthouse run status before overlapping work.` : "";
    const refresh = refreshed.updated ? ` Repository context refreshed from ${refreshed.paths.length} changed path${refreshed.paths.length === 1 ? "" : "s"}.` : "";
    const canonicalRefresh = refreshed.canonical_changed && refreshed.checkout_update_required
      ? " The local canonical branch changed. Update this checkout before Charthouse rebuilds trusted context."
      : "";
    process.stdout.write(`Charthouse Bearing: ${label}. ${report.errors} error(s), ${report.warnings} warning(s).${canonicalNote}${refresh}${canonicalRefresh}${charter}${review}${navigators}${voyages} Run /charthouse check for details.\n`);
  }
}
