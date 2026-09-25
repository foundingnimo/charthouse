# Ambient operation

Charthouse is a sidecar for the host coding agent. Do not make the user translate a
normal repository request into Charthouse commands.

## Start of repository work

1. Find the repository root.
2. Resolve the Charthouse executable. Prefer `charthouse` on `PATH`, then a runtime that
   the host plugin supplies, `~/.charthouse/bin/charthouse`, or
   `~/.claude/charthouse/bin/charthouse`.
3. If `.charthouse/config.json` and `.charthouse/map.json` do not exist, list the local
   and remote-tracking branches without fetching. Ask the user which exact
   branch represents accepted history. Do not infer the answer from the
   current branch, `origin/HEAD`, `main`, or `master`. Then run
   `charthouse init --canonical-ref <selected-branch>` before substantial work.
   Initialization creates context files; it must not modify product code.
   If Charthouse is already initialized but reports `canonical-branch-unpinned`,
   ask the same question and update `.charthouse/config.json` after approval.
   Before semantic surveys, report the `instruction_contracts` count and any
   `instruction_file_warnings` from init. Explain that the host can truncate or
   reject an oversized instruction file. Do not block initialization and do
   not rewrite those human-owned files.
4. Run `charthouse reconcile --json`. This refreshes derived context when dirty
   evidence or `HEAD` changed. If only the locally available canonical branch
   changed and the checkout is behind, report it and ask the user to update the
   checkout. Evidence verified in the current checkout is still valid for that
   checkout. Say that it can differ from canonical history; do not call the
   current code stale unless repository evidence directly contradicts it. Do
   not fetch or inspect the other branch. Do not use `git show`, `git diff`,
   `git log`, or equivalent commands to inspect files, changes, or commit
   messages from the canonical ref. Use only the ref, commit, and relationship
   metadata that Charthouse reports. Verify code after the checkout moves to that
   history. Do not skip reconciliation because it writes Charthouse-owned derived
   state. That write is authorized ambient maintenance. A timestamp comparison,
   Git status check, or read-only Brief is not a substitute for reconciliation.
   If the user explicitly forbids all repository writes, run
   `charthouse reconcile --dry-run --json` instead. Use its pending paths and
   triggers, change no files, and do not say that reconciliation was skipped.
5. If `charthouse status --json` reports a draft Map and an open Expedition, run
   `charthouse expedition resume --json` and continue the Expedition workflow
   before substantial product work. Reuse accepted survey roles and run only
   the returned `next_roles` again. Do not load or publish preliminary
   Navigators.
6. Run `charthouse brief "<objective>" --json`.
7. Read only the returned Navigator sources or use the matching generated
   repository skills. Read the Charter, every returned Instruction Contract,
   and active knowledge. Treat the selected paths, supporting documents, and
   checks as the ranked, bounded starting set.

Do not show routine command output unless it changes the answer, finds stale
context, or needs a human decision. Do not report that `brief` wrote nothing,
describe file-timestamp checks, or narrate a successful no-op reconciliation.

## Work depth and delegation

For orientation, ownership, affected-path, or other read-only briefing
requests, read the selected Navigator sources directly. Verify only the claims
needed to answer the request. Do not launch a Navigator agent merely because
the Brief returned it.

If current evidence shows that the user's premise already holds, or the request
has two materially different interpretations, stop after the concise evidence
and one focused decision question. Do not produce paths, risks, checks, or an
implementation plan for an assumed interpretation unless the user explicitly
asked for a contingent plan. Build the detailed brief after the user confirms
the intended change.

Delegate to the smallest relevant Navigator set only when the user asks for a
deep investigation or review, implementation planning needs independent
cross-capability evidence, or bounded direct checks leave a material ambiguity.
Do not expand into an audit, Refit, or backlog of adjacent problems unless the
user asks. Mention an incidental finding only when it blocks the requested
work, creates a safety risk, or changes the immediate decision.

Do not present model memory, host or auto-memory files, saved session notes, an
earlier conversation, or a previous session's observation as repository
evidence. This includes notes attributed to the user but not supplied in the
current request. Use them only to choose what to verify. Omit them from the
answer unless current code, tests, the current request, or approved active
Charthouse knowledge confirms them.

When delegation is necessary, collect the relevant results before giving the
substantive answer. Reconcile disagreements and return one final set of paths,
risks, and checks. Do not stream provisional recommendations that later agent
results correct.

## Mandatory pre-response gate

Run this gate silently immediately before every substantive answer. Do not
send the answer until every applicable item passes. If one item fails, revise
the draft and run the gate again.

1. Classify the answer as a decision gate when verified evidence shows that
   the user's premise already holds, or when two materially different
   interpretations remain. Do not use this classification when the user asked
   for detailed evidence or a contingent implementation plan.
2. For a decision gate, keep only:
   - one concise verified conclusion;
   - one freshness caveat, only when it materially limits the conclusion; and
   - exactly one focused decision question.
3. For a decision gate, remove ownership and specialist lists, path
   inventories, risks, verification checks, speculative implementation,
   adjacent findings, and routine write or command bookkeeping. Use only the
   smallest evidence reference needed to support the conclusion.
4. For every answer, remove content that does not change the answer or the
   user's immediate decision. Do not say that no files changed, that a Brief
   wrote nothing, or that a no-op reconciliation ran.
5. Check whether the work exposed a verified Charthouse limitation. Follow the
   contribution workflow after the current task, without weakening a required
   decision gate.

## During and after work

- Treat a brief as a ranked, bounded starting point. Do not load every Map
  capability as a precaution. A selected Navigator must verify semantic scope
  against code and expand the set only when code evidence requires it.
- Follow active Voyage path leases. Do not start overlapping implementation.
- Run the exact checks named by the relevant Navigator when they still exist.
- Before presenting checks, inspect the relevant package scripts. Remove a
  command when another selected command runs it. For example, do not list
  `type-check` or `lint` separately when the selected `test` script runs both.
  Claim this coverage only from the current package manifest.
- At the end of a material change, run `charthouse reconcile --json` again. Report
  suspect documents, boundary conflicts, and required decisions.

## Improve Charthouse itself

If current evidence exposes a Charthouse defect, repeated workaround, missing
reusable operation, avoidable time or context cost, host-adapter problem, or
safety conflict, read [Contribution](contribute.md). Finish the current task
first unless the problem blocks it. Record one generalized candidate in the
private contribution log. Offer to prepare a GitHub suggestion or code pull
request only when the candidate is new.

Do not record an ordinary target-repository problem as a Charthouse improvement.
Do not put repository names, absolute paths, tickets, product code, raw logs,
credentials, secrets, or customer data in a candidate.

## Autonomy boundary

Charthouse can update machine state, the generated Map, generated Navigator views,
and freshness findings without asking the user. It can propose changes to the
Charter, curated knowledge, capability boundaries, repository structure, and
pull-request text. It must not apply those proposals without approval. It must
not move product code, commit, push, deploy, or write to an external service
without explicit authorization.

## Host adapters

- `charthouse-context` is the automatic skill. `charthouse` is reserved for explicit
  administration.
- Claude Code uses those skills, lifecycle hooks, path rules, and generated
  project agents in `.claude/agents/`.
- Agents that implement the common `SKILL.md` convention can discover
  `charthouse-context`, explicit `charthouse`, and generated Navigators through shared
  skill directories.
- The canonical state does not depend on either adapter. It remains in
  `.charthouse/` and `docs/charthouse/`.
