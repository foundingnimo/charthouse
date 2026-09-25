import { readFileSync, rmSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { PATHS } from "./constants.mjs";
import { listExpeditions, recordPublicationFinished, recordPublicationStarted } from "./expedition-state.mjs";
import { digestJson, exists, fingerprintFile, readJson, repoPath, sha256Buffer, writeJson, writeText } from "./fs.mjs";

// An Expedition publishes in three steps. The publisher stages every write,
// records the commit point, then applies the plan. Each step of the plan is
// idempotent, so a publication that stops midway finishes on the next writer
// without a new decision.

const PLAN_SCHEMA_VERSION = 1;

// Collects the writes of a Map update instead of performing them.
export function plannedWrites() {
  const entries = new Map();
  return {
    entries,
    write(path, text) {
      entries.set(path, { path, action: "write", text });
    },
    remove(path, { prune = false } = {}) {
      entries.set(path, { path, action: "remove", prune });
    }
  };
}

function publicationRoot(expedition) {
  return `${expedition.draft_root}/publication`;
}

// Views and documents first, Charthouse state next, and the Map last. Until the
// Map lands, readers still see the earlier approved state.
function applyOrder(entry) {
  if (entry.path === PATHS.map) return 2;
  return entry.path.startsWith(`${PATHS.state}/`) ? 1 : 0;
}

function readPlan(root, expedition) {
  const path = repoPath(root, `${publicationRoot(expedition)}/plan.json`);
  if (!exists(path)) throw new Error(`The publication plan of ${expedition.id} is missing.`);
  const plan = readJson(path);
  if (digestJson(plan) !== expedition.publication.plan_digest) throw new Error(`The publication plan of ${expedition.id} changed after it was recorded.`);
  return plan;
}

function applied(root, entry) {
  const target = repoPath(root, entry.path);
  if (entry.action === "remove") return !exists(target);
  try {
    return fingerprintFile(target) === entry.digest;
  } catch {
    return false;
  }
}

function stagedText(root, entry) {
  const staged = repoPath(root, entry.staged);
  if (!exists(staged) || fingerprintFile(staged) !== entry.digest) throw new Error(`The staged publication file changed: ${entry.staged}`);
  return readFileSync(staged, "utf8");
}

function applyEntry(root, entry, text) {
  const target = repoPath(root, entry.path);
  if (entry.action === "write") {
    writeText(target, text);
    return;
  }
  if (exists(target)) unlinkSync(target);
  if (entry.prune) {
    try { rmdirSync(dirname(target)); } catch {}
  }
}

// Stage the planned writes, then record the commit point in the Expedition.
export function beginPublication(root, expedition, writes) {
  const base = publicationRoot(expedition);
  rmSync(repoPath(root, `${base}/staged`), { recursive: true, force: true });
  const entries = [...writes].sort((left, right) => applyOrder(left) - applyOrder(right)).map((entry) => {
    if (entry.action === "remove") return { path: entry.path, action: "remove", prune: entry.prune };
    const staged = `${base}/staged/${entry.path}`;
    writeText(repoPath(root, staged), entry.text);
    return { path: entry.path, action: "write", staged, digest: sha256Buffer(Buffer.from(entry.text)) };
  });
  const plan = { schema_version: PLAN_SCHEMA_VERSION, expedition: expedition.id, entries };
  writeJson(repoPath(root, `${base}/plan.json`), plan);
  return recordPublicationStarted(root, expedition, digestJson(plan));
}

// Apply what is still pending and record the receipt. Every staged file is
// checked before the first write, so a damaged plan changes nothing.
export function finishPublication(root, expedition) {
  try {
    const plan = readPlan(root, expedition);
    const pending = plan.entries.filter((entry) => !applied(root, entry));
    const texts = new Map(pending.filter((entry) => entry.action === "write").map((entry) => [entry.path, stagedText(root, entry)]));
    for (const entry of pending) applyEntry(root, entry, texts.get(entry.path));
    const receipt = {
      expedition: expedition.id,
      plan_digest: expedition.publication.plan_digest,
      completed_at: new Date().toISOString(),
      written: plan.entries.filter((entry) => entry.action === "write").map((entry) => ({ path: entry.path, digest: entry.digest })),
      removed: plan.entries.filter((entry) => entry.action === "remove").map((entry) => entry.path)
    };
    writeJson(repoPath(root, `${publicationRoot(expedition)}/receipt.json`), receipt);
    return recordPublicationFinished(root, expedition, { written: receipt.written.length, removed: receipt.removed.length });
  } catch (error) {
    throw new Error(`Publication of ${expedition.id} stopped: ${error.message} Fix the cause and run \`charthouse navigator regenerate all\` to finish it. The approved result does not change.`);
  }
}

export function pendingPublication(root) {
  return listExpeditions(root).find((expedition) => expedition.status === "publishing") || null;
}

// Every writer of generated state calls this under the project lock first, so
// that it never mixes its writes with a half-applied publication.
export function finishPendingPublication(root) {
  const expedition = pendingPublication(root);
  return expedition ? finishPublication(root, expedition) : null;
}
