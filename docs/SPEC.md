# Charthouse specification

## Objective

Charthouse gives coding agents durable, scoped, and verifiable repository context.
It is optimized for monorepos where directory structure, code ownership,
documentation, and business capabilities can disagree.

## Terms

- An **Expedition** is the first full repository survey.
- A **Map** describes observed repository state.
- A **Charter** describes approved intent and boundaries.
- A **Navigator** is responsible for one approved capability or concern.
- A **Logbook record** is short, active, path-scoped knowledge.
- A **Voyage** is one planned and verified development objective.
- A **Bearing check** tests context freshness.
- A **Refit** proposes repository restructuring.
- A **Chronicle** stores detailed history that does not belong in active context.
- The **Toolbox** is Charthouse's registry of trusted reusable operations.
- A **Tool Gap** records a recurring operation that the Toolbox does not provide.
- A **Brief** is deterministic, bounded task context for a host coding agent.
- **Reconciliation** refreshes derived context after repository evidence changes.

A Brief ranks normalized exact lexical evidence from capability identities,
purposes, evidence, and paths. It selects at most three responsible
capabilities, then expands only explicit review relationships to at most two
reviewing Navigators. It reports the best matching primary paths, preserves all
Instruction Contracts applicable to those paths, and limits supporting
documents and proposed verification commands to eight each. Ranking is an
orientation aid. A Navigator must verify semantic scope against code before
implementation.

## Ambient operation requirements

The host agent invokes Charthouse as part of normal repository work. A person does
not need to translate a ticket into a Charthouse command. Before substantial work,
the agent initializes Charthouse when necessary, reconciles changed evidence, builds
a Brief for the objective, and reads the relevant Navigators, Charter, and
active knowledge. Routine success stays quiet. Conflicts, suspect context,
preliminary boundaries, and required approvals remain visible.

An orientation-only request reads the selected Navigator views directly and
uses bounded checks to verify the claims needed for the answer. It does not
automatically launch one specialist agent per selected Navigator. The host
delegates only when the user requests deeper investigation or review,
implementation planning benefits from independent cross-capability evidence,
or direct checks leave a material ambiguity. When it delegates, it collects
and reconciles the results before returning one substantive answer. Incidental
findings stay out unless they block the work, create a safety risk, or change
the immediate decision.

When current evidence contradicts the requested premise, or two materially
different interpretations remain, the host returns the concise evidence and
one decision question first. It does not spend context on paths, risks, checks,
or a plan for an assumed interpretation unless the user requested a contingent
plan. Detailed briefing resumes after the user confirms the intended change.

Every Brief carries a mandatory pre-response gate. The host runs it silently
immediately before each substantive answer and revises a failing draft before
it sends the answer. When the verified premise already holds or two materially
different interpretations remain, and the user did not request detailed
evidence or a contingent plan, the gate permits only one concise verified
conclusion, one material freshness caveat when needed, and exactly one focused
decision question. It rejects ownership or specialist lists, path inventories,
risks, verification checks, speculative implementation, adjacent findings,
and routine command or write-status narration.

For all other answers, the gate removes material that does not change the
answer or the immediate decision. Its final check asks whether verified
friction is a Charthouse improvement candidate. Contribution handling does not add
a second question to a response that needs a decision gate.

Ambient reconciliation is an authorized Charthouse-state write, including during a
read-only repository request. The host must not replace it with timestamps,
Git status, or a read-only Brief. Routine successful maintenance stays out of
the answer. The host reports only a changed conclusion, stale context,
conflict, failure, or required decision.

An explicit instruction to make no repository writes overrides ambient
maintenance. In that case the host runs the read-only reconciliation preview.
The preview reports pending paths, triggers, migration work, and local
canonical movement. It does not update the Map, generated views, change queue,
fingerprints, or reconciliation metadata. The host uses the preview when it
briefs the task and does not describe reconciliation as skipped.

When the checkout is behind canonical history, the host reports only Charthouse's
ref, commit, and relationship metadata. It must not inspect canonical files,
diffs, or commit messages with Git commands. Evidence remains valid for the
current checkout and is verified again after the checkout moves. Model memory,
host or auto-memory files, saved session notes, and previous-session
observations can guide verification, but they are not repository evidence.
Notes attributed to the user are not current user input. None appear in an
answer unless current evidence, the current request, or approved active Charthouse
knowledge confirms them.

