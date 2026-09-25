# Voyage workflow

A Voyage performs one approved development objective. It preserves useful
knowledge from the work.

## Before planning

1. Start with `charthouse run "<objective>"`. This creates a durable `planning`
   record, assigns the Voyage ID, and returns the plan path. It does not claim
   product-code paths.
2. Run a Bearing check. `charthouse run` compares HEAD with the user-selected
   canonical branch. An unpinned or invalid branch blocks the Voyage and cannot
   be overridden. For detached, behind, or diverged checkout state, update the
   branch before planning or pass `--allow-behind` and record the ref, commit,
   relationship, and decision in the plan.
3. Resolve relevant capabilities, paths, knowledge, and documents.
4. Report suspect binding knowledge before implementation.
5. Select one primary Navigator and all required reviewing Navigators.
6. Read the Charter sections that apply to the objective. When `charthouse run`
   reports a `template` or `partial` Charter, say so in the plan and do not
   invent a constraint.

## Plan gate

Create small tasks with:

- Responsible Navigator
- Required reviewers
- Path scope
- Relevant knowledge IDs
- Charter constraints
- Exact verification
- Expected documentation impact

Save the draft plan under `docs/charthouse/chronicles/<voyage-id>/plan.md`.
Record user changes and rejected plan options. Wait for approval.

After approval, run `charthouse run activate <voyage-id>`. When the approved scope
differs from the prediction, pass every approved scope with repeated `--path`
options. Do not implement before activation succeeds. Charthouse refuses a scope
that overlaps another active Voyage. Planning Voyages may overlap.
Activation, resume, and finish recheck the canonical relationship because
accepted history can move after planning. They do not fetch or modify Git.

## Execute and verify

For each task:

1. Ask the primary Navigator to scope the implementation. The host coding-agent
   session implements it because generated Navigators are read-only.
2. Capture concise decisions, failed attempts, constraints, and rejected
   alternatives in structured output.
3. Ask the primary Navigator and an independent verifier to inspect the code.
   The parent session runs the required checks and supplies the observed output.
4. Retry once when the verifier supplies a concrete correction.
5. Stop before dependent work when verification still fails.

If an agent reports a `tool_gap`, validate it and record it with the Voyage ID
and reporter name as specified in `toolbox.md`. The agent does not write the Log.

Executors must not commit, push, or deploy.

## Curate context

After code verification, launch `charthouse-context-curator` with:

- Approved plan and user gate changes
- Executor and verifier reports
- Actual diff and test evidence
- Current knowledge records
- Relevant Chronicle events

The curator stores most detail in Chronicle. It proposes active knowledge only
when the information is useful, not easily derived, evidenced, scoped, and
supplied with an invalidation condition.

Launch `charthouse-context-verifier` for every proposed active record. Promote
only records that pass.

## Finish

1. Run the document review for each document that the Voyage made suspect.
   See `maintenance.md`, section "Document review".
2. Update fingerprints.
3. Regenerate affected host rules, skills, and Navigators.
4. Run a Bearing check.
5. Create or update the Voyage Chronicle.
6. Run `charthouse run finish <voyage-id>` to close the path lease.
7. Report code, knowledge, document, Map, and Tool Gap changes.

If the Voyage stops without completion, run
`charthouse run abandon <voyage-id> --reason "<reason>"`. Never leave an active
lease behind. `resume <voyage-id>` records that another session continued an
open Voyage; it does not change or duplicate the lease.

Commit, push, deployment, and pull-request changes require user authorization.
