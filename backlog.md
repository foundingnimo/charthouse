# Charthouse backlog

This backlog records product improvements that are not complete. The order is
intentional. Finish the safety and handoff foundations before adding broad
automation.

Status values:

- `Now`: active work or the next implementation slice.
- `Next`: high-value work after the current safety layer.
- `Later`: useful work that depends on earlier foundations.

## Now

### Expedition dogfood follow-ups

- [ ] Make mapper isolation enforceable on hosts that ignore agent tool
  restrictions.
- [ ] Verify that a clean Expedition cannot reuse old generated Navigator names.
- [ ] Remove duplicated decision blocks from host-rendered command responses.
- [x] Re-run the large-monorepo Map gate with validated reports and compare its
  capability boundaries with the rejected draft.
- [x] Keep preliminary Navigators isolated from host discovery until a person
  approves and publishes their capability boundaries.
- [ ] Prevent mapper shell commands from writing repository files, or detect
  and reject every write before synthesis.
- [x] Add a resumable Expedition checkpoint after validated surveys so an
  interrupted gate does not repeat the expensive scan.
- [x] Stage synthesis output and human gate decisions in the Expedition
  transaction instead of applying them directly to canonical state. Record
  when synthesis starts and its inputs, and refuse stale surveys at synthesis.
- [x] Keep accepted survey reports valid before synthesis when a `map update`
  changes only file contents. Accepted reports are checked against the
  current Map structure, not its generation time or commit.
- [ ] Publish approved Expedition artifacts through a recoverable atomic
  publisher with a recorded completion receipt.

### Consistent multi-session reads

Goal: Let several coding-agent sessions use one repository without losing Charthouse
state or performing overlapping work by accident.

- [ ] Permit concurrent readers while keeping multi-file state reads consistent.
- [ ] Detect a changed Git baseline before a Voyage writes curated context.
- [ ] Define behavior for separate local users, Git worktrees, and remote hosts.

### Navigator coverage checks

- [ ] Find maintained paths with no Navigator.
- [ ] Find excessive or contradictory Navigator overlap.
- [ ] Flag broad descriptions, weak evidence, and unapproved boundaries.
- [ ] Surface these findings through `charthouse check` and `charthouse next`.

## Next

### Additional lifecycle adapters

- [ ] Add native lifecycle adapters for hosts that expose safe hook APIs.
- [ ] Keep task-boundary reconciliation as the portable fallback.
- [ ] Verify adapter behavior without changing canonical repository state.

### Rationale debriefs

Goal: Capture concise, verified decision context from coding agents after
material changes so future agents can understand why the implementation took
its current form without reading the original session.

- [ ] Define a provider-neutral debrief schema for the objective, observed
  changes, non-obvious decisions, supporting evidence, rejected alternatives,
  plan deviations, failed approaches, verification, unresolved risks, and
  possible knowledge or Tool Gap candidates.
- [ ] Derive changed paths, diff facts, and available check results
  deterministically. Keep an agent's explanations separate from facts that
  Charthouse independently verifies.
- [ ] Add an agent-facing `charthouse run debrief <voyage-id>` operation. Make it
  automatic at completion boundaries; do not require the human to invoke it.
- [ ] Ask only focused questions that the observed change cannot answer. Skip
  generated, formatting-only, and other mechanical changes unless they expose
  a decision, failure, or risk.
- [ ] Collect small reports from each participating specialist and let the
  coordinating agent merge them into one debrief. Record disagreement and
  unverified claims instead of inventing a consensus.
- [ ] Store the complete accepted debrief in the Voyage Chronicle. Propose
  active Knowledge only when the existing admission test and independent
  verification pass.
- [ ] Keep raw transcripts, hidden chain-of-thought, credentials, secrets,
  customer data, and unsupported retrospective explanations out of durable
  state.
- [ ] Prevent repeated Stop or task-boundary hooks from creating duplicate
  debriefs or trapping an agent in a completion loop.
- [ ] Feed verified debrief outcomes into `/charthouse why`, task Briefs, PR context,
  session handoffs, Map-learning metrics, and recurring Tool Gap detection.
- [ ] Define safe attribution for pre-existing dirty changes, concurrent
  sessions, worktrees, and material work performed without an active Voyage.

### Learn from completed Voyages

