# Command reference

Use exact command names and aliases. Do not resolve partial names.

## Frequent commands

| Command | Alias | Behavior |
|---|---:|---|
| `check` | `c` | Run a read-only Bearing check. |
| `docs` | `d` | Show or check document state. |
| `help` | `h` | Show general or command-specific help. |
| `impact` | `i` | Find areas affected by a proposed change. |
| `knowledge` | `k` | Show, search, propose, verify, update, or retire knowledge. |
| `map` | `m` | Show, find, update, or verify the repository Map. |
| `next` | `n` | List findings and suggest next steps with commands. `suggest` is a synonym. |
| `pr` | `p` | Preview, update, or check pull-request context. |
| `run` | `r` | Create or manage a development Voyage and path lease. |
| `status` | `s` | Show initialization, Map, Expedition, knowledge, Voyage, and freshness state. |
| `where` | `w` | Find code, tests, documents, and knowledge for a concept. |

## Infrequent commands

| Command | Behavior |
|---|---|
| `brief` | Build bounded task context without creating a Voyage. |
| `charter` | Create, show, update, diff, or validate human intent. |
| `contribute` | Prepare a private upstream Charthouse suggestion or code pull request. |
| `doctor` | Validate installation, hooks, schemas, and scanners. |
| `expedition` | Inspect, resume, or checkpoint the first repository survey. |
| `init` | Ask for and pin the canonical branch, then run the first Expedition. |
| `navigator` | List, show, regenerate, or request specialist review. |
| `reconcile` | Refresh derived context when checkout evidence or `HEAD` changed; record local canonical movement. |
| `refit` | Show or propose repository restructuring. |
| `tool` | List, describe, or run a trusted read-only Toolbox operation. |
| `who` | Find the responsible Navigator for a path or capability. |
| `why` | Explain rationale for a path, symbol, or knowledge ID. |

## Help

```text
/charthouse help
/charthouse help <command>
/charthouse h <command>
/charthouse --help
/charthouse <command> --help
```

Help is read-only and works before initialization.

## Charter

```text
/charthouse charter create
/charthouse charter show
/charthouse charter update "<change>"
/charthouse charter diff
/charthouse charter validate
```

`create` and `update` produce a draft and visible diff. Apply only after user
approval. The Charter is human-owned.

`validate` reports the Charter state: `template`, `partial`, or `complete`. A
section that still holds its template prompt is not intent. `pr` and `refit`
refuse to run while the state is `template`. `run` reports the state and the
plan must say when no Charter constraint was checked.

## Map

```text
/charthouse map show
/charthouse map find <capability>
/charthouse map update
/charthouse map verify
```

`map update` performs an incremental scan. It does not change product code.

## Knowledge

```text
/charthouse knowledge show <id>
/charthouse knowledge search <text>
/charthouse knowledge propose
/charthouse knowledge update <id>
/charthouse knowledge verify <id>
/charthouse knowledge retire <id>
/charthouse knowledge history <id>
```

Mutation commands create proposals. Promote them only after context review.

## Queries

```text
/charthouse where "token validation"
/charthouse who packages/auth/token.ts
/charthouse why packages/auth/token.ts:rotateToken
/charthouse impact "change refresh-token format"
```

Queries are read-only.

`impact` and `brief` rank normalized exact lexical evidence instead of loose
substring matches. A Brief returns at most three responsible capabilities and
two explicit reviewers. It narrows likely paths to the strongest matches,
keeps every applicable Instruction Contract, and caps supporting documents and
proposed verification commands at eight each. The selected Navigator still
verifies semantic scope against code. Charthouse removes an npm script command when
the current package manifest proves that another selected command for that
package runs it. The host applies the same rule to additional checks that it
discovers. Every Brief also carries the mandatory pre-response gate from the
ambient workflow.

## Toolbox

```text
/charthouse tool list
/charthouse tool describe repository-files
/charthouse tool run repository-files --path "apps/**" --role source --json
/charthouse tool run dependency-graph --unit payments --json
/charthouse tool run documentation-index --status suspect --json
/charthouse tool run duplicate-analysis --path "packages/**" --json
/charthouse tool run survey-report-validate --role capability --file ".charthouse/drafts/<id>/surveys/capability.json" --json
/charthouse tool gaps
/charthouse tool gap list --status candidate
/charthouse tool gap show TG-0001
/charthouse tool gap export TG-0001
```

