import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { HARD_EXCLUDES } from "./constants.mjs";

export function exists(path) {
  return existsSync(path);
}

export function findProjectRoot(start = process.cwd()) {
  let cursor = realpathSync(start);
  while (true) {
    if (existsSync(join(cursor, ".git"))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return realpathSync(start);
    cursor = parent;
  }
}

export function assertSafeRoot(root) {
  const resolved = realpathSync(root);
  if (resolved === sep || resolved.length < 4) {
    throw new Error(`Unsafe repository root: ${resolved}`);
  }
  return resolved;
}

export function toPosix(path) {
  return path.split(sep).join("/");
}

export function repoPath(root, path) {
  if (isAbsolute(path)) throw new Error(`Expected a repository-relative path: ${path}`);
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`Path leaves the repository: ${path}`);
  }
  return target;
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeText(path, value) {
  ensureDir(dirname(path));
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, value, "utf8");
  renameSync(temporary, path);
}

export function copyTextIfMissing(source, destination) {
  if (existsSync(destination)) return false;
  writeText(destination, readFileSync(source, "utf8"));
  return true;
}

function globRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0001")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0001/g, "(?:.*/)?")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}(?:/.*)?$`);
}

export function matchesGlob(pattern, path) {
  return globRegex(toPosix(pattern)).test(toPosix(path));
}

export function exclusionMatch(path, extra = []) {
  const normalized = toPosix(path).replace(/^\.\//, "");
  for (const [source, patterns] of [["hard", HARD_EXCLUDES], ["policy", extra]]) {
    for (const pattern of patterns) {
      const clean = toPosix(pattern).replace(/^\.\//, "");
      if (clean.endsWith("/**")) {
        const prefix = clean.slice(0, -3).replace(/\/$/, "");
        const matched = /[*?]/.test(prefix)
          ? globRegex(clean).test(normalized) || globRegex(clean).test(`${normalized}/__charthouse_boundary__`)
          : normalized === prefix || normalized.startsWith(`${prefix}/`);
        if (matched) return { source, pattern };
        continue;
      }
      if (!clean.includes("/")) {
        if (globRegex(clean).test(fileName(normalized))) return { source, pattern };
        continue;
      }
      if (globRegex(clean).test(normalized)) return { source, pattern };
    }
  }
  return null;
}

export function isExcluded(path, extra = []) {
  return Boolean(exclusionMatch(path, extra));
}

export function walkFiles(root, extraExcludes = [], options = {}) {
  const found = [];
  const active = new Set();
  const prefix = toPosix(options.pathPrefix || "").replace(/^\.\/?|\/$/g, "");
  const excluded = (path) => exclusionMatch(path, extraExcludes)
    || (prefix && exclusionMatch(`${prefix}/${toPosix(path)}`, extraExcludes));
  const accepted = (path, absolute) => !options.acceptFile
    || options.acceptFile(prefix ? `${prefix}/${toPosix(path)}` : toPosix(path), absolute);
  const reportPath = (path) => prefix ? `${prefix}/${toPosix(path)}` : toPosix(path);
  function visit(directory) {
    const realDirectory = realpathSync(directory);
    if (active.has(realDirectory)) return;
    active.add(realDirectory);
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const absolute = join(directory, entry.name);
        const rel = toPosix(relative(root, absolute));
        const excludedBy = excluded(rel);
        if (excludedBy) {
          options.onExcluded?.({
            path: prefix ? `${prefix}/${rel}` : rel,
            kind: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
            source: excludedBy.source,
            pattern: excludedBy.pattern
          });
          continue;
        }
        if (entry.isSymbolicLink()) {
          if (!options.followSymlinks) continue;
          let target;
          try {
            target = realpathSync(absolute);
          } catch {
            continue;
          }
          const targetRel = relative(root, target);
          if (targetRel === ".." || targetRel.startsWith(`..${sep}`) || excluded(toPosix(targetRel))) continue;
          const targetStat = statSync(absolute);
          if (targetStat.isDirectory()) visit(absolute);
          else if (targetStat.isFile()) {
            if (accepted(rel, absolute)) found.push(rel);
            else options.onRejected?.({ path: reportPath(rel), kind: "symlink" });
          }
          continue;
        }
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile()) {
          if (accepted(rel, absolute)) found.push(rel);
          else options.onRejected?.({ path: reportPath(rel), kind: "file" });
        }
      }
    } finally {
      active.delete(realDirectory);
    }
  }
  visit(root);
  return found;
}

