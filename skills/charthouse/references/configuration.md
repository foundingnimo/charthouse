# Scan configuration

Read `.charthouse/config.json` before an Expedition, Map update, or semantic survey.
Stop when the deterministic tool reports invalid configuration.

## Canonical Git ref

`git.canonical_ref` identifies accepted repository history. It must name one
exact local or remote-tracking branch, for example `origin/main`. During init,
list the available branches and ask the user which one is canonical. Do not
infer the answer from the current branch, `origin/HEAD`, `main`, or `master`.
`null`, a tag, a missing branch, and a symbolic alias are not configured.

Charthouse does not fetch or modify Git state. Treat its result as a comparison with
local Git knowledge. An unpinned, missing, non-branch, or symbolic ref blocks
trusted-state work and cannot be overridden. A behind, diverged, or detached
checkout can continue with `--allow-behind` only after a person or supervising
agent accepts the risk and records the override in the Chronicle.

## Package scope

Package selectors contain `names` and repository-relative `paths`. Exclude
selectors win over include selectors. An empty include selector includes every
package.

- `included`: Inspect the package and propose a Navigator.
- `stub`: Use only its name, root, manifests, and dependency edges.
- `omit`: Do not use the package or its edges.

Do not open a stub or omitted package to gain more context.

## Perimeter and Git-ignored paths

The inventory contains `perimeter_regions`. These are known boundaries, not
content evidence. Do not enumerate or open a region whose treatment is
`record` or `partial`.

Git-ignored content is `record` by default. Configure `scan.gitignored` with:

- `default`: `record` or `scan`.
- `include`: Permit selected ignored paths to enter the content scan.
- `exclude`: Keep selected ignored paths record-only and mark the decision as intentional.
- `hide`: Do not disclose selected paths in the Map.

Precedence is `hide`, `include`, `exclude`, then `default`. Hard safety
exclusions always win. An `include` only crosses the Git-ignored boundary. The
package, role, document, path, language, size, and symlink rules still apply.
Ask for a human decision when an ignored documentation or design region has
`review_required: true`.
The addition or removal of a perimeter region makes the Map suspect. A content
change inside an existing record-only region does not.

## File roles

Tests, fixtures, and generated files have one of these modes:

- `full`: Use the files in evidence and semantic analysis.
- `evidence`: Use the files only to verify or contradict a claim.
- `exclude`: Do not inspect the files.

An evidence file cannot define a capability. It cannot create a duplication or
Refit finding. A package override takes precedence over the global role mode.

## Instruction Contracts

`scan.instructions.patterns` identifies human-owned files that control agent
behaviour. The default patterns cover `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
`.cursorrules`, `.github/copilot-instructions.md`, and `.cursor/rules/**`.
Patterns replace the defaults. `size_warning_bytes` sets the conservative host
context warning threshold.

Charthouse records each discovered file as a binding Instruction Contract. A file
at the repository root has global scope. A nested file has directory scope and
inherits from the nearest parent contract for the same provider. The nearest
scope has precedence. Ordinary role, document, language, and package filters
do not disable the direct fingerprint of a discovered contract.

The files remain human-owned. Charthouse can report duplication, contradiction,
shadowing, excessive size, and stale factual claims. It must show a proposed
change and get approval before it edits an Instruction Contract.

Do not classify `vendor/` or `build/` as generated from the directory name
alone. Charthouse scans those names by default because they can hold product code,
documentation, or hand-written tools. A repository can add an exact generated
pattern after evidence confirms that the matching content is generated.

Document, path, and language filters apply after role selection. Structural
manifests remain available through a language filter. Do not read an oversize
file when its Map entry has `oversize: true`.

Symlink following is disabled by default. When it is enabled, use only the
in-repository paths emitted by the deterministic inventory. Do not follow a
link outside the repository or through an excluded target.
