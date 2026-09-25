import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, relative } from "node:path";
import { CHARTHOUSE_VERSION, MANIFEST_FILES, MAX_PERIMETER_REGIONS, SCHEMA_VERSION } from "./constants.mjs";
import { exclusionMatch, fileName, fingerprintFile, matchesGlob, repoPath, sha256Buffer, toPosix, walkFiles } from "./fs.mjs";
import { gitBaseline, gitTrackedFiles } from "./git.mjs";
import {
  documentAllowed,
  createGitignoredPolicy,
  effectiveMode,
  isInstructionPath,
  isDocumentPath,
  instructionWarningBytes,
  languageAllowed,
  languageForPath,
  packageScope,
  roleForPath,
  scannerOptions,
  validateConfig,
  walkExcludes
} from "./policy.mjs";

const REVIEWABLE_IGNORED_PATH = /(^|\/)(adr|architecture|design|docs?|examples?|infra|schemas?|stories|storybook)(\/|$)/i;
const MAX_EXCLUDED_TRACKED_PATHS = 200;
const REDACTED_NAME_PATTERNS = Object.freeze([
  ".env", ".env.*", ".envrc", ".npmrc", ".pypirc", "credentials.json",
  "secrets.json", "*.pem", "*.key", "id_rsa*"
]);

// A secret-like name can sit under a broader exclusion, as in
// node_modules/.env.local, or name a directory. Check every path segment, not
// only the exclusion rule that matched first.
function secretLikePath(path) {
  return path.split("/").some((segment) => REDACTED_NAME_PATTERNS.some((pattern) => matchesGlob(pattern, segment)));
}

function instructionType(path) {
  const name = fileName(path);
  if (name === "AGENTS.md") return { kind: "agents", providers: ["codex"] };
  if (name === "CLAUDE.md") return { kind: "claude", providers: ["claude"] };
  if (name === "GEMINI.md") return { kind: "gemini", providers: ["gemini"] };
  if (name === ".cursorrules" || path.includes("/.cursor/rules/") || path.startsWith(".cursor/rules/")) return { kind: "cursor", providers: ["cursor"] };
  if (path === ".github/copilot-instructions.md") return { kind: "copilot", providers: ["github-copilot"] };
  return { kind: "custom", providers: ["unspecified"] };
}

function instructionScope(path) {
  const cursorMarker = path.indexOf("/.cursor/rules/");
  if (cursorMarker !== -1) return path.slice(0, cursorMarker) || ".";
  if (path.startsWith(".cursor/rules/") || path === ".github/copilot-instructions.md") return ".";
  return dirname(path) === "." ? "." : dirname(path);
}

function scopeContains(parent, child) {
  if (parent === child) return false;
  return parent === "." || child.startsWith(`${parent}/`);
}

