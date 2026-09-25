import { realpathSync } from "node:fs";
import { extname, relative } from "node:path";
import { DEFAULT_FIXTURE_PATTERNS, DEFAULT_GENERATED_PATTERNS, DEFAULT_INSTRUCTION_PATTERNS, DEFAULT_TEST_PATTERNS, INSTRUCTION_FILE_WARNING_BYTES, STRUCTURAL_NAMES } from "./constants.mjs";
import { exclusionMatch, fileName, matchesGlob, toPosix } from "./fs.mjs";
import { gitIgnoredRegions } from "./git.mjs";

const LANGUAGE_BY_EXTENSION = new Map([
  [".ts", "TypeScript"], [".tsx", "TypeScript"], [".js", "JavaScript"],
  [".jsx", "JavaScript"], [".mjs", "JavaScript"], [".cjs", "JavaScript"],
  [".py", "Python"], [".rs", "Rust"], [".go", "Go"], [".java", "Java"],
  [".kt", "Kotlin"], [".rb", "Ruby"], [".php", "PHP"], [".swift", "Swift"],
  [".cs", "C#"], [".md", "Markdown"], [".mdx", "Markdown"], [".rst", "reStructuredText"],
  [".adoc", "AsciiDoc"], [".json", "JSON"], [".yaml", "YAML"],
  [".yml", "YAML"], [".toml", "TOML"], [".sql", "SQL"], [".sh", "Shell"]
]);

const DOC_NAMES = /(^|\/)(readme|contributing|architecture|design|adr|docs?)(\.|\/|$)/i;
const DOCUMENT_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".adoc"]);
const ROLE_MODES = new Set(["full", "evidence", "exclude"]);
const DOCUMENT_MODES = new Set(["full", "selected", "exclude"]);
const CHARTHOUSE_MODES = new Set(["observe", "advise", "maintain", "enforce"]);
const GITIGNORED_MODES = new Set(["record", "scan"]);

function invalid(message) {
  throw new Error(`Invalid Charthouse config: ${message}`);
}

