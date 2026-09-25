# Charthouse commands

Charthouse normally runs through an ambient agent skill. Use these commands for
diagnostics, automation, or explicit control. Claude Code exposes `/charthouse`
after standalone installation and `/foundingnimo:charthouse` when the repository is
loaded as a plugin. Other hosts can call the `charthouse` CLI.

## Frequent commands

| Command | Alias | Purpose |
|---|---:|---|
| `check` | `c` | Run a read-only Bearing check. |
| `docs` | `d` | Inspect document state. |
| `help` | `h` | Show command help. |
| `impact` | `i` | Find likely change impact. |
| `knowledge` | `k` | Inspect or maintain Logbook records. |
| `map` | `m` | Inspect or update the Map. |
| `next` | `n` | List findings and suggest next steps. |
| `pr` | `p` | Create bounded pull-request context. |
| `run` | `r` | Create or manage a Voyage and its path lease. |
| `status` | `s` | Show Charthouse state, including the Expedition and open Voyages. |
| `where` | `w` | Find code and context for a concept. |

The higher-frequency command gets the first-letter alias. Infrequent commands
do not reserve letters. This rule leaves letters available for future frequent
commands.

## Infrequent commands

`brief`, `charter`, `contribute`, `doctor`, `expedition`, `init`, `navigator`,
`reconcile`, `refit`, `tool`, `who`, and `why` have no one-letter alias.

## Examples

```text
/charthouse init
/charthouse expedition status
/charthouse brief "change token rotation" --json
/charthouse reconcile --json
/charthouse contribute "Reconciliation needs a read-only preview."
/charthouse c
/charthouse docs review
/charthouse m find authentication
/charthouse w "token rotation"
/charthouse who packages/auth/src/token.ts
/charthouse why K-0004
/charthouse i "change the refresh-token format"
/charthouse k search "atomic rotation"
/charthouse p preview
/charthouse charter update "The API package must not import the web app."
/charthouse refit propose
/charthouse tool list
/charthouse tool run dependency-graph --unit payments --json
/charthouse tool gap list --status candidate
/charthouse r "change token rotation"
/charthouse r activate V-0001
/charthouse r status
/charthouse h knowledge
```

Use exact names or listed aliases. Charthouse does not infer partial commands.
Add `--root <path>` to target a repository explicitly. Add `--json` to
deterministic query, status, and check commands when another tool consumes the
result.

Mutation commands that need semantic judgment create a proposal. The skill
shows the proposed diff before it changes a human-owned document. Pull-request
updates, commits, pushes, deployments, and product-code moves require explicit
authorization.

## Ambient operations

```text
charthouse reconcile [--force] [--dry-run] [--json]
charthouse brief "<objective>" [--json]
```

`reconcile` compares queued changes, the current Git path-and-content
signature, `HEAD`, the configured canonical ref, and its local commit with the
previous reconciliation. It regenerates derived context when checkout evidence
changed. A canonical-only change is reported without inspecting that branch.
`--force` performs the refresh even without a detected change. `--dry-run`
reports the paths, triggers, migration work, and canonical movement that would
be handled, but changes no repository file or reconciliation metadata.
`brief` is read-only. It ranks normalized exact terms across capability
identities, purposes, evidence, and paths. It returns at most three responsible
capabilities and two explicit reviewing Navigators. Likely paths use the best
matching primary paths instead of every path owned by a selected capability.
The result includes the Charter, applicable knowledge and Instruction
Contracts, dependencies, active Voyage conflicts, up to eight supporting
documents, and up to eight proposed verification commands. Applicable
Instruction Contracts are not dropped to meet a context-size cap.
Every Brief includes the mandatory pre-response gate that the host must run
after semantic verification and immediately before it answers.
For npm workspaces, redundant script commands are removed when the current
package manifest proves that another selected script invokes them. For
example, separate `type-check` and `lint` commands are omitted when `test`
already runs both.
Neither command edits product code or starts a Voyage.

## Contribute to Charthouse

```text
/charthouse contribute "<idea>"
/charthouse contribute list [--status candidate|dismissed|submitted]
/charthouse contribute show <MI-0001>
/charthouse contribute preview <MI-0001> --as <suggestion|pr>
/charthouse contribute dismiss <MI-0001> --reason "<reason>"
/charthouse contribute doctor [--clear-stale-lock]
```

The ambient skill can also detect a Charthouse limitation and offer to prepare it
as a GitHub suggestion or a code pull request. Candidates live in private user
state, not the target repository. Repeated observations use one stable
candidate. Only a newly created candidate prompts the user.

`preview` is local and shows the exact proposed title and body. Creating an
issue, branch, commit, push, or pull request still needs explicit approval. A
pull request is implemented in a Charthouse source checkout, never in the installed
runtime. See `skills/charthouse/references/contribute.md` for privacy and submission
rules.

`contribute doctor` reports the private candidate-log lock. It clears the lock
only when a second check proves that its local owner process is gone.

## Voyages and concurrent sessions

```text
/charthouse run "<objective>"
/charthouse run status [V-0001]
/charthouse run activate V-0001 [--path <approved-path>]... [--allow-behind]
/charthouse run resume V-0001 [--allow-behind]
/charthouse run finish V-0001 [--allow-behind]
/charthouse run abandon V-0001 --reason "<reason>"
/charthouse doctor --clear-stale-lock
```

