import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { exists } from "./fs.mjs";

export const DEFAULT_LOCK_TIMEOUT_MS = 5000;
export const LOCK_RETRY_MS = 50;

const localHost = hostname();
const sleeper = new Int32Array(new SharedArrayBuffer(4));

function digest(value, length = 32) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function userKey() {
  if (typeof process.getuid === "function") return `uid-${process.getuid()}`;
  return `user-${digest(userInfo().username, 16)}`;
}

function stateLockPath(identity) {
  const key = digest(identity);
  return join(tmpdir(), `charthouse-locks-${userKey()}`, key, "state.lock");
}

export function projectLockPath(root) {
  return stateLockPath(`project:${realpathSync(root)}`);
}

export function userStateLockPath(name) {
  if (typeof name !== "string" || !name.trim()) throw new Error("A user-state lock name is required.");
  return stateLockPath(`user:${name.trim()}`);
}

function ensurePrivateDirectory(path) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const stat = lstatSync(path);
  if (!stat.isDirectory()) throw new Error(`Charthouse lock path is not a private directory: ${path}`);
  if (typeof process.getuid === "function" && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) {
    throw new Error(`Charthouse lock directory is not private to the current user: ${path}`);
  }
}

function prepareLockDirectory(path) {
  const repositoryDirectory = dirname(path);
  const userDirectory = dirname(repositoryDirectory);
  ensurePrivateDirectory(userDirectory);
  ensurePrivateDirectory(repositoryDirectory);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readOwner(path) {
  if (!exists(path)) return null;
  try {
    const owner = JSON.parse(readFileSync(path, "utf8"));
    if (
      !owner || typeof owner !== "object" || owner.schema_version !== 1
      || typeof owner.token !== "string" || !owner.token
      || !Number.isInteger(owner.pid) || owner.pid <= 0
      || typeof owner.host !== "string" || !owner.host
      || typeof owner.operation !== "string" || !owner.operation
      || typeof owner.acquired_at !== "string" || Number.isNaN(Date.parse(owner.acquired_at))
    ) {
      return { state: "unreadable" };
    }
    const local = owner.host === localHost;
    return {
      schema_version: owner.schema_version,
      token: owner.token,
      pid: owner.pid,
      host: owner.host,
      operation: owner.operation,
      acquired_at: owner.acquired_at,
      state: local && !processIsAlive(owner.pid) ? "stale" : "active"
    };
  } catch {
    return { state: "unreadable" };
  }
}

function publicOwner(owner) {
  if (!owner) return null;
  const { token: _token, ...visible } = owner;
  return visible;
}

export function projectLockStatus(root) {
  const path = projectLockPath(root);
  const owner = readOwner(path);
  return owner ? { ...publicOwner(owner), path } : null;
}

export function userStateLockStatus(name) {
  const path = userStateLockPath(name);
  const owner = readOwner(path);
  return owner ? { ...publicOwner(owner), path } : null;
}

function clearStaleLock(path, label) {
  const owner = readOwner(path);
  if (!owner) return { cleared: false, path, reason: `No ${label} lock exists.` };
  if (owner.state === "unreadable") throw new Error(`Charthouse cannot prove that the unreadable lock at ${path} is stale. Inspect it manually; no file was removed.`);
  if (owner.state !== "stale") throw new Error(`Charthouse cannot clear the active lock for ${owner.operation} (PID ${owner.pid}, host ${owner.host}). No file was removed.`);
  const verified = readOwner(path);
  if (!verified || verified.state !== "stale" || verified.token !== owner.token) {
    throw new Error(`The ${label} lock changed during stale-lock verification. No file was removed.`);
  }
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { cleared: false, path, reason: "The stale lock was already removed." };
  }
  return { cleared: true, path, owner: publicOwner(owner) };
}

export function clearStaleProjectLock(root) {
  return clearStaleLock(projectLockPath(root), "project-state");
}

export function clearStaleUserStateLock(name) {
  return clearStaleLock(userStateLockPath(name), "user-state");
}

function contentionError(path, operation, owner, recoveryCommand) {
  if (owner?.state === "stale") {
    return new Error(`Charthouse state has a stale lock at ${path} from ${owner.operation || "an unknown operation"} (PID ${owner.pid}, host ${owner.host}). Run \`${recoveryCommand}\`, then retry ${operation}.`);
  }
  if (owner?.state === "unreadable") {
    return new Error(`Charthouse state is locked at ${path}, but the owner metadata is unreadable. Do not remove it while another Charthouse process can be running. Retry ${operation} after the writer finishes.`);
  }
  const detail = owner
    ? `${owner.operation || "another operation"} (PID ${owner.pid}, host ${owner.host}, since ${owner.acquired_at})`
    : "another operation";
  return new Error(`Charthouse state is locked by ${detail}. Retry ${operation} after the writer finishes.`);
}

function acquire(path, operation, timeoutMs, recoveryCommand) {
  prepareLockDirectory(path);
  const owner = {
    schema_version: 1,
    token: randomUUID(),
    pid: process.pid,
    host: localHost,
    operation,
    acquired_at: new Date().toISOString()
  };
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      writeFileSync(path, `${JSON.stringify(owner, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      return { path, owner };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const current = readOwner(path);
      if (current?.pid === process.pid && current?.host === localHost) {
        throw new Error(`Charthouse already holds the state lock for ${current.operation}. Nested state mutation is not allowed while starting ${operation}.`);
      }
      if (current?.state === "stale" || Date.now() >= deadline) {
        throw contentionError(path, operation, current, recoveryCommand);
      }
      Atomics.wait(sleeper, 0, 0, Math.min(LOCK_RETRY_MS, deadline - Date.now()));
    }
  }
}

function release(lock) {
  const current = readOwner(lock.path);
  if (!current || current.token !== lock.owner.token) return;
  try {
    unlinkSync(lock.path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function withProjectLock(root, operation, callback, options = {}) {
  return withStateLock(projectLockPath(root), operation, callback, { recoveryCommand: "charthouse doctor --clear-stale-lock", ...options });
}

export function withUserStateLock(name, operation, callback, options = {}) {
  return withStateLock(userStateLockPath(name), operation, callback, options);
}

function withStateLock(path, operation, callback, options = {}) {
  if (typeof operation !== "string" || !operation.trim()) throw new Error("A lock operation name is required.");
  if (operation.length > 120 || /[\r\n\0]/.test(operation)) throw new Error("A lock operation name must be one line and 120 characters or fewer.");
  if (typeof callback !== "function") throw new Error("A lock callback is required.");
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0) throw new Error("Lock timeout must be a non-negative integer.");
  const recoveryCommand = options.recoveryCommand || "charthouse doctor --clear-stale-lock";
  const lock = acquire(path, operation.trim(), timeoutMs, recoveryCommand);
  let result;
  try {
    result = callback();
  } catch (error) {
    release(lock);
    throw error;
  }
  if (result && typeof result.then === "function") {
    return Promise.resolve(result).finally(() => release(lock));
  }
  release(lock);
  return result;
}