Reconciliation can update machine state, the observed Map, generated
Navigator views, and freshness findings. It does not change product code or
human-owned intent. Changes to the Charter, curated knowledge, capability
boundaries, repository structure, pull requests, commits, pushes, or deploys
stay behind explicit human approval.

Charthouse can identify limitations in Charthouse itself. A candidate must describe a
Charthouse command, adapter, hook, policy, generated view, missing reusable
operation, avoidable execution cost, compatibility problem, or safety
conflict. An ordinary defect or architecture finding in the target repository
is not a Charthouse candidate.

Candidate records are private user state outside the target repository and
installed runtime. They contain generalized text only: no target-repository
names, absolute paths, tickets, product code, raw logs, credentials, secrets,
or customer data. A stable key deduplicates repeated observations. Charthouse offers
to prepare a suggestion or pull request only when it creates a new candidate.

A contribution preview is local and shows the exact proposed title and body.
Creating an issue, branch, commit, push, or pull request is an external change
and needs explicit authorization. Pull-request work uses a Charthouse source
checkout, never the installed runtime, and includes a regression test plus the
normal test and validation commands. Charthouse records the returned upstream URL
only after submission succeeds.

Canonical state is provider-neutral. A host adapter can add discovery, hooks,
or delegation behavior, but must not change the meaning of that state. Claude
Code uses `.claude/` views. Compatible agents use `.agents/skills/` views.

The installed skill identities must not overlap. `charthouse-context` is eligible
for automatic invocation during ordinary repository work. `charthouse` is eligible
only after an explicit user command. A standalone runtime lives outside any
provider directory. Host profiles install adapters without forking canonical
state or deterministic behavior.

Before a Brief returns proposed verification, it removes an npm script command
when another selected command for the same current package manifest invokes
that script. The host applies the same rule to checks it discovers directly.
It does not claim script coverage without current manifest evidence.

A supported older repository-state schema is upgraded by reconciliation before
normal freshness decisions. Migration regenerates derived views and preserves
human-owned intent and curated knowledge. An unreadable or future schema stops
automatic migration and requires a newer tool or manual recovery.

## Expedition requirements

1. Record the Git baseline and dirty-tree state.
2. Inventory source, tests, documents, manifests, and exact duplicates.
3. Record configured agent instruction files as scoped, human-owned Instruction
   Contracts. Report contracts above the conservative host-context threshold
   before semantic surveys. The warning does not block the scan.
4. Use independent read-only surveys for structure, capabilities, documents,
   and duplication.
5. Launch one top-level mapper for each role. Mapper agents must not delegate
   or write a shared report file. Existing generated Navigators must not prime
   a new survey.
6. Store each return in an isolated caller-owned file. Validate its role,
   schema, size, deterministic baseline, paths, glob syntax, confidence, Tool
   Gap shape, admitted Map evidence, and inventory coverage before synthesis.
   Record its digest in a durable Expedition checkpoint. A failure blocks
   synthesis.
7. Cite file or test evidence for semantic claims.
8. State confidence for inferred relationships.
9. Keep the Map separate from the Charter.
10. Show unresolved ownership and contradictory evidence.
11. Ask a person to approve semantic boundaries.
12. Generate scoped Navigators and rules from approved sources.
13. Do not expose preliminary Navigators through host agent or skill
    discovery. Refuse regeneration while any capability is unapproved, while
    a survey checkpoint of the open Expedition is invalid or its report
    changed, while the synthesis inputs or the staged draft changed, or when
    the publication rescan finds a new boundary.
14. Keep the draft Map and each boundary approval in the Expedition until
    publication. Do not change canonical state before publication. Stage the
    publication so that an interrupted one finishes without a new decision,
    and refuse a partial rescan.
15. Do not modify product code or add inline markers during initialization.

Survey reports use `schemas/survey-report.schema.json`. Their baseline contains
the deterministic Map commit, Map generation time, and configuration digest.
The validator also refuses repository evidence that changed after the Map was
created, or that the deterministic Map omitted or excluded. Before synthesis, the Expedition
transaction revalidates accepted reports on resume and identifies only the
survey roles that must run again. An accepted report is checked against the
structure of the current Map, not its generation time or commit. After synthesis starts, resume checks the
recorded synthesis inputs instead. Repository patterns can
use literal text, `*`, `**`, and `?`; brace
and character-class globs are not supported. The validator returns all
detected errors and uses a failing exit status for an invalid report. The
synthesizer accepts only four successful validation results and must not
delegate.

## Scan configuration

