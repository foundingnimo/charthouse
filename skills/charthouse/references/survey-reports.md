# Expedition survey reports

Each first-run survey returns one JSON object. The parent agent stores the
object in its own file and validates it before synthesis. A survey agent must
not delegate or write a shared report file.

## Common envelope

Every report contains:

- `schema_version`: `1`.
- `role`: `structure`, `capability`, `documentation`, or `duplication`.
- `baseline.commit`: `.charthouse/map.json` → `baseline.commit`.
- `baseline.config_digest`: `.charthouse/fingerprints.json` → `config_digest`.
- `baseline.map_generated_at`: `.charthouse/map.json` → `generated_at`.
- `summary`: one short summary.
- `findings`: semantic findings.
- `unresolved`: unresolved findings.
- `tool_gaps`: structured Tool Gap observations.

Each finding and unresolved item contains `kind`, `summary`, `evidence`, and a
`confidence` number from 0 to 1. Evidence contains exact repository-relative
paths admitted by the deterministic Map. An omitted, record-only, or excluded
path cannot support a claim. A Tool Gap uses the fields defined in the Toolbox
reference.

Use stable lowercase identifiers with hyphens. Exact paths must stay inside
the repository. Path patterns can use literal text, `*`, `**`, and `?`. Do not
use brace or character-class globs.

## Role payloads

The structure report contains `units`, `dependencies`, `entrypoints`, and
`tests`:

- A unit contains `id`, `name`, `root`, `purpose`, `evidence`, and
  `confidence`. It covers one deterministic Map unit ID.
- A dependency contains `from`, `to`, `kind`, `evidence`, and `confidence`.
- An entrypoint or test contains `path`, `unit`, `purpose`, `evidence`, and
  `confidence`.

The capability report contains `capabilities`. A capability contains `id`,
`name`, `purpose`, `units`, `primary_paths`, `secondary_paths`, `evidence`, and
`confidence`. The `units` arrays must assign every deterministic Map unit
exactly once.

The documentation report contains `documents` and `instruction_contracts`:

- A document contains `id`, `path`, `classification`, `criticality`, `claims`,
  `watches`, `evidence`, and `confidence`. It covers one path from
  `map.documents`, except a path recorded separately as an Instruction
  Contract.
- An Instruction Contract contains `id`, `path`, `providers`, `scope`,
  `parent`, `precedence`, `evidence`, and `confidence`. It preserves the stable
  identifiers from `map.instruction_contracts`.

The duplication report contains `duplicate_groups`. A group contains `kind`,
at least two `paths`, `evidence`, and `confidence`.

The schema is in `schemas/survey-report.schema.json`. The deterministic
validator performs the stricter repository-baseline and coverage checks.

## Handoff to synthesis

Use one caller-owned path for each top-level role. For example:

```text
.charthouse/drafts/<expedition-id>/surveys/structure.json
.charthouse/drafts/<expedition-id>/surveys/capability.json
.charthouse/drafts/<expedition-id>/surveys/documentation.json
.charthouse/drafts/<expedition-id>/surveys/duplication.json
```

Open the survey window immediately before the survey agent starts:

```text
charthouse expedition start-survey <expedition-id> --role capability --json
```

Accept the report into its Expedition checkpoint after the parent stores it:

```text
charthouse expedition accept-report <expedition-id> \
  --role capability \
  --file .charthouse/drafts/<expedition-id>/surveys/capability.json \
  --window <token> \
  --json
```

This command runs the deterministic validator and records the accepted digest.
`--window` takes the token that `start-survey` returned; keep it from the
survey agent. It rejects the report with `repository-written` when a product
file or HEAD changed while the survey ran, and with `window-changed` when the
window changed after it opened. It refuses a new report without a window.
An invalid result exits with failure and lists all detected problems. Ask only
the responsible survey agent to correct its return. Use `charthouse expedition
resume <expedition-id> --json` after interruption. Do not synthesize until all
four checkpoints are valid; `charthouse expedition synthesize` refuses until
then. Keep draft files out of publication and commits.