Before the first Expedition, `/charthouse init` lists the available local and
remote-tracking branches and asks the user which exact branch represents
accepted history. The underlying command is:

```text
charthouse init --canonical-ref <selected-branch>
```

Charthouse does not infer this choice from the current branch, `origin/HEAD`,
`main`, or `master`.

The first initialization creates a durable Expedition transaction and returns
one isolated path for each survey role:

```text
/charthouse expedition status [E-0001]
/charthouse expedition accept-report E-0001 --role <role> --file <assigned-path>
/charthouse expedition resume [E-0001]
```

`accept-report` requires the exact assigned path and validates the role,
schema, repository baseline, coverage, and supported patterns before it writes
the checkpoint. Re-accepting an unchanged valid report is idempotent. `resume`
revalidates accepted report digests and returns the reusable roles and the
roles that must run again. Preliminary capability boundaries do not create
host-discoverable Navigators. `navigator regenerate` refuses until every
capability is human-approved and each survey checkpoint is valid with an
unchanged report. It rescans the repository before it writes and refuses when
the rescan finds a boundary that no approved capability covers. In that case,
run `map update`, review the new boundary, and approve it.
Successful regeneration records the current Expedition as published.

The deterministic init result lists discovered Instruction Contracts and any
contract above the configured size warning before mapper agents run. This
warning does not block initialization. `status` and `doctor` report contract
counts. `brief` includes the global and scoped contracts that apply to its
predicted paths.
`status`, `check`, and `doctor` report Map publication separately from Bearing
health. An approved Map with unresolved errors or warnings is
`published_with_findings`; its Bearing can still be blocked.

Starting a Voyage creates a durable `planning` record in `.charthouse/voyages/`
and returns its Chronicle plan path, predicted paths, and Navigators. It does
not reserve code paths. After the user approves the plan, `activate` claims the
predicted paths or the explicit `--path` values. Charthouse refuses overlap with an
active Voyage. Planning Voyages may overlap.

`resume` retrieves an open Voyage for another session without changing its
lease. Only `finish` and `abandon` close a lease. Closed records retain their
paths as history. `abandon` always requires a reason.

The repository stores the selected branch in `git.canonical_ref` in
`.charthouse/config.json`. `status` and `doctor` report the relationship. Document
review and confirmation and Voyage planning, activation, resumption, and
completion stop on an unpinned or invalid branch. That configuration failure
cannot be overridden. `--allow-behind` can explicitly accept a detached,
behind, or diverged checkout. Charthouse never fetches or changes the checkout.

`doctor --clear-stale-lock` removes a transient writer lock only when Charthouse can
prove that its recorded process is local and no longer exists. It refuses an
active, remote, or unreadable lock.

`doctor` also reports the runtime location, selected host profiles, both skill
adapters, Claude-hook currency, source revision and dirty-source state, and
repository migration status. A missing adapter that the install stamp selected
makes the command fail. A standalone runtime installed from uncommitted source
has `install.dirty: true`; version and installer output label its revision
`<commit>-dirty`.

## Toolbox

`tool list` and `tool describe <name>` expose the installed operations and
their runtime, permissions, input schema, and output schema. Discovery works
before Charthouse initializes a repository. `tool run <name>` requires an
initialized repository. The installed operations are read-only, network-free,
and bounded; inspect each operation's declared subprocesses before execution.

Validate each isolated first-run mapper report before synthesis:

```text
charthouse tool run survey-report-validate \
  --role <structure|capability|documentation|duplication> \
  --file .charthouse/drafts/<expedition-id>/surveys/<role>.json \
  --json
```

The command exits with failure for invalid JSON, the wrong role, a stale Map
or configuration baseline, unsupported paths or globs, invalid confidence or
Tool Gap fields, evidence that the Map omitted or excluded, an oversized
report, or incomplete deterministic coverage.
`tool describe survey-report-validate --json` names the installed schema and
roles. Synthesis requires four successful validations.

### Tool Gap Log

```text
/charthouse tool gaps
/charthouse tool gap list [--status observed|candidate|dismissed|resolved]
/charthouse tool gap show TG-0001
/charthouse tool gap record --key <slug> --need <need> --checked <tools|none> \
  --fallback <system-utility|temporary-script|manual> --summary <summary> \
  --input <shape> --output <shape> (--voyage <id> | --expedition <id>) \
  [--reporter <name>]
/charthouse tool gap export TG-0001
/charthouse tool gap dismiss TG-0001 --reason <reason>
/charthouse tool gap resolve TG-0001 --tool <registered-tool> [--version <version>]
```

The Log is `.charthouse/tool-gaps.json`. One reporter can add one observation per
Voyage or Expedition. Exactly one context is required. The Voyage or
Expedition record must exist. Repeat `--checked` or pass a comma-separated
list. Three observations across at least two Voyages
promote a gap from `observed` to `candidate`; one Expedition cannot promote its
own reports. Export prints a redacted proposal and does not use the network.
Resolve accepts only a registered installed tool. A report can reopen a
resolved gap only after it checks that tool and still needs a fallback.
