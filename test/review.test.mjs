import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { acceptAllSurveys } from "./helpers/surveys.mjs";
import { fingerprintPath, watchPathspec } from "../scripts/lib/fs.mjs";
import { verificationStamp } from "../scripts/lib/state.mjs";
import { gitDiffSince } from "../scripts/lib/git.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(packageRoot, "bin/charthouse");
const fixture = join(packageRoot, "test/fixtures/monorepo");
let sandbox;

function run(...args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: sandbox, encoding: "utf8" });
}

function ok(...args) {
  const result = run(...args);
  assert.equal(result.status, 0, `charthouse ${args.join(" ")}\n${result.stderr}`);
  return result;
}

function git(...args) {
  const result = spawnSync("git", ["-c", "user.email=charthouse@test.local", "-c", "user.name=Charthouse Test", "-c", "commit.gpgsign=false", ...args], { cwd: sandbox, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function commitAll(message) {
  git("add", "-A");
  git("commit", "--quiet", "--allow-empty", "-m", message);
  return git("rev-parse", "HEAD");
}

function initializeCanonical(ref = "canonical") {
  git("branch", ref);
  return ok("init", "--canonical-ref", ref, "--root", sandbox);
}

function approveAllCapabilities() {
  acceptAllSurveys(sandbox, run);
  const map = readState("map.json");
  map.capabilities = map.capabilities.map((capability) => ({
    ...capability,
    approved: true,
    provenance: "human-approved"
  }));
  writeState("map.json", map);
  ok("navigator", "regenerate", "all", "--root", sandbox);
}

function readState(name) {
  return JSON.parse(readFileSync(join(sandbox, ".charthouse", name), "utf8"));
}

function writeState(name, value) {
  writeFileSync(join(sandbox, ".charthouse", name), `${JSON.stringify(value, null, 2)}\n`);
}

function configureCanonical(ref) {
  const config = readState("config.json");
  config.git = { canonical_ref: ref };
  writeState("config.json", config);
}

function addDocument(id, document) {
  const manifest = readState("manifest.json");
  manifest.documents[id] = { status: "current", criticality: "informational", knowledge: [], ...document };
  writeState("manifest.json", manifest);
}

function append(path, text) {
  const absolute = join(sandbox, path);
  writeFileSync(absolute, `${readFileSync(absolute, "utf8")}${text}`);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "charthouse-review-"));
  cpSync(fixture, sandbox, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

test("a watch reduces to the Git pathspec its fingerprint covers", () => {
  assert.equal(watchPathspec("**"), ".");
  assert.equal(watchPathspec("."), ".");
  assert.equal(watchPathspec("apps/web/src/**"), "apps/web/src");
  assert.equal(watchPathspec("packages/health-web/src/api/*.ts"), ":(glob)packages/health-web/src/api/*.ts");
  assert.equal(watchPathspec("vitest*.config.ts"), ":(glob)vitest*.config.ts");
  assert.equal(watchPathspec("AGENTS.md"), "AGENTS.md");
});

test("a wildcard inside a file name fingerprints only matching files", () => {
  writeFileSync(join(sandbox, "vitest.unit.config.ts"), "export default { unit: true };\n");
  writeFileSync(join(sandbox, "unrelated.config.ts"), "export default {};\n");
  const before = fingerprintPath(sandbox, "vitest*.config.ts");
  assert.notEqual(before, "missing");

  writeFileSync(join(sandbox, "unrelated.config.ts"), "export default { changed: true };\n");
  assert.equal(fingerprintPath(sandbox, "vitest*.config.ts"), before);

  writeFileSync(join(sandbox, "vitest.unit.config.ts"), "export default { unit: false };\n");
  assert.notEqual(fingerprintPath(sandbox, "vitest*.config.ts"), before);
});

test("a stamp is dirty only when a changed path falls inside a watch", () => {
  const context = { commit: "abc1234", changed: ["apps/web/src/index.ts", "docs/charthouse/"] };
  assert.equal(verificationStamp(["packages/auth/src"], context).verified_dirty, false);
  assert.equal(verificationStamp(["apps/web/src/**"], context).verified_dirty, true);
  assert.equal(verificationStamp(["docs/charthouse/chronicles"], context).verified_dirty, true);
  assert.equal(verificationStamp(["."], context).verified_dirty, true);
  assert.equal(verificationStamp(["."], { commit: null, changed: ["x"] }).verified_dirty, false);
  assert.equal(verificationStamp([], context).verified_evidence, null);
  assert.equal(verificationStamp(["vitest*.config.ts"], { commit: "abc1234", changed: ["vitest.unit.config.ts"] }).verified_dirty, true);
  assert.equal(verificationStamp(["vitest*.config.ts"], { commit: "abc1234", changed: ["unrelated.config.ts"] }).verified_dirty, false);
});

test("init stamps every document with the commit its fingerprints describe", () => {
  git("init", "--quiet");
  const head = commitAll("fixture");
  initializeCanonical();
  const { documents } = readState("manifest.json");
  assert.ok(Object.keys(documents).length > 1);
  for (const [id, document] of Object.entries(documents)) {
    assert.equal(document.verified_commit, head, id);
    assert.equal(document.verified_dirty, false, id);
    assert.equal(document.verified_evidence, null, id);
    assert.match(document.verified_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, id);
  }
});

test("map update stamps only what it fingerprints afresh", () => {
  git("init", "--quiet");
  const first = commitAll("fixture");
  initializeCanonical();
  approveAllCapabilities();
  commitAll("charthouse state");
  writeFileSync(join(sandbox, "docs/guide.md"), "# Guide\n");
  addDocument("doc-guide", { path: "docs/guide.md", watches: ["packages/auth/src"] });
  addDocument("doc-web", { path: "docs/guide.md", watches: ["apps/web/src"] });
  const second = commitAll("add documents");
  append("packages/auth/src/token.ts", "\n// uncommitted\n");
  ok("map", "update", "--root", sandbox);

  const { documents } = readState("manifest.json");
  assert.equal(documents["doc-charter"].verified_commit, first);
  const navigators = Object.entries(documents).filter(([id]) => id.startsWith("navigator-"));
  assert.ok(navigators.length > 0);
  for (const [id, document] of navigators) assert.equal(document.verified_commit, first, id);
  assert.equal(documents["doc-map"].verified_commit, second);
  assert.equal(documents["doc-guide"].verified_commit, second);
  assert.equal(documents["doc-guide"].verified_dirty, true);
  assert.equal(documents["doc-web"].verified_commit, second);
  assert.equal(documents["doc-web"].verified_dirty, false);
});

function reviewJson(...args) {
  return JSON.parse(ok("docs", "review", ...args, "--json", "--root", sandbox).stdout);
}

// A repository whose doc-guide was fingerprinted at a known, clean commit.
function guidedRepository() {
  git("init", "--quiet");
  commitAll("fixture");
  initializeCanonical();
  approveAllCapabilities();
  writeFileSync(join(sandbox, "docs/guide.md"), "# Guide\n\nTokens come from packages/auth/src/token.ts.\n");
  addDocument("doc-guide", { path: "docs/guide.md", watches: ["packages/auth/src"] });
  const base = commitAll("add guide");
  ok("map", "update", "--root", sandbox);
  commitAll("charthouse state");
  return base;
}

test("docs review lists no document while every watch matches its fingerprint", () => {
  guidedRepository();
  assert.deepEqual(reviewJson().documents, []);
});

test("a changed watch yields a diff packet from the verified commit", () => {
  const base = guidedRepository();
  append("packages/auth/src/token.ts", "\n// rotated\n");
  commitAll("Rotate the token format");
  const [packet, ...rest] = reviewJson("doc-guide").documents;
  assert.deepEqual(rest, []);
  assert.equal(packet.mode, "diff");
  assert.equal(packet.base.commit, base);
  assert.equal(packet.base.reachable, true);
  assert.deepEqual(packet.changed_watches, ["packages/auth/src"]);
  assert.match(packet.diff, /^\+\/\/ rotated$/m);
  assert.equal(packet.diff_truncated, false);
  assert.deepEqual(packet.commits.map((commit) => commit.subject), ["Rotate the token format"]);
  assert.deepEqual(packet.untracked, []);
});

test("uncommitted and untracked changes are part of the packet", () => {
  guidedRepository();
  append("packages/auth/src/token.ts", "\n// not committed\n");
  writeFileSync(join(sandbox, "packages/auth/src/refresh.ts"), "export const refresh = true;\n");
  const [packet] = reviewJson("doc-guide").documents;
  assert.equal(packet.mode, "diff");
  assert.match(packet.diff, /^\+\/\/ not committed$/m);
  assert.deepEqual(packet.commits, []);
  assert.deepEqual(packet.untracked, ["packages/auth/src/refresh.ts"]);
});

test("a missing or unreachable verification commit asks for a full review", () => {
  guidedRepository();
  append("packages/auth/src/token.ts", "\n// rotated\n");
  const manifest = readState("manifest.json");
  manifest.documents["doc-guide"].verified_commit = "0123456789abcdef0123456789abcdef01234567";
  writeState("manifest.json", manifest);
  let [packet] = reviewJson("doc-guide").documents;
  assert.equal(packet.mode, "full");
  assert.equal(packet.base.reachable, false);
  assert.match(packet.reason, /is not in the history of HEAD/);
  assert.equal(packet.diff, null);

  delete manifest.documents["doc-guide"].verified_commit;
  writeState("manifest.json", manifest);
  [packet] = reviewJson("doc-guide").documents;
  assert.equal(packet.mode, "full");
  assert.match(packet.reason, /No verification commit is recorded/);
});

test("document review refuses when a legacy repository has no Git metadata", () => {
  git("init", "--quiet");
  commitAll("fixture");
  initializeCanonical();
  rmSync(join(sandbox, ".git"), { recursive: true, force: true });
  const review = run("docs", "review", "--root", sandbox);
  assert.equal(review.status, 1);
  assert.match(review.stderr, /requires a Git repository with an explicit canonical branch/);
});

test("init requires a Git commit before it can pin a branch", () => {
  git("init", "--quiet");
  const init = run("init", "--canonical-ref", "main", "--root", sandbox);
  assert.equal(init.status, 1);
  assert.match(init.stderr, /requires at least one Git commit/);
});

test("a declared suspect document is reviewed in full, and a historical one never", () => {
  guidedRepository();
  addDocument("doc-report", { path: "docs/guide.md", status: "historical", criticality: "historical", watches: ["packages/auth/src"] });
  const manifest = readState("manifest.json");
  manifest.documents["doc-guide"].status = "suspect";
  writeState("manifest.json", manifest);

  assert.deepEqual(reviewJson().documents.map((packet) => packet.id), ["doc-guide"]);
  const [packet] = reviewJson("doc-guide").documents;
  assert.equal(packet.mode, "full");
  assert.match(packet.reason, /declared suspect/);

  append("packages/auth/src/token.ts", "\n// rotated\n");
  const ids = reviewJson().documents.map((item) => item.id);
  assert.equal(ids.includes("doc-report"), false);
  assert.equal(ids.includes("doc-guide"), true);
});

test("docs review refuses an unknown document", () => {
  guidedRepository();
  const result = run("docs", "review", "doc-nope", "--root", sandbox);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown document: doc-nope/);
});

test("a large diff is cut at the byte limit and says so", () => {
  const base = guidedRepository();
  append("packages/auth/src/token.ts", `\n// ${"x".repeat(1000)}\n`);
  const diff = gitDiffSince(sandbox, base, ["packages/auth/src"], 64);
  assert.equal(diff.truncated, true);
  assert.ok(Buffer.byteLength(diff.text) <= 64);
});

test("the human rendering names each document and how it will be reviewed", () => {
  guidedRepository();
  append("packages/auth/src/token.ts", "\n// rotated\n");
  commitAll("Rotate the token format");
  const text = ok("docs", "review", "doc-guide", "--root", sandbox).stdout;
  assert.match(text, /^Documents to review: 1 \(HEAD [0-9a-f]{7}\)$/m);
  assert.match(text, /^- doc-guide \[informational\] docs\/guide\.md: diff since [0-9a-f]{7}, 1 changed watch, 1 commit$/m);
});

function chronicle(name = "2026-09-16-doc-guide.md") {
  const path = `docs/charthouse/chronicles/reviews/${name}`;
  mkdirSync(join(sandbox, "docs/charthouse/chronicles/reviews"), { recursive: true });
  writeFileSync(join(sandbox, path), "# Review of doc-guide\n\nVerdict: holds.\n");
  return path;
}

test("docs confirm refuses without evidence of a review", () => {
  guidedRepository();
  for (const [args, message] of [
    [[], /requires --evidence/],
    [["--evidence", "README.md"], /must be a file under docs\/charthouse\/chronicles\//],
    [["--evidence", "docs/charthouse/chronicles/../../../README.md"], /must be a file under docs\/charthouse\/chronicles\//],
    [["--evidence", "docs/charthouse/chronicles/reviews/missing.md"], /evidence file does not exist/]
  ]) {
    const result = run("docs", "confirm", "doc-guide", ...args, "--root", sandbox);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, message);
  }
});

test("docs confirm refuses an unknown or historical document", () => {
  guidedRepository();
  const evidence = chronicle();
  addDocument("doc-report", { path: "docs/guide.md", status: "historical", criticality: "historical", watches: [] });
  let result = run("docs", "confirm", "doc-nope", "--evidence", evidence, "--root", sandbox);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown document: doc-nope/);
  result = run("docs", "confirm", "doc-report", "--evidence", evidence, "--root", sandbox);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is historical/);
});

test("a confirmed document is current again from its new commit", () => {
  guidedRepository();
  append("packages/auth/src/token.ts", "\n// rotated\n");
  const head = commitAll("Rotate the token format");
  const manifest = readState("manifest.json");
  manifest.documents["doc-guide"].status = "suspect";
  writeState("manifest.json", manifest);
  // Live control: before the confirmation the Bearing check flags the document.
  assert.match(ok("check", "--root", sandbox).stdout, /doc-guide is suspect because packages\/auth\/src changed/);

  const evidence = chronicle();
  const confirmed = JSON.parse(ok("docs", "confirm", "doc-guide", "--evidence", evidence, "--json", "--root", sandbox).stdout);
  assert.equal(confirmed.status, "current");
  assert.equal(confirmed.verified_commit, head);
  assert.equal(confirmed.verified_evidence, evidence);

  assert.doesNotMatch(ok("check", "--root", sandbox).stdout, /doc-guide/);
  assert.deepEqual(reviewJson("doc-guide").documents, []);
  const document = readState("manifest.json").documents["doc-guide"];
  assert.equal(document.verified_commit, head);
  assert.equal(document.verified_evidence, evidence);
});

test("next asks for a review of suspect documents instead of an update", () => {
  guidedRepository();
  const manifest = readState("manifest.json");
  manifest.documents["doc-guide"].criticality = "binding";
  writeState("manifest.json", manifest);
  append("packages/auth/src/token.ts", "\n// rotated\n");
  const text = ok("next", "--root", sandbox).stdout;
  assert.match(text, /\[now\] Review \d+ suspect documents?: [^\n]*docs\/guide\.md[^\n]*\.\n   charthouse docs review\n/);
  assert.doesNotMatch(text, /charthouse run "Update docs\/guide\.md"/);
});

test("the session-start message points at the document review", () => {
  guidedRepository();
  const current = ok("hook", "session-start", "--root", sandbox).stdout;
  assert.doesNotMatch(current, /docs review/);
  assert.match(current, /\d+ project Navigators? (is|are) available; use \/agents or \/charthouse who <path>\./);
  append("packages/auth/src/token.ts", "\n// rotated\n");
  assert.match(ok("hook", "session-start", "--root", sandbox).stdout, /\d+ documents? (is|are) suspect; run \/charthouse docs review\./);
});

test("the reviewer agent and the review workflow ship with the skill", () => {
  const agent = readFileSync(join(packageRoot, "agents/charthouse-docs-reviewer.md"), "utf8");
  assert.match(agent, /^---\nname: charthouse-docs-reviewer\n/);
  assert.match(agent, /\ndisallowedTools: Write, Edit\n/);
  assert.match(agent, /"verdict": "holds \| needs-change \| unsure"/);
  const maintenance = readFileSync(join(packageRoot, "skills/charthouse/references/maintenance.md"), "utf8");
  assert.match(maintenance, /## Document review/);
  assert.match(maintenance, /charthouse docs review --json/);
  assert.match(maintenance, /charthouse docs confirm <id> --evidence <file>/);
  assert.match(readFileSync(join(packageRoot, "skills/charthouse/references/voyage.md"), "utf8"), /Run the document review/);
});

// A branch behind accepted history produces confident findings about code that
// already changed. The guard uses canonical_ref, not the branch's upstream.
function behindCanonical() {
  git("init", "--quiet");
  commitAll("fixture");
  git("branch", "base");
  git("checkout", "--quiet", "base");
  ok("init", "--canonical-ref", "base", "--root", sandbox);
  commitAll("charthouse state");
  git("checkout", "--quiet", "-b", "work");
  git("checkout", "--quiet", "base");
  append("packages/auth/src/token.ts", "\n// upstream moved\n");
  commitAll("Rotate the token format");
  git("checkout", "--quiet", "work");
}

test("docs review refuses while the branch is behind the canonical ref", () => {
  behindCanonical();
  const refused = run("docs", "review", "--root", sandbox);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /canonical branch base: 1 commit behind/);
  assert.match(refused.stderr, /--allow-behind/);
  const allowed = run("docs", "review", "--allow-behind", "--json", "--root", sandbox);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).canonical.ref, "base");
});