function instructionContracts(root, paths, config) {
  const threshold = instructionWarningBytes(config);
  const contracts = paths
    .filter((path) => isInstructionPath(path, config))
    .map((path) => {
      const absolute = repoPath(root, path);
      const size = statSync(absolute).size;
      const type = instructionType(path);
      return {
        id: `instruction-${slug(path)}-${sha256Buffer(Buffer.from(path)).slice(7, 15)}`,
        path,
        ...type,
        scope: instructionScope(path),
        parent: null,
        precedence: "nearest-scope",
        ownership: "human",
        size_bytes: size,
        warning_threshold_bytes: threshold,
        over_limit: size > threshold,
        digest: size > config.scan.max_file_size ? null : fingerprintFile(absolute)
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  for (const contract of contracts) {
    const parents = contracts
      .filter((candidate) => candidate.id !== contract.id
        && candidate.providers.some((provider) => contract.providers.includes(provider))
        && scopeContains(candidate.scope, contract.scope))
      .sort((left, right) => right.scope.length - left.scope.length || left.path.localeCompare(right.path));
    contract.parent = parents[0]?.id || null;
  }
  return contracts;
}

function boundaryClassification(path, kind, config) {
  const probe = kind === "directory" ? `${path}/__charthouse_boundary__` : path;
  const role = roleForPath(probe, config);
  if (role !== "source") return role;
  if (isDocumentPath(probe)) return "document";
  return "unknown";
}

function policyReason(classification) {
  if (classification === "generated") return "generated-policy";
  if (classification === "fixture") return "fixture-policy";
  if (classification === "test") return "test-policy";
  return "path-policy";
}

function manifestKind(name) {
  if (name.endsWith(".csproj")) return "dotnet";
  return MANIFEST_FILES.get(name) || null;
}

function readPackage(root, path, maxFileSize) {
  if (fileName(path) !== "package.json") return {};
  try {
    const absolute = repoPath(root, path);
    if (statSync(absolute).size > maxFileSize) return { oversize: true };
    const value = JSON.parse(readFileSync(absolute, "utf8"));
    return {
      name: typeof value.name === "string" ? value.name : null,
      private: value.private === true,
      workspaces: value.workspaces || null,
      dependencies: {
        ...value.dependencies,
        ...value.devDependencies,
        ...value.peerDependencies,
        ...value.optionalDependencies
      }
    };
  } catch {
    return { parse_error: true };
  }
}

function slug(value) {
  const result = value.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return result || "root";
}

function groupedManifestUnits(root, paths, config) {
  const grouped = new Map();
  for (const manifest of paths.filter((path) => {
    if (roleForPath(path, config) !== "source" || !manifestKind(fileName(path))) return false;
    return toPosix(relative(root, realpathSync(repoPath(root, path)))) === path;
  })) {
    const unitRoot = dirname(manifest) === "." ? "." : dirname(manifest);
    const manifests = grouped.get(unitRoot) || [];
    manifests.push(manifest);
    grouped.set(unitRoot, manifests);
  }
  return [...grouped.entries()].map(([unitRoot, manifests]) => {
    manifests.sort((a, b) => (fileName(a) === "package.json" ? -1 : 0) - (fileName(b) === "package.json" ? -1 : 0) || a.localeCompare(b));
    const manifest = manifests[0];
    const packageManifest = manifests.find((path) => fileName(path) === "package.json");
    const packageDetails = packageManifest ? readPackage(root, packageManifest, config.scan.max_file_size) : {};
    const name = packageDetails.name || (unitRoot === "." ? "repository" : fileName(unitRoot));
    const kinds = [...new Set(manifests.map((path) => manifestKind(fileName(path))))];
    const kind = unitRoot === "." && packageDetails.workspaces
      ? "workspace"
      : kinds.length > 1 ? "polyglot" : kinds[0];
    const unit = {
      id: `unit-${slug(unitRoot === "." ? name : unitRoot)}`,
      name,
      root: unitRoot,
      kind,
      manifest,
      manifests
    };
    return { ...unit, scope: packageScope(unit, config), packageDetails };
  });
}

function fallbackUnits(paths, config) {
  const roots = [...new Set(paths
    .filter((path) => roleForPath(path, config) === "source")
    .map((path) => path.includes("/") ? path.split("/")[0] : "."))];
  return roots.slice(0, 20).map((root) => {
    const unit = {
      id: `unit-${slug(root)}`,
      name: root === "." ? "repository" : root,
      root,
      kind: "directory",
      manifest: null,
      manifests: []
    };
    return { ...unit, scope: packageScope(unit, config), packageDetails: {} };
  });
}

function ownerFor(path, units) {
  const nested = units
    .filter((unit) => unit.root !== "." && (path === unit.root || path.startsWith(`${unit.root}/`)))
    .sort((a, b) => b.root.length - a.root.length || a.root.localeCompare(b.root));
  return nested[0] || units.find((unit) => unit.root === ".") || null;
}

function publicUnit(unit) {
  const { packageDetails, ...visible } = unit;
  return visible;
}

export function scanRepository(root, config = {}) {
  validateConfig(config);
  const hardExcludedTracked = gitTrackedFiles(root)
    .map((path) => ({ path, match: exclusionMatch(path) }))
    .filter((item) => item.match?.source === "hard");
  const visibleExcludedTracked = hardExcludedTracked
    .filter((item) => !secretLikePath(item.path))
    .map((item) => ({ path: item.path, pattern: item.match.pattern, reason: "hard-safety" }))
    .slice(0, MAX_EXCLUDED_TRACKED_PATHS);
  const redactedExcludedTracked = hardExcludedTracked.filter((item) => secretLikePath(item.path)).length;
  const ignoredPolicy = createGitignoredPolicy(root, config);
  const perimeterByPath = new Map();
  let hiddenIgnoredRegions = 0;
  const addPerimeter = ({ path, kind, treatment = "record", classification, reason, pattern = null }) => {
    const current = perimeterByPath.get(path) || {
      path,
      kind,
      treatment,
      classification,
      reasons: new Set(),
      patterns: new Set(),
      review_required: false
    };
    current.treatment = current.treatment === "partial" || treatment === "partial" ? "partial" : treatment;
    current.classification = current.classification === "unknown" ? classification : current.classification;
    current.reasons.add(reason);
    if (pattern) current.patterns.add(pattern);
    current.review_required ||= reason === "gitignored" && (classification === "document" || REVIEWABLE_IGNORED_PATH.test(path));
    perimeterByPath.set(path, current);
  };
  const ignoredReason = (path) => ignoredPolicy.decisionForPath(path).source === "default"
    ? "gitignored"
    : "gitignored-policy";
  const recordFilteredFile = (path, kind, classification, reason, pattern = null) => {
    addPerimeter({ path, kind, classification, reason, pattern });
    if (ignoredPolicy.regionForPath(path)) {
      addPerimeter({ path, kind, classification, reason: ignoredReason(path) });
    }
  };

  const ignoredWalkExcludes = new Set(ignoredPolicy.walkExcludes);
  for (const region of ignoredPolicy.regions) {
    const probe = region.kind === "directory" ? `${region.path}/__charthouse_boundary__` : region.path;
    const decision = ignoredPolicy.decisionForPath(probe);
    const treatment = decision.treatment;
    if (ignoredPolicy.isHardHidden(region.path) || treatment === "hide") {
      hiddenIgnoredRegions += 1;
      continue;
    }
    if (treatment === "scan") continue;
    const exclusion = region.kind === "directory" ? `${region.path}/**` : region.path;
    addPerimeter({
      ...region,
      treatment: ignoredWalkExcludes.has(exclusion) ? "record" : "partial",
      classification: boundaryClassification(region.path, region.kind, config),
      reason: decision.source === "exclude" ? "gitignored-policy" : "gitignored"
    });
  }

  const candidatePaths = walkFiles(
    root,
    [...walkExcludes(config), ...ignoredPolicy.walkExcludes],
    {
      ...scannerOptions(config),
      acceptFile(path, absolute) {
        if (!ignoredPolicy.accepts(path)) return false;
        try {
          return ignoredPolicy.accepts(toPosix(relative(root, realpathSync(absolute))));
        } catch {
          return false;
        }
      },
      onExcluded(event) {
        if (event.source === "hard") return;
        const probe = event.kind === "directory" ? `${event.path}/__charthouse_boundary__` : event.path;
        const ignoredDecision = ignoredPolicy.decisionForPath(probe);
        if (ignoredPolicy.regionForPath(event.path) && ignoredDecision.treatment === "hide") return;
        const classification = boundaryClassification(event.path, event.kind, config);
        const ignoredRule = ignoredWalkExcludes.has(event.pattern);
        if (!ignoredRule || ["generated", "fixture", "test"].includes(classification)) {
          addPerimeter({ ...event, classification, reason: policyReason(classification) });
        }
        if (ignoredPolicy.regionForPath(event.path)) {
          addPerimeter({ ...event, classification, reason: ignoredReason(probe) });
        }
      },
      onRejected(event) {
        if (!ignoredPolicy.regionForPath(event.path)) return;
        const decision = ignoredPolicy.decisionForPath(event.path);
        if (decision.treatment === "hide") {
          hiddenIgnoredRegions += 1;
          return;
        }
        addPerimeter({
          ...event,
          classification: boundaryClassification(event.path, event.kind, config),
          reason: decision.source === "exclude" ? "gitignored-policy" : "gitignored"
        });
      }
    }
  );
  const instructions = instructionContracts(root, candidatePaths, config);
  const instructionWarnings = instructions
    .filter((contract) => contract.over_limit)
    .map((contract) => ({
      path: contract.path,
      size_bytes: contract.size_bytes,
      warning_threshold_bytes: contract.warning_threshold_bytes,
      reason: "host-context-limit"
    }));
  let allUnits = groupedManifestUnits(root, candidatePaths, config);
  if (allUnits.length === 0) allUnits = fallbackUnits(candidatePaths, config);
  const visibleUnits = allUnits.filter((unit) => unit.scope !== "omit");
  const maxFileSize = config.scan.max_file_size;
  const files = [];
  const roleCounts = { source: 0, test: 0, fixture: 0, generated: 0 };

  for (const path of candidatePaths) {
    const owner = ownerFor(path, allUnits);
    const absolute = repoPath(root, path);
    const physicalPath = toPosix(relative(root, realpathSync(absolute)));
    const viaSymlink = physicalPath !== path;
    const boundaryKind = viaSymlink ? "symlink" : "file";
    const physicalOwner = viaSymlink ? ownerFor(physicalPath, allUnits) : owner;
    if (owner?.scope === "omit") continue;
    if (owner?.scope === "stub" && !owner.manifests.includes(path)) continue;
    if (physicalOwner?.scope === "omit") continue;
    if (physicalOwner?.scope === "stub" && !physicalOwner.manifests.includes(physicalPath)) continue;
    const role = roleForPath(path, config);
    const scanMode = effectiveMode(role, owner, config);
    if (scanMode === "exclude") {
      recordFilteredFile(path, boundaryKind, role, policyReason(role));
      continue;
    }
    if (physicalOwner !== owner && effectiveMode(role, physicalOwner, config) === "exclude") {
      recordFilteredFile(path, boundaryKind, role, policyReason(role));
      continue;
    }
    if (!documentAllowed(path, owner, config)) {
      recordFilteredFile(path, boundaryKind, "document", "document-policy");
      continue;
    }
    if (physicalOwner !== owner && !documentAllowed(physicalPath, physicalOwner, config)) {
      recordFilteredFile(path, boundaryKind, "document", "document-policy");
      continue;
    }
    const language = languageForPath(path);
    if (!languageAllowed(language, path, config)) {
      recordFilteredFile(path, boundaryKind, boundaryClassification(path, "file", config), "language-policy");
      continue;
    }
    const size = statSync(absolute).size;
    const oversize = size > maxFileSize;
    files.push({
      path,
      size,
      language,
      role,
      scan_mode: scanMode,
      owner: owner?.id || null,
      physical_owner: physicalOwner?.id || null,
      digest: oversize ? null : fingerprintFile(absolute),
      oversize,
      via_symlink: viaSymlink,
      gitignored: Boolean(ignoredPolicy.regionForPath(path))
    });
    roleCounts[role] += 1;
  }

  const units = visibleUnits.map(publicUnit);
  const visibleIds = new Set(units.map((unit) => unit.id));
  const packageByName = new Map();
  for (const unit of visibleUnits) {
    if (unit.packageDetails.name) packageByName.set(unit.packageDetails.name, unit.id);
  }
  const dependencies = [];
  for (const unit of visibleUnits) {
    for (const dependency of Object.keys(unit.packageDetails.dependencies || {})) {
      const target = packageByName.get(dependency);
      if (target && visibleIds.has(target)) {
        dependencies.push({
          from: unit.id,
          to: target,
          kind: "package",
          evidence: [unit.manifest]
        });
      }
    }
  }

  const capabilities = visibleUnits.filter((unit) => unit.scope === "included").map((unit) => {
    const workspacePaths = unit.kind === "workspace"
      ? [unit.manifest, ...candidatePaths.filter((path) => !path.includes("/") && ["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json", "tsconfig.json"].includes(path))].filter(Boolean)
      : null;
    return {
      id: `cap-${unit.id.slice(5)}`,
      name: unit.name,
      purpose: unit.kind === "workspace" ? "Maintain workspace orchestration and repository-wide build configuration." : `Maintain the code in ${unit.root}.`,
      primary_paths: workspacePaths || [unit.root === "." ? "**" : `${unit.root}/**`],
      secondary_paths: [],
      confidence: unit.manifest ? 0.7 : 0.45,
      evidence: unit.manifest ? [unit.manifest] : [unit.root],
      provenance: "deterministic-draft",
      approved: false
    };
  });

  const hashGroups = new Map();
  for (const file of files) {
    if (!file.digest || file.size < 80 || file.language === "Markdown" || file.via_symlink) continue;
    if (file.role !== "source" && file.scan_mode !== "full") continue;
    const group = hashGroups.get(file.digest) || [];
    group.push(file.path);
    hashGroups.set(file.digest, group);
  }
  const duplicateGroups = [...hashGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([digest, group], index) => ({ id: `duplicate-${index + 1}`, digest, paths: group }));

  const documents = files
    .filter((file) => isDocumentPath(file.path))
    .map((file) => ({ path: file.path, digest: file.digest, role: file.role, gitignored: file.gitignored }));

  const anomalies = [];
  if (duplicateGroups.length) {
    anomalies.push({
      kind: "exact-duplicates",
      severity: "information",
      detail: `${duplicateGroups.length} exact duplicate group(s) need semantic review.`
    });
  }
  const instructionGroups = new Map();
  for (const contract of instructions.filter((item) => item.digest)) {
    const group = instructionGroups.get(contract.digest) || [];
    group.push(contract.path);
    instructionGroups.set(contract.digest, group);
  }
  const instructionDuplicateGroups = [...instructionGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([digest, group], index) => ({
      id: `instruction-duplicate-${index + 1}`,
      digest,
      paths: group.sort()
    }));
  if (instructionDuplicateGroups.length) {
    anomalies.push({
      kind: "duplicate-instruction-contracts",
      severity: "information",
      detail: `${instructionDuplicateGroups.length} exact duplicate instruction contract group(s) need scope review.`,
      evidence: instructionDuplicateGroups.flatMap((group) => group.paths)
    });
  }

  const omittedUnitRoots = allUnits.filter((unit) => unit.scope === "omit").map((unit) => unit.root);
  const allPerimeterRegions = [...perimeterByPath.values()]
    .map((region) => ({
      ...region,
      reasons: [...region.reasons].sort(),
      patterns: [...region.patterns].sort()
    }))
    .sort((a, b) => Number(b.review_required) - Number(a.review_required) || a.path.localeCompare(b.path));
  const perimeterRegions = allPerimeterRegions.slice(0, MAX_PERIMETER_REGIONS);
  const reviewRequiredRegions = allPerimeterRegions.filter((region) => region.review_required);
  const gitignoredScannedFiles = files.filter((file) => file.gitignored).length;
  return {
    schema_version: SCHEMA_VERSION,
    charthouse_version: CHARTHOUSE_VERSION,
    generated_at: new Date().toISOString(),
    baseline: gitBaseline(root),
    scan_summary: {
      candidate_files: candidatePaths.length,
      included_files: files.length,
      omitted_files: candidatePaths.length - files.length + hardExcludedTracked.length,
      hard_excluded_tracked_files: hardExcludedTracked.length,
      hard_excluded_tracked_listed: visibleExcludedTracked.length,
      hard_excluded_tracked_redacted: redactedExcludedTracked,
      hard_excluded_tracked_truncated: hardExcludedTracked.length - redactedExcludedTracked > visibleExcludedTracked.length,
      roles: roleCounts,
      included_units: visibleUnits.filter((unit) => unit.scope === "included").length,
      stub_units: visibleUnits.filter((unit) => unit.scope === "stub").length,
      omitted_units: omittedUnitRoots.length,
      omitted_unit_roots: omittedUnitRoots,
      perimeter_regions: allPerimeterRegions.length,
      perimeter_regions_listed: perimeterRegions.length,
      perimeter_truncated: allPerimeterRegions.length > perimeterRegions.length,
      gitignored_regions: ignoredPolicy.regions.length,
      gitignored_scanned_files: gitignoredScannedFiles,
      hidden_ignored_regions: hiddenIgnoredRegions,
      review_required_regions: reviewRequiredRegions.length,
      instruction_contracts: instructions.length,
      instruction_file_warnings: instructionWarnings.length
    },
    instruction_contracts: instructions,
    instruction_duplicate_groups: instructionDuplicateGroups,
    instruction_file_warnings: instructionWarnings,
    excluded_tracked_paths: visibleExcludedTracked,
    perimeter_regions: perimeterRegions,
    files,
    units,
    capabilities,
    dependencies,
    documents,
    duplicate_groups: duplicateGroups,
    anomalies,
    unresolved: [
      ...capabilities.filter((item) => item.confidence < 0.5).map((item) => ({
        kind: "low-confidence-capability",
        capability: item.id,
        evidence: item.evidence
      })),
      ...perimeterRegions.filter((region) => region.review_required).map((region) => ({
        kind: "ignored-region-needs-scan-decision",
        path: region.path,
        evidence: [region.path]
      }))
    ]
  };
}