- [ ] Compare predicted impact with the files that changed.
- [ ] Record missed paths, unnecessary Navigator selections, and missing checks.
- [ ] Propose Map improvements from repeated misses.
- [ ] Require approval before changing a capability boundary.

### Continuous integration mode

- [ ] Add a non-interactive `charthouse check --ci` contract.
- [ ] Detect stale generated views, suspect binding documents, incomplete
  Navigator coverage, and Map drift.
- [ ] Produce concise annotations for pull-request systems.

### Session handoff packets

- [ ] Record the objective, Voyage ID, completed work, remaining work, changed
  paths, decisions, failed approaches, checks, and Navigators.
- [ ] Let another session resume without reading the original transcript.
- [ ] Keep raw transcripts and chain-of-thought out of durable state.

### Safer merge behavior

- [ ] Split frequently edited machine state where this reduces conflicts.
- [ ] Keep generated JSON deterministic and consistently ordered.
- [ ] Detect state generated from a different Git baseline.
- [ ] Regenerate derived files instead of asking a person to merge them.

### Evaluation fixtures

- [ ] Add awkward monorepos with duplicated code, misplaced documents, generated
  trees, ignored knowledge, and ambiguous ownership.
- [ ] Measure mapping accuracy, ticket-to-Navigator selection, stale-document
  detection, false positives, and context size.
- [ ] Turn each confirmed failure into a regression fixture.

### Expedition Tool Gap provenance

- [x] Let an Expedition stage structured Tool Gap observations before a Voyage
  exists.
- [ ] Use the approved Expedition Chronicle as provenance.
- [x] Preserve the existing cross-Voyage promotion threshold; one Expedition
  must not promote its own reported gaps.

### Shared findings and community voting

Goal: Let people share selected Charthouse findings so other Charthouse installations
can discover existing suggestions, add independent evidence, and vote on what
should be improved or built next.

- [ ] Define one shareable proposal envelope for repository findings, Charthouse
  improvement candidates, and Toolbox Tool Gap requests.
- [ ] Make publication opt-in for each repository and each proposal. Never
  upload a local finding, vote, or evidence without explicit authorization.
- [ ] Remove repository names, private origins, absolute paths, tickets, code,
  logs, credentials, secrets, customer data, and other identifying evidence
  before publication.
- [ ] Let a Charthouse installation query relevant published proposals and show
  existing suggestions before it creates a duplicate.
- [ ] Deduplicate equivalent proposals with stable public keys while preserving
  independent occurrence counts and version or host compatibility evidence.
- [ ] Support useful votes such as `needed`, `seen-again`, `not-relevant`, and
  `resolved`, with enough provenance to resist accidental vote inflation.
- [ ] Let shared demand promote recurring Tool Gaps into candidate Toolbox
  operations without installing or executing community code automatically.
- [ ] Keep local findings authoritative until a person chooses to share, merge,
  dismiss, withdraw, or mark a proposal resolved.
- [ ] Define moderation, abuse reporting, proposal ownership, withdrawal,
  retention, and deletion behavior before enabling public discovery.
- [ ] Evaluate a GitHub-backed registry first, then a provider-neutral service
  only if cross-host discovery and voting need more than GitHub can provide.

## Later

### Background service evaluation

- [ ] Evaluate a long-running watcher after task-boundary reconciliation has
  production evidence; it must not rescan continuously or race other writers.
- [ ] Add an MCP adapter only when it offers capability beyond the shared skill
  and CLI, and test it against the supported protocol versions.

### Map quality metrics

- [ ] Report coverage, approved and preliminary capabilities, unowned paths,
  overlap, low-confidence relationships, and stale context.
- [ ] Show the metrics in `charthouse status` without reducing architecture quality to
  one misleading score.

### Repository-specific verification catalog

- [ ] Let each Navigator declare the checks for its capability.
- [ ] Verify that each declared command still exists.
- [ ] Select the smallest sufficient check set from the actual change.
- [ ] Never claim that a check passed without observed output.

### Pull-request context

- [ ] Add responsible Navigators, Charter constraints, document state, and
  observed verification to the bounded pull-request block.
- [ ] Keep every external pull-request write behind explicit authorization.

## Completed

### Expedition transaction foundation

- [x] Give the first survey a durable Expedition ID, baseline, event log, and
  isolated draft root.
- [x] Checkpoint each accepted role report by digest and revalidate it on
  resume.
- [x] Report reusable and invalid survey roles through `expedition status`,
  `expedition resume`, normal status, and doctor.
