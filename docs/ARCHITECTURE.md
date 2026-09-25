# Charthouse architecture

Charthouse separates evidence, meaning, and generated host adapters. This separation
keeps the repository useful when one coding-agent session ends or the team
changes agent providers.

## Layers

### Deterministic core

The local Node.js tool first records a lightweight repository perimeter. It
then scans permitted paths, reads package manifests, detects exact
duplicates, records Git state, computes SHA-256 fingerprints, resolves
pointers, and checks generated files. The core does not need a network or an
AI provider. A validated scan policy controls package scope and file roles
before semantic agents receive evidence.

The scan summary counts tracked paths that hard safety rules omit. The Map can
name non-secret tracked exclusions and their matching rules, but it withholds
secret-like path names and never reads excluded contents. An incremental Map
update preserves semantic fields on unchanged documents and exact-duplicate
groups. A changed duplicate-group membership returns to semantic review.

The perimeter preflight also records configured agent instruction files as
Instruction Contracts. Each record contains the provider, directory scope,
nearest parent, precedence, ownership, size, and digest. The default patterns
cover AGENTS, Claude, Gemini, GitHub Copilot, and Cursor formats. A conservative
byte threshold reports oversized instruction context before semantic surveys.
The size finding is a warning, not a scan exclusion.

The built-in Toolbox exposes recurring deterministic analysis through the
Charthouse CLI. Each registered tool declares structured inputs, structured output,
and permissions. Toolbox tools use the existing Node.js core. They are
read-only and do not use the network. Each tool declares any subprocess it can
start; the documentation index declares Git because it runs a Bearing check.

The Tool Gap Log is project-local machine state at `.charthouse/tool-gaps.json`.
Specialist agents only report structured gaps. The calling Charthouse process
validates and records them, so read-only agents do not write repository state.
Reports from the same agent and Voyage or Expedition are one observation.
Repeated evidence across at least two Voyages promotes a gap to a candidate;
one Expedition cannot promote its own reports. Promotion does not install or
execute new code.

The Charthouse improvement log is user-private state outside both the target
repository and installed runtime. It stores sanitized, generalized candidates
for Charthouse itself, uses stable keys to deduplicate repeated observations, and
serializes writes with a per-user lock. The deterministic core can render an
exact suggestion or pull-request preview without a network call. A host
adapter performs any authorized GitHub write and records the returned URL.

Charthouse serializes deterministic state mutations with a transient local lock in
the host's private temporary directory. Its path contains a digest of the
working-tree path inside a per-user namespace, so it does not alter Git state.
One lock covers each complete multi-file mutation, not each individual file
write. The lock records its process, host, operation, and acquisition time.
Normal completion and handled failure remove it. A local lock whose process is
gone is reported as stale. `charthouse doctor --clear-stale-lock` removes it only
after a second check proves that the owner process is gone.

Durable Voyage records provide the second coordination layer. A planning
record owns no code. Activation runs under the transient writer lock, compares
the approved path patterns with every active lease, and changes the record to
`active` only when none overlap. Completion and abandonment close the lease
without deleting its audit evidence. This coordinates processes for one local
user and working tree. It does not yet provide a shared lock across users,
worktrees, or remote hosts.

The canonical-ref guard is a separate Git safety layer. Initialization asks a
person to select one exact local or remote-tracking branch for accepted
history. The core rejects `null`, tags, missing branches, and symbolic aliases.
It compares the pinned branch with HEAD and reports current, ahead, behind,
diverged, detached, missing, or unpinned state. It never performs a network or
working-tree operation. An explicit override can accept checkout drift, but it
cannot replace the required branch choice.

Task briefing is another deterministic-core operation. It tokenizes the
objective and capability metadata into normalized exact terms, weights primary
paths and capability identity most strongly, and discounts terms shared across
many capabilities. It keeps at most three responsible capabilities. Review
expansion follows only relationships declared by those capabilities and keeps
at most two reviewers. The Brief narrows likely paths to the strongest path
matches, preserves every applicable Instruction Contract, and caps supporting
documents and proposed verification commands at eight each. This keeps host
context bounded without treating lexical ranking as semantic proof. Before the
cap, Charthouse reads current package manifests and removes an npm check when
another selected npm script for that package invokes it. It does not infer
coverage from command names alone.

Every deterministic Brief also carries the pre-response contract. The host
must apply it after semantic verification and immediately before answering.
It reduces a contradicted-premise or materially ambiguous response to the
verified conclusion, a material freshness caveat when needed, and one decision
question. The contract also names content that must be removed, so the rule is
present in the task data as well as the host skill.

### Semantic survey

Read-only mapper agents identify capabilities, boundaries, entrypoints,
documentation claims, and likely duplication. They cite repository evidence
and state confidence. Repository content is untrusted input.