Charthouse reads `.charthouse/config.json` before an Expedition or Map update. The file
must match `schemas/config.schema.json`. Invalid configuration stops the scan.

`git.canonical_ref` names the exact local or remote-tracking branch that the
user selected as accepted repository history. Initialization must list
available branches, ask the user, and record the answer before scanning. It
must not infer the choice from the current branch, `origin/HEAD`, `main`, or
`master`. `null`, a tag, a missing branch, and a symbolic alias are errors.
Charthouse does not contact a remote, fetch, switch, merge, or rebase. Status
reports the branch, HEAD, canonical commit, dirty state, ahead/behind counts,
and relationship.

Package selectors use package names and repository-relative paths. An empty
include selector includes all packages. Exclude selectors take precedence over
include selectors. An excluded package is a boundary `stub` by default. A stub
retains its name, root, manifests, and visible dependency edges. Charthouse does not
index its internal files or create a Navigator for it. The `omit` behavior
removes the unit and its edges from the Map.

Tests, fixtures, and generated files use `full`, `evidence`, or `exclude` mode.
Evidence mode permits a file to support a claim. Evidence-mode files cannot
define a capability or create duplication and Refit findings. Package overrides
take precedence over the global role mode. A configured pattern array replaces
the default array.

The default generated patterns do not include `vendor/` or `build/`. Those
names are ambiguous across repositories. A repository can add exact patterns
after it verifies that the matching content is generated output.

`scan.instructions.patterns` identifies Instruction Contracts. The defaults
cover `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`,
`.github/copilot-instructions.md`, and `.cursor/rules/**`. A configured array
replaces the defaults. `scan.instructions.size_warning_bytes` sets the host
context warning threshold.

Each contract records its provider, directory scope, nearest parent for that
provider, nearest-scope precedence, human ownership, size, and digest. Charthouse
registers the file as a binding document that watches itself. Its direct
fingerprint is not disabled by ordinary role, document, language, or package
filters. A change or deletion blocks the Bearing check. Charthouse can propose a
split or correction. It must not edit a human-owned contract without approval.

Git-ignored paths use a separate policy. `record` is the default: Charthouse records
the region boundary but does not enumerate or read its contents. `scan` permits
content inspection, subject to all other scan policies. The `include` list
selects ignored paths for scanning. The `exclude` list keeps selected paths
record-only and resolves the scan decision. The `hide` list prevents path
disclosure. Precedence within this
policy is `hide`, `include`, `exclude`, then `default`. Non-configurable safety
exclusions always win.

Charthouse applies scan policy in this order:

1. A lightweight perimeter census identifies excluded and Git-ignored regions.
   It does not read record-only contents.
2. Non-configurable safety exclusions block Git data, Charthouse state, generated
   generated agent views, dependencies, common secret files, keys, and logs.
   The Map counts tracked exclusions and can list non-secret path names with
   the matching rule. It withholds secret-like path names and never reads
   excluded contents.
3. Git-ignored policy decides whether ignored content stays record-only or can
   enter the content scan.
4. Package include and exclude selectors set unit scope.
5. Package overrides and global role modes set file treatment.
6. Document selection, path exclusions, and language filters reduce the result.
7. Discovered Instruction Contracts receive direct binding fingerprints.
8. The maximum file size prevents content hashing and semantic inspection.

Structural manifests remain visible through a language filter. Symlink following
is off by default. When it is on, Charthouse follows only targets inside the repository.
A symlink cannot bypass a configured or safety exclusion. Charthouse marks files that
were reached through symlinks and excludes those aliases from duplicate analysis.

A perimeter-boundary, `.gitignore`, or scan-policy change makes repository-level
generated knowledge suspect. Content-only changes inside a record-only region do
not. A Map update updates fingerprints for generated Navigator views. Active
human knowledge keeps its previous verification baseline until a verifier checks
the new evidence scope. An update preserves semantic fields on unchanged Map
documents and exact-duplicate groups. Changed duplicate membership returns to
semantic review instead of inheriting the old assessment.

Reconciliation records the dirty-tree signature, `HEAD`, configured canonical
ref, and locally available canonical commit. A changed `HEAD` triggers a scan
even when the working tree is clean. A canonical-only change does not authorize
Charthouse to inspect another branch. Charthouse records and reports it, then scans after
the checkout moves to the new history. Charthouse never fetches.

## Knowledge requirements

An active record must be useful in later work, difficult to derive safely,
supported by evidence, limited to a path or symbol scope, and supplied with an
invalidation condition. A separate verifier approves it.