test("run refuses to plan against a branch that is behind the canonical ref", () => {
  behindCanonical();
  const refused = run("run", "Update the guide", "--root", sandbox);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /canonical branch base: 1 commit behind/);
  const allowed = run("run", "Update the guide", "--allow-behind", "--root", sandbox);
  assert.equal(allowed.status, 0, allowed.stderr);
});

test("a branch level with or ahead of canonical history is not refused", () => {
  git("init", "--quiet");
  commitAll("fixture");
  git("branch", "base");
  git("checkout", "--quiet", "base");
  ok("init", "--canonical-ref", "base", "--root", sandbox);
  commitAll("charthouse state");
  git("checkout", "--quiet", "-b", "work");
  assert.equal(run("docs", "review", "--root", sandbox).status, 0);
  append("packages/auth/src/token.ts", "\n// ours\n");
  commitAll("Our own commit");
  assert.equal(run("docs", "review", "--root", sandbox).status, 0);
});

test("legacy unpinned state is refused even with the checkout-drift override", () => {
  guidedRepository();
  configureCanonical(null);
  for (const args of [
    ["docs", "review", "--root", sandbox],
    ["docs", "review", "--allow-behind", "--root", sandbox],
    ["run", "Update the guide", "--allow-behind", "--root", sandbox]
  ]) {
    const refused = run(...args);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /requires git\.canonical_ref/);
  }
});

