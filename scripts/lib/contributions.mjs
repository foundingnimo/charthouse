import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CHARTHOUSE_VERSION, SCHEMA_VERSION } from "./constants.mjs";
import { exists, readJson, writeJson } from "./fs.mjs";
import { clearStaleUserStateLock, userStateLockPath, userStateLockStatus, withUserStateLock } from "./lock.mjs";

const TYPES = new Set(["bug", "enhancement"]);
const SOURCES = new Set(["ambient", "tool-gap", "user"]);
const STATUSES = new Set(["candidate", "dismissed", "submitted"]);
const FORMATS = new Set(["suggestion", "pr"]);

export function contributionStatePath(environment = process.env) {
  const home = environment.HOME || homedir();
  const base = environment.CHARTHOUSE_STATE_HOME
    || (environment.XDG_STATE_HOME ? join(environment.XDG_STATE_HOME, "charthouse")
      : process.platform === "win32" && environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, "Charthouse")
        : join(home, ".local", "state", "charthouse"));
  return join(resolve(base), "contributions.json");
}

export function emptyContributionLog() {
  return { schema_version: SCHEMA_VERSION, next_id: 1, improvements: [] };
}

function contributionLockName(environment = process.env) {
  return `contributions:${contributionStatePath(environment)}`;
}

export function contributionLockPath(environment = process.env) {
  return userStateLockPath(contributionLockName(environment));
}

export function contributionLockStatus(environment = process.env) {
  return userStateLockStatus(contributionLockName(environment));
}

export function clearStaleContributionLock(environment = process.env) {
  return clearStaleUserStateLock(contributionLockName(environment));
}

function fail(message) {
  throw new Error(`Invalid Charthouse contribution log: ${message}`);
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail(`${label} contains unknown field ${unknown}.`);
}

function safeText(value, label, maximum = 500) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  const text = value.trim();
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  if (/\r|\n|\0/.test(text)) throw new Error(`${label} must be one line.`);
  if (/(^|\s)(?:\/[^\s]|~[\\/]|[A-Za-z]:[\\/]|\\\\[^\s])/.test(text)) throw new Error(`${label} must not contain an absolute path.`);
  if (/(?:ghp_|github_pat_|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{12,})/.test(text)) {
    throw new Error(`${label} appears to contain a credential or secret.`);
  }
  return text;
}

function slug(value) {
  const key = safeText(value, "--key", 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!key) throw new Error("--key must contain a letter or number.");
  return key;
}

function timestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail(`${label} must be an ISO date-time.`);
}

