import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// package.json is the one place the version is written. `npm version` bumps it
// and scripts/sync-version.mjs copies it into the plugin manifest.
export const CHARTHOUSE_VERSION = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8")).version;
export const SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 2;
export const EXPEDITION_SCHEMA_VERSION = 1;
export const SURVEY_REPORT_ROLES = Object.freeze(["structure", "capability", "documentation", "duplication"]);
export const MAX_PERIMETER_REGIONS = 500;
export const INSTRUCTION_FILE_WARNING_BYTES = 150_000;

export const DEFAULT_INSTRUCTION_PATTERNS = Object.freeze([
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
  ".cursor/rules/**"
]);

export const PATHS = Object.freeze({
  state: ".charthouse",
  config: ".charthouse/config.json",
  map: ".charthouse/map.json",
  manifest: ".charthouse/manifest.json",
  fingerprints: ".charthouse/fingerprints.json",
  changes: ".charthouse/changed-paths.json",
  reconciliation: ".charthouse/reconciliation.json",
  toolGaps: ".charthouse/tool-gaps.json",
  expeditions: ".charthouse/expeditions",
  drafts: ".charthouse/drafts",
  voyages: ".charthouse/voyages",
  docs: "docs/charthouse",
  mapDocument: "docs/charthouse/map.md",
  charter: "docs/charthouse/charter.md",
  knowledge: "docs/charthouse/knowledge",
  navigators: "docs/charthouse/navigators",
  chronicles: "docs/charthouse/chronicles",
  artifacts: "docs/charthouse/artifacts",
  rules: ".claude/rules/charthouse",
  agents: ".claude/agents",
  agentSkills: ".agents/skills"
});

export const HARD_EXCLUDES = Object.freeze([
  ".git/**",
  ".charthouse/**",
  ".claude/**",
  ".agents/**",
  "docs/charthouse/**",
  "node_modules/**",
  ".venv/**",
  "venv/**",
  "__pycache__/**",
  ".env",
  ".env.*",
  ".envrc",
  ".npmrc",
  ".pypirc",
  "credentials.json",
  "secrets.json",
  "*.log",
  "*.pem",
  "*.key",
  "id_rsa*"
]);

export const DEFAULT_GENERATED_PATTERNS = Object.freeze([
  "dist/**",
  "**/dist/**",
  "coverage/**",
  "**/coverage/**",
  ".next/**",
  "**/.next/**",
  ".cache/**",
  "**/.cache/**",
  "*.min.js",
  "*.map"
]);

export const DEFAULT_TEST_PATTERNS = Object.freeze([
  "test/**",
  "tests/**",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*"
]);

export const DEFAULT_FIXTURE_PATTERNS = Object.freeze([
  "fixtures/**",
  "**/fixtures/**",
  "**/__fixtures__/**",
  "**/testdata/**",
  "**/__snapshots__/**"
]);

export const MANIFEST_FILES = new Map([
  ["package.json", "node"],
  ["pyproject.toml", "python"],
  ["Cargo.toml", "rust"],
  ["go.mod", "go"],
  ["pom.xml", "java"],
  ["build.gradle", "java"],
  ["build.gradle.kts", "kotlin"],
  ["Gemfile", "ruby"],
  ["composer.json", "php"],
  ["Package.swift", "swift"],
  ["*.csproj", "dotnet"]
]);

export const STRUCTURAL_NAMES = new Set([
  "package.json", "pnpm-workspace.yaml", "yarn.lock", "pnpm-lock.yaml",
  "package-lock.json", "turbo.json", "nx.json", "lerna.json", "tsconfig.json",
  "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle",
  "build.gradle.kts", "docker-compose.yml", "docker-compose.yaml", "Dockerfile"
]);

export const ALIASES = Object.freeze({
  c: "check",
  d: "docs",
  h: "help",
  i: "impact",
  k: "knowledge",
  m: "map",
  n: "next",
  p: "pr",
  r: "run",
  s: "status",
  w: "where",
  suggest: "next"
});

export const PUBLIC_COMMANDS = Object.freeze([
  "brief", "charter", "check", "contribute", "docs", "doctor", "expedition", "help", "impact", "init",
  "knowledge", "map", "navigator", "next", "pr", "reconcile", "refit", "run",
  "status", "tool", "where", "who", "why"
]);