Use ASD-STE100 Simplified Technical English. Technical identifiers and
approved domain terms can remain unchanged. Do not store raw reasoning,
transcripts, secrets, temporary debugging details, or facts that a simple code
search can recover.

Each record has one of these states: `draft`, `active`, `suspect`, `stale`,
`superseded`, or `retired`. Detailed past work belongs in a Chronicle.

## Pointer requirements

The manifest is the default link between code and knowledge. Generated host
rules and skills load applicable context by path. An inline pointer is optional:

```text
CHARTHOUSE[K-0001]: Keep token rotation atomic.
```

Use an inline pointer only for security, data integrity, a counterintuitive
constraint, a required workaround, or a cross-package boundary. The pointer
must resolve to a manifest record. An Expedition can propose pointers but must
not add them to product files.

## Document review requirements

A suspect document is reviewed, not assumed wrong. Charthouse records the commit
that the fingerprints of each document describe. A review packet gives the
change since that commit. An agent verifies each affected claim against the
current code and cites evidence. A verdict of `holds` confirms the document and
needs a Chronicle record. A binding document needs two independent `holds`
verdicts. A proposed change to a human-owned document needs approval. A
historical document is never reviewed.

## Voyage requirements

Each Voyage has a durable ID and a machine record under `.charthouse/voyages/` that
matches `schemas/voyage.schema.json`. Its state is `planning`, `active`,
`completed`, or `abandoned`. Creation records the Git baseline, canonical ref
and commit, predicted path scope, Navigators, Chronicle plan path, and whether
the canonical-ref guard was overridden.

Voyage planning, activation, resumption, and completion refuse an unpinned,
missing, non-branch, or symbolic canonical ref. These states cannot be
overridden. Document review and confirmation use the same guard. A detached,
behind, or diverged checkout can continue with explicit `--allow-behind`; the
override is recorded for a Voyage. A local branch that is level with or ahead
of canonical history is allowed. The guard does not modify Git or prove that a
remote-tracking branch is current on the network.

Run a Bearing check before planning. Resolve the primary Navigator, review
Navigators, applicable Charter sections, and active records. The plan records
scope and exact verification. A planning Voyage has no lease and can overlap
other plans. After user approval, activation atomically claims the predicted
paths or explicit approved paths. An active Voyage must not overlap the path
scope of another active Voyage. Scope matching is conservative: an uncertain
glob overlap is an overlap.

Only `finish` or `abandon` closes a lease. Abandonment requires a reason. The
record retains its leased paths after closure as audit evidence. Charthouse does not
expire a lease by time. A session that continues an open Voyage records a
resume event.

An independent verifier checks implementation. The context curator proposes
durable knowledge only after code verification. Complete document review,
fingerprints, generated views, Bearing checks, and the Chronicle before marking
the Voyage complete.

## Tool Gap requirements

Tool Gap state lives in `.charthouse/tool-gaps.json` and must match
`schemas/tool-gaps.schema.json`. A specialist agent reports a structured gap
but does not write the Log. The calling Charthouse process validates and records it.
One reporter contributes at most one observation in one Voyage or Expedition.
Each observation names exactly one context. Three distinct observations across
at least two Voyages promote a gap to a candidate. Reports from one Expedition
cannot promote themselves.

A Tool Gap contains a need, input shape, output shape, checked registered tools,
and a short fallback description. It must not contain a raw script, command
output, secret, absolute path, or repository content. Export is local and
redacted. Charthouse does not submit an issue or install code automatically. A human
can dismiss a gap or resolve it with an installed registered tool.

## Pull-request context

Charthouse can generate one replaceable block of no more than 250 words. The
block uses `CHARTHOUSE:START` and `CHARTHOUSE:END` markers. It describes affected
capabilities, Navigators, rationale, Charter constraints, architecture effect,
documentation state, knowledge changes, and unresolved risk. Preview and check
are read-only. An external update requires authorization.

## Refit requirements

A Refit compares the Map with the Charter. It reports the evidence, proposed
moves, dependency effects, migration sequence, validation, and rollback. It
does not move code without approval. Findings must distinguish exact
duplication from similar code that has different semantics.

## Completion

A Charthouse operation reports its outcome, changed files, checked evidence,
suspect knowledge, and required human decisions. It must not claim success when
required verification fails. Map publication and Bearing health are separate.
An approved Map can be `published_with_findings` while the Bearing is blocked
or needs review. The operation must state both conditions.