export function validateContributionLog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("log must be an object.");
  exactKeys(value, ["schema_version", "next_id", "improvements"], "log");
  if (value.schema_version !== SCHEMA_VERSION) fail(`schema_version must be ${SCHEMA_VERSION}.`);
  if (!Number.isInteger(value.next_id) || value.next_id < 1) fail("next_id must be a positive integer.");
  if (!Array.isArray(value.improvements)) fail("improvements must be an array.");
  const ids = new Set();
  const keys = new Set();
  for (const [index, item] of value.improvements.entries()) {
    const label = `improvements[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(`${label} must be an object.`);
    exactKeys(item, ["id", "key", "type", "title", "observed", "expected", "source", "charthouse_version", "first_seen", "last_seen", "occurrences", "status", "dismissal", "submission"], label);
    if (!/^MI-\d{4,}$/.test(item.id)) fail(`${label}.id must use MI-0001 form.`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.key)) fail(`${label}.key must be a lowercase slug.`);
    safeText(item.title, `${label}.title`, 120);
    for (const field of ["observed", "expected"]) safeText(item[field], `${label}.${field}`);
    if (!TYPES.has(item.type)) fail(`${label}.type is invalid.`);
    if (!SOURCES.has(item.source)) fail(`${label}.source is invalid.`);
    if (!STATUSES.has(item.status)) fail(`${label}.status is invalid.`);
    if (typeof item.charthouse_version !== "string" || !item.charthouse_version) fail(`${label}.charthouse_version is required.`);
    timestamp(item.first_seen, `${label}.first_seen`);
    timestamp(item.last_seen, `${label}.last_seen`);
    if (!Number.isInteger(item.occurrences) || item.occurrences < 1) fail(`${label}.occurrences must be positive.`);
    if ((item.status === "dismissed") !== Boolean(item.dismissal)) fail(`${label}.dismissal must match dismissed status.`);
    if ((item.status === "submitted") !== Boolean(item.submission)) fail(`${label}.submission must match submitted status.`);
    if (item.dismissal) {
      exactKeys(item.dismissal, ["reason", "at"], `${label}.dismissal`);
      safeText(item.dismissal.reason, `${label}.dismissal.reason`);
      timestamp(item.dismissal.at, `${label}.dismissal.at`);
    }
    if (item.submission) {
      exactKeys(item.submission, ["kind", "url", "at"], `${label}.submission`);
      if (!FORMATS.has(item.submission.kind)) fail(`${label}.submission.kind is invalid.`);
      if (!/^https:\/\/github\.com\/foundingnimo\/charthouse\/(?:issues|pull)\/\d+$/.test(item.submission.url)) fail(`${label}.submission.url is not a foundingnimo/charthouse issue or pull request.`);
      timestamp(item.submission.at, `${label}.submission.at`);
    }
    if (ids.has(item.id) || keys.has(item.key)) fail(`${label} duplicates an id or key.`);
    ids.add(item.id);
    keys.add(item.key);
  }
  const lastId = value.improvements.reduce((maximum, item) => Math.max(maximum, Number(item.id.slice(3))), 0);
  if (value.next_id <= lastId) fail("next_id must be greater than every allocated id.");
  return value;
}

export function loadContributionLog(environment = process.env) {
  const path = contributionStatePath(environment);
  return exists(path) ? validateContributionLog(readJson(path)) : emptyContributionLog();
}

function saveContributionLog(log, environment) {
  validateContributionLog(log);
  const path = contributionStatePath(environment);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try { chmodSync(dirname(path), 0o700); } catch {}
  writeJson(path, log);
  try { chmodSync(path, 0o600); } catch {}
}

function mutate(operation, callback, environment = process.env) {
  return withUserStateLock(contributionLockName(environment), operation, () => {
    const log = loadContributionLog(environment);
    const result = callback(log);
    saveContributionLog(log, environment);
    return result;
  }, { recoveryCommand: "charthouse contribute doctor --clear-stale-lock" });
}

function now() {
  return new Date().toISOString();
}

export function recordContribution(input, environment = process.env) {
  return mutate("record Charthouse improvement", (log) => {
    const key = slug(input.key);
    if (!TYPES.has(input.type)) throw new Error(`--type must be one of: ${[...TYPES].join(", ")}.`);
    if (!SOURCES.has(input.source)) throw new Error(`--source must be one of: ${[...SOURCES].join(", ")}.`);
    const fields = {
      title: safeText(input.title, "--title", 120),
      observed: safeText(input.observed, "--observed"),
      expected: safeText(input.expected, "--expected")
    };
    let improvement = log.improvements.find((item) => item.key === key);
    if (improvement && improvement.status !== "candidate") return { recorded: false, outcome: improvement.status, improvement };
    const at = now();
    if (!improvement) {
      improvement = {
        id: `MI-${String(log.next_id).padStart(4, "0")}`,
        key,
        type: input.type,
        ...fields,
        source: input.source,
        charthouse_version: CHARTHOUSE_VERSION,
        first_seen: at,
        last_seen: at,
        occurrences: 1,
        status: "candidate",
        dismissal: null,
        submission: null
      };
      log.next_id += 1;
      log.improvements.push(improvement);
      return { recorded: true, outcome: "created", improvement };
    }
    improvement.last_seen = at;
    improvement.occurrences += 1;
    return { recorded: true, outcome: "updated", improvement };
  }, environment);
}

export function listContributions(status = "all", environment = process.env) {
  if (status !== "all" && !STATUSES.has(status)) throw new Error(`Unknown contribution status: ${status}`);
  return loadContributionLog(environment).improvements
    .filter((item) => status === "all" || item.status === status)
    .sort((left, right) => right.occurrences - left.occurrences || left.id.localeCompare(right.id));
}

export function showContribution(id, environment = process.env) {
  const improvement = loadContributionLog(environment).improvements.find((item) => item.id === id);
  if (!improvement) throw new Error(`Unknown Charthouse improvement: ${id}`);
  return improvement;
}

export function previewContribution(id, format, environment = process.env) {
  if (!FORMATS.has(format)) throw new Error(`--as must be one of: ${[...FORMATS].join(", ")}.`);
  const item = showContribution(id, environment);
  if (item.status !== "candidate") throw new Error(`${id} is ${item.status} and cannot be prepared again.`);
  const title = format === "suggestion"
    ? `Suggestion: ${item.title}`
    : `${item.type === "bug" ? "fix" : "feat"}: ${item.title.charAt(0).toLowerCase()}${item.title.slice(1)}`;
  const body = [
    "## Summary",
    "",
    item.expected,
    "",
    "## Observed Charthouse behavior",
    "",
    item.observed,
    "",
    "## Expected behavior",
    "",
    item.expected,
    "",
    "## Environment",
    "",
    `- Charthouse: ${item.charthouse_version}`,
    `- Candidate: ${item.id}`,
    `- Observed: ${item.occurrences} time${item.occurrences === 1 ? "" : "s"}`,
    "",
    ...(format === "pr" ? [
      "## Verification",
      "",
      "- [ ] Add or update a regression test.",
      "- [ ] Run `npm test`.",
      "- [ ] Run `npm run validate`.",
      ""
    ] : []),
    "This proposal was sanitized by Charthouse. Review it before submission; it must not contain target-repository code, names, paths, tickets, or secrets.",
    ""
  ].join("\n");
  return { id: item.id, repository: "foundingnimo/charthouse", format, title, body, external_write_required: true };
}

export function dismissContribution(id, reason, environment = process.env) {
  return mutate("dismiss Charthouse improvement", (log) => {
    const item = log.improvements.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`Unknown Charthouse improvement: ${id}`);
    item.status = "dismissed";
    item.dismissal = { reason: safeText(reason, "--reason"), at: now() };
    item.submission = null;
    return item;
  }, environment);
}

export function markContributionSubmitted(id, kind, url, environment = process.env) {
  return mutate("record submitted Charthouse improvement", (log) => {
    const item = log.improvements.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`Unknown Charthouse improvement: ${id}`);
    if (!FORMATS.has(kind)) throw new Error(`--as must be one of: ${[...FORMATS].join(", ")}.`);
    const submittedUrl = safeText(url, "--url", 300);
    if (!/^https:\/\/github\.com\/foundingnimo\/charthouse\/(?:issues|pull)\/\d+$/.test(submittedUrl)) {
      throw new Error("--url must identify a foundingnimo/charthouse issue or pull request.");
    }
    item.status = "submitted";
    item.submission = { kind, url: submittedUrl, at: now() };
    item.dismissal = null;
    return item;
  }, environment);
}