`list` and `describe` work before initialization. `run` requires an initialized
repository. Toolbox operations are read-only, bounded, and implemented in the
Charthouse Node.js runtime.

`expedition accept-report` runs `survey-report-validate` between each first-run
mapper and Map synthesis, then records the valid digest in the Expedition
transaction. An invalid, stale, incomplete, oversized, overwritten, or
role-mismatched report, or one that cites excluded evidence, exits with
failure. See `survey-reports.md` for the stable contract.

Tool Gap commands maintain `.charthouse/tool-gaps.json`. `record` deduplicates one
reporter within one Voyage or Expedition. Exactly one context is required. A
gap becomes a candidate after three observations across at least two Voyages;
one Expedition cannot promote its own reports. `--checked` can repeat or use a
comma-separated list. `export` is read-only and redacted. `dismiss` and
`resolve` record a human decision. See `toolbox.md` for the complete recording
contract.

## Navigator

```text
/charthouse navigator list
/charthouse navigator show <name>
/charthouse navigator regenerate <name>
/charthouse navigator review <change>
```

Generated Navigators are views of the approved Map. They are not independent
knowledge stores. Claude Code sessions discover them from `.claude/agents/`.
Compatible agents discover the portable views from `.agents/skills/`. In
Claude, run `/agents` to list them. In any host, use `who`, `impact`, or `brief`
to select the relevant Navigator. Restart a session that caches definitions
when Charthouse generated or changed the files.

## Pull request

```text
/charthouse pr preview
/charthouse pr update
/charthouse pr check
/charthouse pr reviewers
```

`preview` and `check` are read-only. `update` requires authorization for the
external write.

## Docs

```text
/charthouse docs status
/charthouse docs check
/charthouse docs review [id]
/charthouse docs confirm <id> --evidence <file>
```

`status`, `check`, and `review` are read-only. `review` builds one review
packet for each suspect document. `confirm` records a review verdict of
`holds`. It refreshes the fingerprints of the document and records HEAD as the
verification commit. It refuses without an evidence file under
`docs/charthouse/chronicles/`. See `maintenance.md`, section "Document review".

`status` and `check` report Map publication separately from Bearing health.
`published_with_findings` means semantic capability boundaries are approved,
but the Bearing is blocked or needs review. Do not collapse these states into
one success or failure label.

## Contribute to Charthouse

```text
/charthouse contribute "<idea>"
/charthouse contribute list [--status candidate|dismissed|submitted]
/charthouse contribute show <MI-0001>
/charthouse contribute preview <MI-0001> --as <suggestion|pr>
/charthouse contribute dismiss <MI-0001> --reason "<reason>"
/charthouse contribute doctor [--clear-stale-lock]
```

Use the [Contribution](contribute.md) workflow. It can record a generalized
Charthouse limitation, prepare an exact GitHub suggestion, or prepare a code pull
request. Detection and preview are local. Any issue, branch, commit, push, or
pull-request creation requires explicit authorization.
`contribute doctor` reports the private candidate-log lock and clears it only
after Charthouse proves that its local owner process is gone.

## Other

```text
/charthouse init
charthouse init --canonical-ref <selected-branch>
/charthouse expedition status [E-0001]
/charthouse expedition resume [E-0001]
/charthouse expedition accept-report E-0001 --role <role> --file <assigned-path>
/charthouse next
/charthouse suggest
/charthouse status
/charthouse check
/charthouse brief "<objective>"
/charthouse reconcile [--force] [--dry-run]
/charthouse refit propose
/charthouse doctor
/charthouse run "<objective>"
/charthouse run status [V-0001]
/charthouse run activate V-0001 [--path <approved-path>]...
/charthouse run resume V-0001
/charthouse run finish V-0001
/charthouse run abandon V-0001 --reason "<reason>"
/charthouse doctor --clear-stale-lock
```

`reconcile --dry-run` reports pending reconciliation paths and triggers
without changing repository state. Use it when the user explicitly forbids
all repository writes.

Starting a Voyage creates a durable `planning` record under `.charthouse/voyages/`.
It owns no paths until the user approves the plan and Charthouse runs `activate`.
Activation atomically refuses overlap with any active Voyage. Only `finish` or
`abandon` closes the lease; abandonment requires a reason. `resume` records a
handoff without changing the lease.