function objectAt(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${path} must be an object.`);
  return value;
}

function keysAt(value, allowed, path) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) invalid(`${path} contains unknown field ${unknown[0]}.`);
}

function stringArrayAt(value, path) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.length)) {
    invalid(`${path} must be an array of non-empty strings.`);
  }
}

function selectorAt(value, path) {
  const selector = objectAt(value, path);
  keysAt(selector, ["names", "paths"], path);
  stringArrayAt(selector.names, `${path}.names`);
  stringArrayAt(selector.paths, `${path}.paths`);
}

function rolePolicyAt(value, path) {
  const policy = objectAt(value, path);
  keysAt(policy, ["mode", "patterns"], path);
  if (!ROLE_MODES.has(policy.mode)) invalid(`${path}.mode must be full, evidence, or exclude.`);
  stringArrayAt(policy.patterns, `${path}.patterns`);
}

export function validateConfig(config) {
  const root = objectAt(config, "configuration");
  keysAt(root, ["schema_version", "mode", "git", "scan", "pull_request"], "configuration");
  if (root.schema_version !== 1) invalid("schema_version must be 1.");
  if (!CHARTHOUSE_MODES.has(root.mode)) invalid("mode must be observe, advise, maintain, or enforce.");
  if (root.git !== undefined) {
    const git = objectAt(root.git, "git");
    keysAt(git, ["canonical_ref"], "git");
    const ref = git.canonical_ref;
    if (ref !== null && (typeof ref !== "string" || !ref.length || ref.length > 200)) invalid("git.canonical_ref must be null or a string of 1 to 200 characters.");
    if (typeof ref === "string") {
      const components = ref.split("/");
      const pseudoRef = new Set(["HEAD", "FETCH_HEAD", "ORIG_HEAD", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_HEAD", "AUTO_MERGE"]);
      if (ref === "@" || pseudoRef.has(ref) || ref.startsWith("-") || /[\s\\~^:?*\[\]]/.test(ref) || ref.includes("..") || ref.includes("@{") || ref.includes("//") || ref.endsWith("/") || ref.endsWith(".") || components.some((component) => !component || component.startsWith(".") || component.endsWith(".lock"))) {
        invalid("git.canonical_ref is not a safe Git ref name.");
      }
    }
  }
  const scan = objectAt(root.scan, "scan");
  keysAt(scan, ["packages", "package_overrides", "tests", "fixtures", "generated", "documents", "instructions", "gitignored", "paths", "languages", "max_file_size", "follow_symlinks", "full_expedition_move_threshold"], "scan");
  const packages = objectAt(scan.packages, "scan.packages");
  keysAt(packages, ["include", "exclude", "excluded_behavior"], "scan.packages");
  selectorAt(packages.include, "scan.packages.include");
  selectorAt(packages.exclude, "scan.packages.exclude");
  if (!["stub", "omit"].includes(packages.excluded_behavior)) invalid("scan.packages.excluded_behavior must be stub or omit.");
  if (!Array.isArray(scan.package_overrides)) invalid("scan.package_overrides must be an array.");
  for (const [index, override] of scan.package_overrides.entries()) {
    objectAt(override, `scan.package_overrides[${index}]`);
    keysAt(override, ["selector", "tests", "fixtures", "generated", "documents"], `scan.package_overrides[${index}]`);
    selectorAt(override.selector, `scan.package_overrides[${index}].selector`);
    for (const key of ["tests", "fixtures", "generated"]) {
      if (override[key] !== undefined && !ROLE_MODES.has(override[key])) invalid(`scan.package_overrides[${index}].${key} has an invalid mode.`);
    }
    if (override.documents !== undefined && !DOCUMENT_MODES.has(override.documents)) invalid(`scan.package_overrides[${index}].documents has an invalid mode.`);
  }
  for (const key of ["tests", "fixtures", "generated"]) rolePolicyAt(scan[key], `scan.${key}`);
  const documents = objectAt(scan.documents, "scan.documents");
  keysAt(documents, ["mode", "include", "exclude"], "scan.documents");
  if (!DOCUMENT_MODES.has(documents.mode)) invalid("scan.documents.mode must be full, selected, or exclude.");
  stringArrayAt(documents.include, "scan.documents.include");
  stringArrayAt(documents.exclude, "scan.documents.exclude");
  if (scan.instructions !== undefined) {
    const instructions = objectAt(scan.instructions, "scan.instructions");
    keysAt(instructions, ["patterns", "size_warning_bytes"], "scan.instructions");
    stringArrayAt(instructions.patterns, "scan.instructions.patterns");
    if (!Number.isInteger(instructions.size_warning_bytes) || instructions.size_warning_bytes < 1024) {
      invalid("scan.instructions.size_warning_bytes must be an integer of at least 1024 bytes.");
    }
  }
  if (scan.gitignored !== undefined) {
    const gitignored = objectAt(scan.gitignored, "scan.gitignored");
    keysAt(gitignored, ["default", "include", "exclude", "hide"], "scan.gitignored");
    if (!GITIGNORED_MODES.has(gitignored.default)) invalid("scan.gitignored.default must be record or scan.");
    stringArrayAt(gitignored.include, "scan.gitignored.include");
    stringArrayAt(gitignored.exclude, "scan.gitignored.exclude");
    stringArrayAt(gitignored.hide, "scan.gitignored.hide");
  }
  const paths = objectAt(scan.paths, "scan.paths");
  keysAt(paths, ["exclude"], "scan.paths");
  stringArrayAt(paths.exclude, "scan.paths.exclude");
  const languages = objectAt(scan.languages, "scan.languages");
  keysAt(languages, ["include", "exclude"], "scan.languages");
  stringArrayAt(languages.include, "scan.languages.include");
  stringArrayAt(languages.exclude, "scan.languages.exclude");
  if (!Number.isInteger(scan.max_file_size) || scan.max_file_size < 1024) invalid("scan.max_file_size must be an integer of at least 1024 bytes.");
  if (typeof scan.follow_symlinks !== "boolean") invalid("scan.follow_symlinks must be true or false.");
  if (typeof scan.full_expedition_move_threshold !== "number" || scan.full_expedition_move_threshold < 0 || scan.full_expedition_move_threshold > 1) {
    invalid("scan.full_expedition_move_threshold must be between 0 and 1.");
  }
  const pullRequest = objectAt(root.pull_request, "pull_request");
  keysAt(pullRequest, ["enabled", "max_words", "mode"], "pull_request");
  if (typeof pullRequest.enabled !== "boolean") invalid("pull_request.enabled must be true or false.");
  if (!Number.isInteger(pullRequest.max_words) || pullRequest.max_words < 50 || pullRequest.max_words > 500) invalid("pull_request.max_words must be between 50 and 500.");
  if (!["body", "comment", "check"].includes(pullRequest.mode)) invalid("pull_request.mode must be body, comment, or check.");
  return config;
}

function patterns(config, key, defaults) {
  const configured = config.scan?.[key]?.patterns;
  return Array.isArray(configured) && configured.length ? configured : defaults;
}

export function matchesAny(path, candidates = []) {
  return candidates.some((pattern) => matchesGlob(pattern, path) || (!pattern.includes("/") && matchesGlob(pattern, fileName(path))));
}

export function instructionPatterns(config) {
  const configured = config.scan?.instructions?.patterns;
  return Array.isArray(configured) ? configured : DEFAULT_INSTRUCTION_PATTERNS;
}

export function instructionWarningBytes(config) {
  return config.scan?.instructions?.size_warning_bytes || INSTRUCTION_FILE_WARNING_BYTES;
}

export function isInstructionPath(path, config) {
  return matchesAny(path, instructionPatterns(config));
}

function normalizePolicyPath(path) {
  return toPosix(path).replace(/^\.\//, "").replace(/\/$/, "");
}

function ignoredRegionForPath(path, regionIndex) {
  let cursor = normalizePolicyPath(path);
  while (cursor) {
    if (regionIndex.has(cursor)) return regionIndex.get(cursor);
    const separator = cursor.lastIndexOf("/");
    if (separator === -1) break;
    cursor = cursor.slice(0, separator);
  }
  return null;
}

function patternCouldReachRegion(pattern, region) {
  const normalized = normalizePolicyPath(pattern);
  if (!normalized.includes("/")) return true;
  const prefix = normalized.split(/[*?]/)[0].replace(/\/$/, "");
  if (!prefix) return true;
  return prefix === region || prefix.startsWith(`${region}/`) || region.startsWith(`${prefix}/`);
}

export function gitignoredDecision(path, config) {
  const settings = config.scan?.gitignored || {};
  if (matchesAny(path, settings.hide || [])) return { treatment: "hide", source: "hide" };
  if (matchesAny(path, settings.include || [])) return { treatment: "scan", source: "include" };
  if (matchesAny(path, settings.exclude || [])) return { treatment: "record", source: "exclude" };
  return { treatment: settings.default || "record", source: "default" };
}

export function gitignoredTreatment(path, config) {
  return gitignoredDecision(path, config).treatment;
}

export function createGitignoredPolicy(root, config) {
  const regions = gitIgnoredRegions(root)
    .map((region) => ({ ...region, path: normalizePolicyPath(region.path) }))
    .filter((region) => region.path)
    .sort((a, b) => a.path.localeCompare(b.path));
  const regionIndex = new Map(regions.map((region) => [region.path, region]));
  const include = config.scan?.gitignored?.include || [];
  const walkExcludes = [];
  for (const region of regions) {
    const probe = region.kind === "directory" ? `${region.path}/__charthouse_boundary__` : region.path;
    const treatment = gitignoredTreatment(probe, config);
    const reachable = include.some((pattern) => patternCouldReachRegion(pattern, region.path));
    if (treatment === "hide" || (treatment === "record" && !reachable)) {
      walkExcludes.push(region.kind === "directory" ? `${region.path}/**` : region.path);
    }
  }
  return {
    regions,
    walkExcludes,
    regionForPath(path) {
      return ignoredRegionForPath(path, regionIndex);
    },
    treatmentForPath(path) {
      return gitignoredTreatment(path, config);
    },
    decisionForPath(path) {
      return gitignoredDecision(path, config);
    },
    accepts(path) {
      return !ignoredRegionForPath(path, regionIndex) || gitignoredTreatment(path, config) === "scan";
    },
    isHardHidden(path) {
      return exclusionMatch(path)?.source === "hard";
    }
  };
}

export function languageForPath(path) {
  return LANGUAGE_BY_EXTENSION.get(extname(path).toLowerCase()) || "Other";
}

export function isDocumentPath(path) {
  return DOCUMENT_EXTENSIONS.has(extname(path).toLowerCase()) || DOC_NAMES.test(path);
}

export function roleForPath(path, config) {
  if (matchesAny(path, patterns(config, "generated", DEFAULT_GENERATED_PATTERNS))) return "generated";
  if (matchesAny(path, patterns(config, "fixtures", DEFAULT_FIXTURE_PATTERNS))) return "fixture";
  if (matchesAny(path, patterns(config, "tests", DEFAULT_TEST_PATTERNS))) return "test";
  return "source";
}

function selectorMatches(selector, unit) {
  if (!selector) return false;
  return (selector.names || []).some((pattern) => /[*?]/.test(pattern) ? matchesGlob(pattern, unit.name || "") : pattern === unit.name)
    || matchesAny(unit.root || ".", selector.paths || []);
}

export function packageScope(unit, config) {
  const packages = config.scan?.packages || {};
  const include = packages.include || { names: [], paths: [] };
  const exclude = packages.exclude || { names: [], paths: [] };
  const hasInclude = (include.names?.length || 0) + (include.paths?.length || 0) > 0;
  const included = !hasInclude || selectorMatches(include, unit);
  return included && !selectorMatches(exclude, unit) ? "included" : (packages.excluded_behavior || "stub");
}

function packageOverride(unit, config) {
  let result = {};
  for (const override of config.scan?.package_overrides || []) {
    if (selectorMatches(override.selector, unit)) result = { ...result, ...override };
  }
  return result;
}

export function effectiveMode(role, unit, config) {
  const base = config.scan?.[role === "test" ? "tests" : role === "fixture" ? "fixtures" : role]?.mode;
  const fallback = role === "source" ? "full" : role === "generated" ? "exclude" : "evidence";
  if (!unit) return base || fallback;
  const key = role === "test" ? "tests" : role === "fixture" ? "fixtures" : role;
  return packageOverride(unit, config)[key] || base || fallback;
}

export function documentAllowed(path, unit, config) {
  if (!isDocumentPath(path)) return true;
  const settings = config.scan?.documents || {};
  const override = unit ? packageOverride(unit, config).documents : null;
  const mode = override || settings.mode || "full";
  if (matchesAny(path, settings.exclude || [])) return false;
  if (mode === "exclude") return false;
  if (mode === "selected") return matchesAny(path, settings.include || []);
  return true;
}

export function languageAllowed(language, path, config) {
  if (STRUCTURAL_NAMES.has(fileName(path))) return true;
  const settings = config.scan?.languages || {};
  const include = settings.include || [];
  const exclude = settings.exclude || [];
  if (exclude.includes(language)) return false;
  return include.length === 0 || include.includes(language);
}

export function walkExcludes(config) {
  const scan = config.scan || {};
  const excludes = [...(scan.paths?.exclude || [])];
  for (const [key, defaults] of [["tests", DEFAULT_TEST_PATTERNS], ["fixtures", DEFAULT_FIXTURE_PATTERNS], ["generated", DEFAULT_GENERATED_PATTERNS]]) {
    const mode = scan[key]?.mode || (key === "generated" ? "exclude" : "evidence");
    const hasOverride = (scan.package_overrides || []).some((item) => item[key] && item[key] !== "exclude");
    if (mode === "exclude" && !hasOverride) excludes.push(...patterns(config, key, defaults));
  }
  return excludes;
}

export function scannerOptions(config) {
  return {
    followSymlinks: config.scan?.follow_symlinks === true,
    maxFileSize: config.scan?.max_file_size
  };
}

function mapOwner(path, map) {
  const nested = (map?.units || [])
    .filter((unit) => unit.root !== "." && (path === unit.root || path.startsWith(`${unit.root}/`)))
    .sort((a, b) => b.root.length - a.root.length || a.root.localeCompare(b.root));
  return nested[0] || (map?.units || []).find((unit) => unit.root === ".") || null;
}

function omittedPath(path, map) {
  const omitted = (map?.scan_summary?.omitted_unit_roots || [])
    .filter((root) => root === "." || path === root || path.startsWith(`${root}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (!omitted) return false;
  const visible = mapOwner(path, map);
  if (!visible) return true;
  const omittedLength = omitted === "." ? 0 : omitted.length;
  const visibleLength = visible.root === "." ? 0 : visible.root.length;
  return omittedLength >= visibleLength;
}

export function fingerprintOptions(config, map, root, ignoredPolicy = createGitignoredPolicy(root, config)) {
  return {
    ...scannerOptions(config),
    acceptFile(path, absolute) {
      if (!ignoredPolicy.accepts(path)) return false;
      const owner = mapOwner(path, map);
      if (owner?.scope === "stub" && !(owner.manifests || [owner.manifest]).filter(Boolean).includes(path)) return false;
      let physicalPath = path;
      try {
        if (root && absolute) physicalPath = toPosix(relative(root, realpathSync(absolute)));
      } catch {
        return false;
      }
      if (!ignoredPolicy.accepts(physicalPath)) return false;
      if (omittedPath(physicalPath, map)) return false;
      const physicalOwner = physicalPath === path ? owner : mapOwner(physicalPath, map);
      if (physicalOwner?.scope === "stub" && !(physicalOwner.manifests || [physicalOwner.manifest]).filter(Boolean).includes(physicalPath)) return false;
      const role = roleForPath(path, config);
      if (effectiveMode(role, owner, config) === "exclude") return false;
      if (physicalOwner !== owner && effectiveMode(role, physicalOwner, config) === "exclude") return false;
      if (!documentAllowed(path, owner, config)) return false;
      if (physicalOwner !== owner && !documentAllowed(physicalPath, physicalOwner, config)) return false;
      return languageAllowed(languageForPath(path), path, config);
    }
  };
}

export function fingerprintExcludes(config, map, watched = ".", ignoredPolicy = null) {
  const excludes = [...walkExcludes(config), ...(ignoredPolicy?.walkExcludes || [])];
  return [...new Set(excludes)];
}

// Instruction Contracts are direct file watches. Ordinary source, document,
// language and package filters must not make a discovered contract invisible.
// Hard safety exclusions still apply inside fingerprintPath.
export function documentFingerprintPolicy(document, watched, config, map, root, ignoredPolicy = createGitignoredPolicy(root, config)) {
  if (document?.kind === "instruction-contract") {
    return {
      excludes: [],
      options: {
        ...scannerOptions(config),
        followFileSymlinks: config.scan?.follow_symlinks === true,
        acceptFile: (path) => isInstructionPath(path, config)
      }
    };
  }
  return {
    excludes: fingerprintExcludes(config, map, watched, ignoredPolicy),
    options: fingerprintOptions(config, map, root, ignoredPolicy)
  };
}
