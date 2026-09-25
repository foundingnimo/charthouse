import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installer = join(packageRoot, "scripts/install-standalone-hooks.mjs");

test("standalone hook installation preserves settings and is idempotent", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "charthouse-hooks-"));
  try {
    const runtime = join(sandbox, ".charthouse");
    const settingsPath = join(sandbox, "settings.json");
    writeFileSync(settingsPath, `${JSON.stringify({
      model: "sonnet",
      hooks: {
        Stop: [{ hooks: [
          { type: "command", command: "existing-command" },
          { type: "command", command: `node "${join(sandbox, "charthouse/bin/charthouse")}" hook stop` }
        ] }]
      }
    }, null, 2)}\n`);

    for (let run = 0; run < 2; run += 1) {
      const result = spawnSync(process.execPath, [installer, sandbox, runtime], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }

    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(settings.model, "sonnet");
    assert.ok(settings.hooks.Stop.some((group) => group.hooks.some((hook) => hook.command === "existing-command")));
    for (const event of ["SessionStart", "PostToolUse", "Stop"]) {
      const commands = settings.hooks[event].flatMap((group) => group.hooks.map((hook) => hook.command));
      assert.equal(commands.filter((command) => command.includes("charthouse/bin/charthouse") || command.includes(".charthouse/bin/charthouse")).length, 1);
      assert.ok(commands.some((command) => command.includes(runtime.replace(/\\/g, "/"))));
    }
    assert.ok(readdirSync(sandbox).some((name) => name.startsWith("settings.json.charthouse-backup-")));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("install.sh --update replaces runtime and skills while safely refreshing hooks", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "charthouse-install-"));
  try {
    const runtime = join(sandbox, ".charthouse");
    const claude = join(sandbox, ".claude");
    const shared = join(sandbox, ".agents/skills");
    const env = { ...process.env, HOME: sandbox, CHARTHOUSE_HOME: runtime, CLAUDE_CONFIG_DIR: claude, AGENT_SKILLS_DIR: shared };
    const first = spawnSync("sh", [join(packageRoot, "install.sh"), "--no-hooks"], { encoding: "utf8", env });
    assert.equal(first.status, 0, first.stderr);
    // stdin is a pipe here, so the installer cannot ask. It names both versions and refuses.
    const again = spawnSync("sh", [join(packageRoot, "install.sh"), "--no-hooks"], { encoding: "utf8", env, input: "" });
    assert.notEqual(again.status, 0);
    assert.match(again.stdout, /Charthouse \S+ \(.+\) is installed in/);
    assert.match(again.stdout, /This checkout is \S+ \(.+\)/);
    assert.match(again.stdout, /--update/);
    const stamp = JSON.parse(readFileSync(join(runtime, ".install.json"), "utf8"));
    assert.equal(stamp.version, JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version);
    assert.equal(stamp.source, packageRoot);
    assert.deepEqual(stamp.hosts, ["claude", "shared"]);
    assert.match(spawnSync(process.execPath, [join(runtime, "bin/charthouse"), "--version"], { encoding: "utf8" }).stdout, /^charthouse \S+ \(.+, installed .+ from .+\)/);
    const doctorRun = spawnSync(process.execPath, [join(runtime, "bin/charthouse"), "doctor", "--root", sandbox, "--json"], { encoding: "utf8", env });
    assert.equal(doctorRun.status, 0, doctorRun.stderr);
    const doctor = JSON.parse(doctorRun.stdout);
    assert.equal(doctor.adapters.healthy, true);
    assert.equal(doctor.adapters.runtime.mode, "standalone-neutral");
    assert.equal(doctor.adapters.claude.skills.context.present, true);
    assert.equal(doctor.adapters.shared.skills.administration.present, true);
    const legacyStamp = { ...stamp };
    delete legacyStamp.hosts;
    delete legacyStamp.hooks;
    writeFileSync(join(runtime, ".install.json"), `${JSON.stringify(legacyStamp, null, 2)}\n`);
    rmSync(join(shared, "charthouse-context"), { recursive: true, force: true });
    const brokenDoctor = spawnSync(process.execPath, [join(runtime, "bin/charthouse"), "doctor", "--root", sandbox, "--json"], { encoding: "utf8", env });
    assert.equal(brokenDoctor.status, 1);
    const brokenAdapters = JSON.parse(brokenDoctor.stdout).adapters;
    assert.deepEqual(brokenAdapters.selected_hosts, ["claude", "shared"]);
    assert.equal(brokenAdapters.shared.healthy, false);

    const settingsPath = join(claude, "settings.json");
    writeFileSync(settingsPath, `${JSON.stringify({ model: "sonnet" })}\n`);
    const marker = join(runtime, "scripts/lib/git.mjs");
    writeFileSync(marker, "// stale installed copy\n");

    const update = spawnSync("sh", [join(packageRoot, "install.sh"), "--update"], { encoding: "utf8", env });
    assert.equal(update.status, 0, update.stderr);
    assert.equal(readFileSync(marker, "utf8"), readFileSync(join(packageRoot, "scripts/lib/git.mjs"), "utf8"));
    assert.equal(
      readFileSync(join(claude, "skills/charthouse/SKILL.md"), "utf8"),
      readFileSync(join(packageRoot, "skills/charthouse/SKILL.md"), "utf8")
    );
    assert.equal(
      readFileSync(join(shared, "charthouse/SKILL.md"), "utf8"),
      readFileSync(join(packageRoot, "skills/charthouse/SKILL.md"), "utf8")
    );
    for (const destination of [join(claude, "skills"), shared]) {
      assert.equal(
        readFileSync(join(destination, "charthouse-context/SKILL.md"), "utf8"),
        readFileSync(join(packageRoot, "skills/charthouse-context/SKILL.md"), "utf8")
      );
    }
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(settings.model, "sonnet");
    for (const event of ["SessionStart", "PostToolUse", "Stop"]) {
      const commands = settings.hooks[event].flatMap((group) => group.hooks.map((hook) => hook.command));
      assert.equal(commands.filter((command) => command.includes(`${runtime}/bin/charthouse`)).length, 1);
    }

    const bogus = spawnSync("sh", [join(packageRoot, "install.sh"), "--upgrade"], { encoding: "utf8", env });
    assert.notEqual(bogus.status, 0);

    // --yes answers the prompt without a terminal.
    writeFileSync(marker, "// stale again\n");
    const yes = spawnSync("sh", [join(packageRoot, "install.sh"), "--yes"], { encoding: "utf8", env, input: "" });
    assert.equal(yes.status, 0, yes.stdout + yes.stderr);
    assert.match(yes.stdout, /Updated Charthouse to/);
    assert.equal(readFileSync(marker, "utf8"), readFileSync(join(packageRoot, "scripts/lib/git.mjs"), "utf8"));
    const refreshed = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(refreshed.model, "sonnet");
    for (const event of ["SessionStart", "PostToolUse", "Stop"]) {
      const commands = refreshed.hooks[event].flatMap((group) => group.hooks.map((hook) => hook.command));
      assert.equal(commands.filter((command) => command.includes(`${runtime}/bin/charthouse`)).length, 1);
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("install.sh identifies a runtime copied from a dirty source checkout", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "charthouse-dirty-install-"));
  try {
    const source = join(sandbox, "source");
    cpSync(packageRoot, source, {
      recursive: true,
      filter(path) {
        const relative = path === packageRoot ? "" : path.slice(packageRoot.length + 1);
        return ![".git", "node_modules"].includes(relative.split("/")[0]);
      }
    });
    const git = (...args) => spawnSync("git", args, { cwd: source, encoding: "utf8" });
    assert.equal(git("init", "--quiet").status, 0);
    assert.equal(git("add", "-A").status, 0);
    assert.equal(git("-c", "user.name=Charthouse Test", "-c", "user.email=charthouse@test.local", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture").status, 0);
    const commit = git("rev-parse", "--short", "HEAD").stdout.trim();

    const home = join(sandbox, "home");
    const runtime = join(home, ".charthouse");
    const env = {
      ...process.env,
      HOME: home,
      CHARTHOUSE_HOME: runtime,
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      AGENT_SKILLS_DIR: join(home, ".agents/skills")
    };
    const cleanInstall = spawnSync("sh", [join(source, "install.sh"), "--no-hooks"], { encoding: "utf8", env });
    assert.equal(cleanInstall.status, 0, cleanInstall.stdout + cleanInstall.stderr);
    const cleanStamp = JSON.parse(readFileSync(join(runtime, ".install.json"), "utf8"));
    assert.equal(cleanStamp.commit, commit);
    assert.equal(cleanStamp.dirty, false);
    assert.doesNotMatch(cleanInstall.stdout, new RegExp(`${commit}-dirty`));

    const readme = join(source, "README.md");
    writeFileSync(readme, `${readFileSync(readme, "utf8")}\nDirty development edit.\n`);
    const dirtyInstall = spawnSync("sh", [join(source, "install.sh"), "--update", "--no-hooks"], { encoding: "utf8", env });
    assert.equal(dirtyInstall.status, 0, dirtyInstall.stdout + dirtyInstall.stderr);
    assert.match(dirtyInstall.stdout, new RegExp(`${commit}-dirty`));
    const dirtyStamp = JSON.parse(readFileSync(join(runtime, ".install.json"), "utf8"));
    assert.equal(dirtyStamp.commit, commit);
    assert.equal(dirtyStamp.dirty, true);

    const version = spawnSync(process.execPath, [join(runtime, "bin/charthouse"), "--version"], { encoding: "utf8" });
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, new RegExp(`\\(${commit}-dirty, installed`));
    const doctor = spawnSync(process.execPath, [join(runtime, "bin/charthouse"), "doctor", "--root", home, "--json"], { encoding: "utf8", env });
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).install.dirty, true);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("install.sh host profiles install only the requested adapters", () => {
  for (const target of ["claude", "shared"]) {
    const sandbox = mkdtempSync(join(tmpdir(), `charthouse-${target}-`));
    try {
      const runtime = join(sandbox, ".charthouse");
      const claude = join(sandbox, ".claude");
      const shared = join(sandbox, ".agents/skills");
      const env = { ...process.env, HOME: sandbox, CHARTHOUSE_HOME: runtime, CLAUDE_CONFIG_DIR: claude, AGENT_SKILLS_DIR: shared };
      const result = spawnSync("sh", [join(packageRoot, "install.sh"), "--host", target, "--no-hooks"], { encoding: "utf8", env });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(join(runtime, ".install.json"), "utf8")).hosts, [target]);
      const requested = target === "claude" ? join(claude, "skills") : shared;
      const omitted = target === "claude" ? shared : join(claude, "skills");
      assert.match(readFileSync(join(requested, "charthouse/SKILL.md"), "utf8"), /name: charthouse/);
      assert.match(readFileSync(join(requested, "charthouse-context/SKILL.md"), "utf8"), /name: charthouse-context/);
      assert.throws(() => readFileSync(join(omitted, "charthouse/SKILL.md"), "utf8"));
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }
});

test("install.sh migrates the legacy Claude runtime to the neutral home", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "charthouse-legacy-"));
  try {
    const runtime = join(sandbox, ".charthouse");
    const claude = join(sandbox, ".claude");
    const legacy = join(claude, "charthouse");
    const env = { ...process.env, HOME: sandbox, CHARTHOUSE_HOME: runtime, CLAUDE_CONFIG_DIR: claude, AGENT_SKILLS_DIR: join(sandbox, ".agents/skills") };
    const first = spawnSync("sh", [join(packageRoot, "install.sh"), "--host", "claude", "--no-hooks"], { encoding: "utf8", env });
    assert.equal(first.status, 0, first.stdout + first.stderr);
    renameSync(runtime, legacy);

    const update = spawnSync("sh", [join(packageRoot, "install.sh"), "--update", "--host", "claude", "--no-hooks"], { encoding: "utf8", env });
    assert.equal(update.status, 0, update.stdout + update.stderr);
    assert.doesNotThrow(() => readFileSync(join(runtime, "package.json"), "utf8"));
    assert.throws(() => readFileSync(join(legacy, "package.json"), "utf8"));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("install.sh refuses a broad runtime target before changing it", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "charthouse-unsafe-home-"));
  try {
    const marker = join(sandbox, "keep.txt");
    writeFileSync(marker, "keep\n");
    const env = { ...process.env, HOME: sandbox, CHARTHOUSE_HOME: sandbox, CLAUDE_CONFIG_DIR: join(sandbox, ".claude"), AGENT_SKILLS_DIR: join(sandbox, ".agents/skills") };
    const result = spawnSync("sh", [join(packageRoot, "install.sh"), "--no-hooks"], { encoding: "utf8", env });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsafe CHARTHOUSE_HOME/);
    assert.equal(readFileSync(marker, "utf8"), "keep\n");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("doctor accepts Claude hooks from a custom neutral runtime path", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "charthouse-custom-runtime-"));
  try {
    const runtime = join(sandbox, "runtime");
    const env = { ...process.env, HOME: sandbox, CHARTHOUSE_HOME: runtime, CLAUDE_CONFIG_DIR: join(sandbox, ".claude"), AGENT_SKILLS_DIR: join(sandbox, ".agents/skills") };
    const install = spawnSync("sh", [join(packageRoot, "install.sh"), "--host", "claude"], { encoding: "utf8", env });
    assert.equal(install.status, 0, install.stdout + install.stderr);
    const diagnosis = spawnSync(process.execPath, [join(runtime, "bin/charthouse"), "doctor", "--root", sandbox, "--json"], { encoding: "utf8", env });
    assert.equal(diagnosis.status, 0, diagnosis.stderr);
    const adapters = JSON.parse(diagnosis.stdout).adapters;
    assert.equal(adapters.runtime.mode, "standalone-neutral");
    assert.equal(adapters.claude.hooks.current, true);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("the version has one source and the release sync keeps the manifest and changelog in step", async () => {
  const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(packageRoot, ".claude-plugin/plugin.json"), "utf8"));
  assert.equal(manifest.version, pkg.version, "run node scripts/sync-version.mjs");
  const { CHARTHOUSE_VERSION } = await import(join(packageRoot, "scripts/lib/constants.mjs"));
  assert.equal(CHARTHOUSE_VERSION, pkg.version);
  assert.match(readFileSync(join(packageRoot, "CHANGELOG.md"), "utf8"), /^## Unreleased$/m);

  const { syncVersion } = await import(join(packageRoot, "scripts/sync-version.mjs"));
  const result = syncVersion({
    version: "0.2.0",
    manifest: JSON.stringify({ name: "x", version: "0.1.0" }),
    changelog: "# Changelog\n\n## Unreleased\n\n- A change.\n\n## 0.1.0\n\n- First.\n",
    date: "2026-09-15"
  });
  assert.equal(JSON.parse(result.manifest).version, "0.2.0");
  assert.equal(result.changelog, "# Changelog\n\n## Unreleased\n\n## 0.2.0 (2026-09-15)\n\n- A change.\n\n## 0.1.0\n\n- First.\n");
  // A release with nothing recorded is refused, and a re-run is a no-op.
  assert.throws(() => syncVersion({ version: "0.3.0", manifest: "{}", changelog: "# Changelog\n\n## Unreleased\n\n## 0.2.0\n" }), /is empty/);
  const again = syncVersion({ version: "0.2.0", manifest: result.manifest, changelog: result.changelog, date: "2026-09-16" });
  assert.equal(again.changelog, result.changelog);
});