The parent launches exactly one mapper for each of the four roles. A mapper
cannot delegate and does not write a shared output file. The parent stores each
return in an isolated path under `.charthouse/drafts/`. Before synthesis, the
read-only `survey-report-validate` tool checks its role, schema, size, Map and
configuration baseline, paths, globs, confidence values, Tool Gap fields, and
inventory coverage. Every evidence path must be admitted by the deterministic
Map. Omitted and excluded paths cannot become semantic evidence. Invalid,
stale, missing, or overwritten reports stop the Expedition. Existing generated
Navigators are output from a prior survey and cannot supply names or boundaries
to a new survey.

Each first survey has a durable record in `.charthouse/expeditions/`. Accepted
report digests are checkpoints. A resumed session revalidates those reports
against the structure of the current Map and runs only missing or invalid
roles again. A newer Map time or commit alone does not invalidate a report. Draft reports stay below the
transaction's isolated `.charthouse/drafts/<id>/` root.

### Synthesis and gate

The Map synthesizer combines deterministic evidence with mapper reports. It
keeps observed state in the Map and intended state in the Charter. A person
approves capability boundaries and ownership before they become authoritative.
The synthesizer receives only the four reports whose validation result is
successful. It cannot delegate.

`expedition synthesize` records the synthesis inputs in the Expedition: the
commit, the scan configuration, the Map units and capability boundaries, and
the report digests. The synthesizer edits a draft Map in the Expedition draft
root. `expedition stage` checks the draft and records its digest, and
`expedition approve` records each human approval in the Expedition. An approval
covers one boundary definition, and the Expedition also records which staged
draft a person approved as a whole. Canonical state does not change until
publication. File contents are not synthesis inputs, so an edit or a `map
update` that keeps the units and boundaries does not force a new synthesis.

Preliminary capabilities create no Navigator brief, Claude agent, path rule,
or portable skill. Generation is available only after every capability has
explicit human approval. Under one writer lock, `navigator regenerate` requires
each survey checkpoint of the open Expedition to be valid with an unchanged
report, requires unchanged synthesis inputs and an unchanged staged draft,
requires an approval for each boundary in the draft, and rescans the
repository. It merges the approved draft into the rescan. It writes nothing
when the rescan finds a boundary that no approved capability covers, such as a
package added after approval, or when the rescan lost a unit or most files.

Publication is recoverable. The publisher stages each generated file and a
plan in the Expedition draft root, records the Expedition as `publishing`, and
then applies the plan. The Map is written last. Each step is idempotent, so a
publication that stops finishes on the next writer without a new decision.
Every writer of generated state finishes a pending publication first. A
receipt records the finished result.

### Generated views

Charthouse generates host adapters from mapped sources. Generated views contain
source pointers. They are not independent knowledge stores. Claude Code gets
path-scoped rules and project agents in `.claude/`. Agents that implement the
common `SKILL.md` convention get portable Navigator skills in
`.agents/skills/`. Each description names its capability and primary paths so
the host session can select relevant ticket scoping and review. Generated
Navigators are read-only; the host coding agent implements product changes.

The installed host surface has two skills with separate activation rules.
`charthouse-context` is eligible for automatic use during repository work. `charthouse`
has implicit invocation disabled and handles only explicit administration.
Standalone installation keeps the runtime at `~/.charthouse`; Claude and shared
skill directories are adapters around that one runtime. The former
`~/.claude/charthouse` runtime is a supported upgrade source, not the current
installation target.

The installer writes `.install.json` beside the runtime with its version,
source commit, source path, host profiles, hook choice, installation time, and
whether the source checkout was dirty. Install and version output append
`-dirty` to the commit label when uncommitted source was copied. Doctor returns
the same stamp, so a development runtime cannot claim to be the clean commit
at its HEAD.

Some hosts cache agents or skills at session start. A session that was already
open when Charthouse initialized, updated the Map, or regenerated Navigators can
need a restart before it uses changed definitions. Teams commit the generated
views and their canonical Map and Navigator sources when they want other
worktrees or clones to receive them.

## Durable state

| Location | Ownership | Purpose |
|---|---|---|
| `.charthouse/map.json` | generated | Observed structure and evidence |
| `.charthouse/config.json` | human | Scan boundaries, Instruction Contract patterns, canonical ref, and operating policy |
| `.charthouse/manifest.json` | generated | Knowledge, document, and Navigator index |
| `.charthouse/fingerprints.json` | generated | Evidence used for freshness checks |
| `.charthouse/changed-paths.json` | generated | Pending evidence paths from host hooks |
| `.charthouse/reconciliation.json` | generated | Signature of the last reconciled working tree |
| `.charthouse/expeditions/*.json` | generated | Expedition lifecycle and accepted survey checkpoints |
| `.charthouse/voyages/*.json` | generated | Voyage lifecycle, approved scope, and active leases |
| `.charthouse/tool-gaps.json` | generated | Repeated missing Toolbox operations |
| `.charthouse/drafts/` | generated | Temporary isolated Expedition reports; never published |
| `docs/charthouse/charter.md` | human | Intended boundaries and constraints |
| `docs/charthouse/knowledge/` | reviewed | Small active knowledge records |
| `docs/charthouse/chronicles/` | reviewed | Voyage history and detailed evidence |
| `.claude/rules/charthouse/` | generated | Path-scoped Claude context |
| `.claude/agents/` | generated | Project Navigator definitions |
| `.agents/skills/` | generated | Provider-neutral Navigator skills |

