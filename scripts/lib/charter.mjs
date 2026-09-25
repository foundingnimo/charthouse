import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PATHS } from "./constants.mjs";
import { exists, repoPath } from "./fs.mjs";

const TEMPLATE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../templates/charter.md");

export const REQUIRED_CHARTER_HEADINGS = [
  "# Charthouse Charter",
  "## Product purpose",
  "## Intended capability boundaries",
  "## Required architecture rules"
];

function sections(text) {
  const result = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^## (.+)$/);
    if (heading) {
      current = heading[1].trim();
      result.set(current, []);
      continue;
    }
    if (current) result.get(current).push(line);
  }
  return new Map([...result].map(([name, lines]) => [name, lines.join("\n").trim()]));
}

// A Charter is human intent. The template only carries prompts such as
// "Describe the product and its users." A section that still holds its prompt,
// or holds nothing, is not intent. The state tells every consumer whether the
// Charter can be compared against the Map.
export function charterState(root) {
  const path = repoPath(root, PATHS.charter);
  if (!exists(path)) return { state: "missing", path: PATHS.charter, template_sections: [], missing_headings: [...REQUIRED_CHARTER_HEADINGS] };
  const text = readFileSync(path, "utf8");
  const template = sections(readFileSync(TEMPLATE_PATH, "utf8"));
  const actual = sections(text);
  const templateSections = [];
  for (const [name, prompt] of template) {
    const body = actual.get(name);
    if (body === undefined) continue;
    if (body === "" || body === prompt) templateSections.push(name);
  }
  const missingHeadings = REQUIRED_CHARTER_HEADINGS.filter((heading) => !text.includes(heading));
  const filled = [...template.keys()].filter((name) => actual.has(name) && !templateSections.includes(name));
  const state = filled.length === 0 ? "template" : templateSections.length ? "partial" : "complete";
  return { state, path: PATHS.charter, template_sections: templateSections, missing_headings: missingHeadings };
}

export function charterMessage(charter) {
  if (charter.state === "missing") return `${charter.path} is missing. Run \`charthouse charter create\`.`;
  if (charter.state === "template") return `${charter.path} still holds the template prompts. Run \`charthouse charter create\`.`;
  if (charter.state === "partial") return `${charter.path} still holds template prompts in: ${charter.template_sections.join(", ")}. Run \`charthouse charter update\`.`;
  return null;
}

// Commands that compare intent with observation refuse to run against prompts.
export function requireCharter(root, purpose) {
  const charter = charterState(root);
  if (charter.state === "complete" || charter.state === "partial") return charter;
  throw new Error(`The Charter is ${charter.state === "missing" ? "missing" : "a template"}. ${purpose} compares the Map with human intent, so run \`charthouse charter create\` first.`);
}