export function sha256Buffer(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

export function fingerprintFile(path) {
  return sha256Buffer(readFileSync(path));
}

function globBase(pattern) {
  const wildcard = pattern.search(/[*?]/);
  const prefix = wildcard === -1 ? pattern : pattern.slice(0, wildcard);
  const slash = prefix.lastIndexOf("/");
  return slash === -1 ? "." : prefix.slice(0, slash) || ".";
}

function fingerprintGlob(root, pattern, excludes, options) {
  const base = globBase(pattern);
  if (isExcluded(base, excludes)) return "excluded";
  const absolute = repoPath(root, base);
  if (!existsSync(absolute) || !lstatSync(absolute).isDirectory()) return "missing";
  const prefix = base === "." ? "" : base;
  const matches = walkFiles(absolute, excludes, { ...options, pathPrefix: prefix })
    .map((path) => ({ path, repositoryPath: prefix ? `${prefix}/${toPosix(path)}` : toPosix(path) }))
    .filter((item) => matchesGlob(pattern, item.repositoryPath));
  if (!matches.length) return "missing";
  const hash = createHash("sha256");
  for (const item of matches.sort((left, right) => left.repositoryPath.localeCompare(right.repositoryPath))) {
    const file = join(absolute, item.path);
    const stat = statSync(file);
    hash.update(item.repositoryPath);
    hash.update("\0");
    if (options.maxFileSize && stat.size > options.maxFileSize) hash.update(`oversize\0${stat.size}\0${stat.mtimeMs}`);
    else hash.update(readFileSync(file));
  }
  return `sha256:${hash.digest("hex")}`;
}

export function fingerprintPath(root, rel, excludes = [], options = {}) {
  rel = toPosix(rel);
  if (rel === "**") rel = ".";
  else if (rel.endsWith("/**") && !/[*?]/.test(rel.slice(0, -3))) rel = rel.slice(0, -3).replace(/\/$/, "");
  else if (/[*?]/.test(rel)) return fingerprintGlob(root, rel, excludes, options);
  if (isExcluded(rel, excludes)) return "excluded";
  const absolute = repoPath(root, rel);
  if (!existsSync(absolute)) return "missing";
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() && options.followFileSymlinks) {
    let target;
    try { target = realpathSync(absolute); } catch { return "missing"; }
    const targetRel = relative(root, target);
    if (targetRel === ".." || targetRel.startsWith(`..${sep}`)) return "unsupported";
    const normalizedTarget = toPosix(targetRel);
    if (isExcluded(normalizedTarget, excludes)) return "excluded";
    const targetStat = statSync(target);
    if (!targetStat.isFile()) return "unsupported";
    if (options.acceptFile && !options.acceptFile(rel, absolute)) return "excluded";
    if (options.maxFileSize && targetStat.size > options.maxFileSize) {
      return sha256Buffer(Buffer.from(`symlink-oversize\0${normalizedTarget}\0${targetStat.size}\0${targetStat.mtimeMs}`));
    }
    const hash = createHash("sha256");
    hash.update(`symlink\0${normalizedTarget}\0`);
    hash.update(readFileSync(target));
    return `sha256:${hash.digest("hex")}`;
  }
  if (stat.isFile()) {
    if (options.acceptFile && !options.acceptFile(rel, absolute)) return "excluded";
    if (options.maxFileSize && stat.size > options.maxFileSize) {
      return sha256Buffer(Buffer.from(`oversize\0${stat.size}\0${stat.mtimeMs}`));
    }
    return fingerprintFile(absolute);
  }
  if (!stat.isDirectory()) return "unsupported";
  const hash = createHash("sha256");
  const pathPrefix = rel === "." ? "" : rel;
  const boundaries = [];
  const recordBoundary = (event) => boundaries.push(event);
  for (const file of walkFiles(absolute, excludes, {
    ...options,
    pathPrefix,
    onExcluded(event) {
      recordBoundary({ ...event, treatment: "excluded" });
      options.onExcluded?.(event);
    },
    onRejected(event) {
      recordBoundary({ ...event, treatment: "record" });
      options.onRejected?.(event);
    }
  })) {
    const fileStat = statSync(join(absolute, file));
    hash.update(file);
    hash.update("\0");
    if (options.maxFileSize && fileStat.size > options.maxFileSize) {
      hash.update(`oversize\0${fileStat.size}\0${fileStat.mtimeMs}`);
    } else {
      hash.update(readFileSync(join(absolute, file)));
    }
    hash.update("\0");
  }
  for (const boundary of boundaries.sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`boundary\0${boundary.path}\0${boundary.kind}\0${boundary.treatment}\0${boundary.source || "filter"}\0${boundary.pattern || ""}\0`);
  }
  return `sha256:${hash.digest("hex")}`;
}

// A watch can be a file, a directory, a `dir/**` scope or a glob. Keep glob
// semantics in Git review packets so the diff covers the same files as the
// fingerprint.
export function watchPathspec(watch) {
  if (watch === "**" || watch === ".") return ".";
  let path = watch.endsWith("/**") && !/[*?]/.test(watch.slice(0, -3)) ? watch.slice(0, -3) : watch;
  if (/[*?]/.test(path)) return `:(glob)${path}`;
  return path.replace(/\/$/, "") || ".";
}

export function relativeFrom(root, absolute) {
  return toPosix(relative(root, absolute));
}

export function fileName(path) {
  return basename(path);
}