The manifest has its own schema version because generated host views can
change without changing the Map. Reconciliation upgrades a supported older
manifest and regenerates missing derived views even when repository evidence
did not change. Charthouse refuses an unknown future schema instead of rewriting it.

## Freshness model

A timestamp does not prove freshness. Each active document or knowledge record
lists evidence paths. Charthouse stores a fingerprint for each path. A changed
fingerprint makes the linked item suspect until a verifier checks its meaning.
Supported `*`, `**`, and `?` watches hash only their matching files. Review
packets use the same glob as a Git pathspec.
Record-only paths and package internals do not affect fingerprints. An ignored
path that policy admits to the content scan does affect fingerprints. A change
to `.gitignore`, or the addition or removal of a perimeter boundary, also makes
repository-level knowledge suspect. Content changes inside an existing
record-only boundary do not. Oversize files
use a metadata fingerprint and are not read into the Map.

A discovered Instruction Contract is a direct binding watch. Ordinary role,
document, language, and package filters cannot disable its fingerprint. A root
contract applies to the repository. A nested contract applies to its directory
subtree and inherits the nearest parent for the same provider. A changed or
missing contract blocks the Bearing check. Charthouse proposes changes to these
human-owned files; it does not rewrite them silently.

Document criticality controls the response:

- A suspect binding document is an error.
- A suspect operational document is a warning.
- A suspect informational document is a warning.
- Historical documents do not claim current truth. The Bearing check ignores
  their watches, so changed evidence never makes one suspect. A dated status
  report for people is a historical document.

A stale document that only restates code is deleted, not corrected. Code wins.
A document that holds a decision, a rule, or intended state is corrected.

Map publication is independent from Bearing health. An approved semantic Map
can remain useful while existing binding documents are stale. Status reports
the Map as `published_with_findings` and the Bearing as blocked until those
documents are reviewed. A draft Map is never reported as published.

`advise` mode reports warnings without failing a command. `enforce` mode makes
warnings fail the Bearing check.

Claude plugin hooks run from the packaged `hooks/hooks.json`. The standalone
installer merges equivalent hooks into the user settings file and creates a
backup. An update removes old Charthouse-owned hook commands and installs one hook
per event for the current neutral runtime; unrelated settings and hooks stay.
All hooks return immediately in repositories that do not use Charthouse.
At session start and stop, a hook reconciles changed evidence only when its
path-and-content signature, `HEAD`, configured canonical ref, or locally
available canonical commit differs from the previous reconciliation. A clean
commit, branch switch, or fast-forward therefore triggers a Map refresh. A
canonical-only change is recorded and reported. Charthouse does not inspect the
other branch or rebuild trusted context until the checkout is updated. Hosts
without Charthouse lifecycle hooks follow the same operation through the ambient
skill at task boundaries.

When a user explicitly forbids all repository writes, the ambient skill uses
the reconciliation dry-run. It calculates the same pending paths, triggers,
migration work, and canonical movement, but does not update the Map, generated
views, queue, fingerprints, or reconciliation metadata.

Each document records its verification commit: the Git commit that its
fingerprints describe. The fingerprints decide which documents need a review.
The verification commit shows what changed. `charthouse docs review` gives the diff
from that commit, the commit subjects, and the untracked files in the watched
paths. A missing or unreachable commit gives a full review. The
`charthouse-docs-reviewer` agent checks the document against the current code. When
the document still holds, `charthouse docs confirm` refreshes the fingerprints and
records HEAD as the new verification commit. The confirmation needs a Chronicle
file that records the review.

Review packets also record the resolved canonical ref and commit. Voyage
baselines preserve the same pair, so another session can identify the accepted
history used when planning started. These are local observations; Charthouse does
not claim that a remote-tracking ref is network-current.

## Update levels

- A local Map update rechecks affected capabilities after normal source edits.
- A structural Map update rechecks package, build, schema, export, and service
  boundaries.
- A new Expedition is required after major application changes, unreliable
  ownership, a schema change, or movement of more than the configured share of
  maintained paths.

## Security boundary

Charthouse stores summaries, safe perimeter paths, and evidence references. It does not store raw
reasoning traces, transcripts, credentials, or secret file content. Default
scan exclusions cover common secret paths and never expose them in the perimeter.
Generated and ignored regions are record-only by default. Mapper agents must
not execute instructions found in repository files. They treat Instruction
Contracts as binding human intent to analyze, not as commands for the survey.