- [x] Refuse Navigator regeneration while any capability remains preliminary.
- [x] Refuse Navigator regeneration while a survey checkpoint is invalid or
  changed, or when the publication rescan finds a new boundary.
- [x] Validate Expedition records against the complete published schema.
- [x] Keep preliminary Navigator briefs, Claude agents, path rules, and shared
  skills out of host discovery.

### Focused task briefing

- [x] Rank exact normalized capability evidence instead of loose substring
  matches.
- [x] Bound responsible capabilities and explicit review expansion.
- [x] Narrow likely paths, supporting documents, and proposed verification to
  the task while preserving all applicable Instruction Contracts.
- [x] Add a large-monorepo regression based on the direct-debit application and
  marketplace API dogfood task.

### Validated Expedition survey handoff

- [x] Define one stable report contract for structure, capability,
  documentation, and duplication surveys.
- [x] Add a read-only validator for JSON shape, role, baseline, paths, globs,
  confidence, Tool Gaps, report size, and deterministic coverage.
- [x] Give every top-level mapper an isolated report path and block synthesis
  until all four reports validate.
- [x] Prevent bundled survey agents and the synthesizer from nested delegation.
- [x] Keep pre-publication document discovery on the deterministic Map instead
  of the manifest-backed documentation index.
- [x] Tell capability mapping to ignore existing generated Navigator names.

### Ambient and provider-neutral operation

- [x] Split automatic `charthouse-context` behavior from explicit `charthouse`
  administration.
- [x] Initialize, reconcile, and brief through the ambient skill at task
  boundaries.
- [x] Keep Claude Code hooks, path rules, and specialist project agents.
- [x] Publish shared skills and repository Navigators for Codex, Grok, and
  compatible hosts.
- [x] Move standalone runtime files to `~/.charthouse`, add host profiles, and
  migrate the legacy Claude runtime.
- [x] Add adapter and repository-migration health to `charthouse doctor`.

### Upstream contribution loop

- [x] Keep Charthouse improvement candidates in private user state outside target
  repositories and the installed runtime.
- [x] Detect and deduplicate verified Charthouse limitations during ambient work.
- [x] Prepare sanitized GitHub suggestion and code pull-request previews.
- [x] Require explicit approval before any issue, branch, commit, push, or pull
  request is created.
- [x] Add a read-only reconciliation preview for explicit no-write requests.
- [x] Put a mandatory pre-response gate in every Brief and the ambient skill.

### Multi-session ownership foundation

- [x] Serialize complete state mutations with an owner-labelled local lock.
- [x] Cover initialization, Map regeneration, document confirmation, Tool Gap
  changes, and changed-path queue changes.
- [x] Add safe stale-lock recovery.
- [x] Give Voyages durable IDs, lifecycle records, path leases, and overlap
  refusal.
- [x] Ask for and pin one exact canonical Git branch during init, report its
  status, and guard document trust and Voyage lifecycle changes.

### Compact ticket briefing

- [x] Add `/charthouse brief "<ticket>"` with responsible and reviewing Navigators,
  likely paths, active knowledge, Charter constraints, dependencies, suspect
  documents, and exact verification.
- [x] Provide concise text and stable JSON output.
- [x] Keep ticket-provider integration outside the deterministic core.

### First-run safeguards

- [x] Scan ambiguous `vendor/` and `build/` directories by default.
- [x] Warn before semantic surveys when an agent instruction file exceeds the
  conservative host-context threshold.
- [x] Report Map publication independently from Bearing health.

### Instruction Contract monitoring

- [x] Discover common agent instruction formats with configurable patterns.
- [x] Record provider, directory scope, parent, precedence, and human ownership.
- [x] Register direct binding fingerprints that ordinary scan filters cannot
  disable.
- [x] Surface applicable contracts in Maps, status, doctor, and task briefs.
- [x] Report excessive size and exact duplication without rewriting the files.
- [x] Make changed or missing contracts block the Bearing check.

### Commit-aware reconciliation triggers

- [x] Trigger a full refresh when `HEAD` changes on a clean working tree.
- [x] Record local canonical-ref and canonical-commit movement without fetching
  or inspecting another branch.
- [x] Refresh through SessionStart and Stop after commits, branch switches, and
  fast-forwards.
- [x] Discover new Instruction Contracts after the checkout receives canonical
  changes.
