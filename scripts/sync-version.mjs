#!/usr/bin/env node
// Runs from the npm `version` lifecycle after package.json is bumped and before
// npm commits and tags. It copies the version into the plugin manifest and
// turns the CHANGELOG "Unreleased" section into the release section.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const write = (path, text) => writeFileSync(resolve(root, path), text);

export function syncVersion({ version, manifest, changelog, date = new Date().toISOString().slice(0, 10) }) {
  const nextManifest = JSON.parse(manifest);
  nextManifest.version = version;
  const heading = `## ${version}`;
  let nextChangelog = changelog;
  if (!changelog.includes(`${heading}\n`) && !changelog.includes(`${heading} `)) {
    if (!/^## Unreleased[ \t]*$/m.test(changelog)) {
      throw new Error("CHANGELOG.md has no \"## Unreleased\" section to release. Add one with the changes for this version.");
    }
    const body = changelog.split(/^## Unreleased[ \t]*$/m)[1].split(/^## /m)[0].trim();
    if (!body) throw new Error("CHANGELOG.md \"## Unreleased\" is empty. Record the changes before you release.");
    nextChangelog = changelog.replace(/^## Unreleased[ \t]*$/m, `## Unreleased\n\n${heading} (${date})`);
  }
  return { manifest: `${JSON.stringify(nextManifest, null, 2)}\n`, changelog: nextChangelog };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = JSON.parse(read("package.json")).version;
  const result = syncVersion({ version, manifest: read(".claude-plugin/plugin.json"), changelog: read("CHANGELOG.md") });
  write(".claude-plugin/plugin.json", result.manifest);
  write("CHANGELOG.md", result.changelog);
  process.stdout.write(`Synchronised version ${version} into .claude-plugin/plugin.json and CHANGELOG.md.\n`);
}