test("origin HEAD is offered as evidence but never selected implicitly", () => {
  git("init", "--quiet");
  commitAll("fixture");
  const head = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/trunk", head);
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
  let init = run("init", "--root", sandbox);
  assert.equal(init.status, 1);
  assert.match(init.stderr, /Ask the user which branch represents accepted history/);
  assert.match(init.stderr, /origin\/trunk/);
  assert.doesNotMatch(init.stderr, /Available branches:[^\n]*origin\/HEAD/);
  init = run("init", "--canonical-ref", "origin/HEAD", "--root", sandbox);
  assert.equal(init.status, 1);
  assert.match(init.stderr, /is symbolic/);
  ok("init", "--canonical-ref", "origin/trunk", "--root", sandbox);
  const status = JSON.parse(ok("status", "--json", "--root", sandbox).stdout).git;
  assert.equal(status.ref, "origin/trunk");
  assert.equal(status.source, "configured");
  assert.equal(status.relationship, "current");
  const doctor = JSON.parse(ok("doctor", "--json", "--root", sandbox).stdout).git;
  assert.equal(doctor.canonical_commit, head);
});

test("a missing configured canonical ref and detached HEAD are refused", () => {
  git("init", "--quiet");
  commitAll("fixture");
  initializeCanonical();
  configureCanonical("origin/trunk");
  let refused = run("docs", "review", "--root", sandbox);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /canonical branch origin\/trunk is not available locally/);

  configureCanonical("HEAD~0");
  // The policy rejects revision expressions: canonical_ref must be a ref name.
  refused = run("status", "--root", sandbox);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /safe Git ref name/);

  configureCanonical("base");
  git("branch", "base");
  git("checkout", "--quiet", "--detach", "HEAD");
  refused = run("docs", "review", "--root", sandbox);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /HEAD is detached/);
  assert.equal(run("docs", "review", "--allow-behind", "--root", sandbox).status, 0);
});

test("docs confirm applies the same canonical guard", () => {
  behindCanonical();
  const evidence = chronicle("canonical-review.md");
  const refused = run("docs", "confirm", "doc-charter", "--evidence", evidence, "--root", sandbox);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /canonical branch base: 1 commit behind/);
  const allowed = run("docs", "confirm", "doc-charter", "--evidence", evidence, "--allow-behind", "--root", sandbox);
  assert.equal(allowed.status, 0, allowed.stderr);
});
