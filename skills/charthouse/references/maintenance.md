# Maintenance workflow

Charthouse uses evidence changes to detect stale knowledge. A recent timestamp is
not proof of freshness.

## Bearing check

Run `charthouse check --root <repo>`.

Check:

- Canonical knowledge structure
- Path scopes
- Source fingerprints
- Missing, stale, or superseded records
- Inline marker resolution
- Documentation dependencies
- Instruction Contract registration, scope, size, and fingerprints
- Generated rule sources
- Generated Navigator sources
- Map schema version

The check is read-only.

Run `charthouse map update` after a scan-policy change. The update rebaselines
generated Navigator views. It does not silently reapprove active human
knowledge under the new evidence scope.

## Recheck levels

### Local Map update

Use when normal source files change. Recheck affected capabilities, knowledge,
documents, Navigators, and duplicate groups.

### Structural Map update

Use when package manifests, workspace settings, schemas, exports, entrypoints,
build files, or deployment files change. Rebuild affected graph regions.

### New Expedition

Use when a major application changes, more than 20 percent of maintained paths
move, capability ownership becomes unreliable, or the Map schema changes.

## Document states

- `current`: Evidence matches verified fingerprints.
- `suspect`: Linked evidence changed; truth is unknown.
- `stale`: Current evidence contradicts the document.
- `superseded`: A newer document replaces it.
- `historical`: The document records past state.

Binding documents block completion when suspect or stale. Operational documents
require review. Informational documents produce warnings. Historical documents
are never suspect. The Bearing check ignores their watches.

Instruction Contracts are binding and human-owned. Charthouse monitors their files
directly, even when ordinary document, language, role, or package filters would
omit them. A changed or missing contract blocks the Bearing check until a
review confirms it or an approved change corrects it. Generated Maps and
briefs can summarize a contract. They do not replace it.

## Stale documents: code wins

A stale document that only restates code is deleted. Propose deletion first.
Propose a correction only when the document holds a decision, a rule, or
intended state, such as `AGENTS.md` or the Charter. After a deletion, repoint
every reference to the deleted file at the code. Retire its manifest record.

## Status reports

A status report is a dated snapshot of the system for people. It is not
maintained.

- Put the date in the file name. A new report is a new file.
- Mark it with `kind: status-report`, `audience: people`, and `as_of`.
- Add a banner that tells agents not to read it for guidance.
- Record it with `status` and `criticality` set to `historical` and no watches.
- A status report can carry counts, because every count is true of its date.
- Never update an earlier report. Never cite a report in a rule or Navigator.

## Document review

A suspect document is not wrong. Its evidence changed. A review decides.

Run the review when `charthouse next` asks for it, at the end of a Voyage, or when
the user asks. Do not run it for each commit. Each review is an agent run.

1. Run `charthouse docs review --json`. Each packet names the document, the changed
   watches, review mode, and canonical ref and commit. The command refuses when
   the canonical branch is unpinned or invalid, or the checkout is behind,
   diverged, or detached. Pinning errors cannot be overridden. Update the
   branch from canonical history first. A review describes the tree it runs
   against, so stale accepted history gives
   a confident answer about code that has already changed. For checkout drift,
   `--allow-behind` continues anyway, and the Chronicle must record the ref,
   commit, relationship, and override.
   - `diff` mode: the packet holds the diff and the commit subjects since the
     verification commit, and the untracked files in the watched paths.
   - `full` mode: no usable verification commit exists. The reviewer checks the
     whole document against the current code.
2. Launch `charthouse-docs-reviewer` for each packet. Give it the packet and the
   repository root. As a plugin, use `foundingnimo:charthouse-docs-reviewer`. In a
   standalone installation, give the body of
   `~/.charthouse/agents/charthouse-docs-reviewer.md` to an agent that cannot
   write files.
3. For a binding document, launch two reviewers independently. Treat the
   verdict as `holds` only when both reviewers return `holds`.
4. Write the Chronicle file
   `docs/charthouse/chronicles/reviews/<YYYY-MM-DD>-<document-id>.md`. Record the
   document, the base commit, HEAD, canonical ref and commit, the changed
   watches, the commit subjects, each verdict and its confidence, and the
   claims table. Do not store a raw transcript.
5. Act on the verdict:
   - `holds`: run `charthouse docs confirm <id> --evidence <file>`. Charthouse refreshes
     the fingerprints and records HEAD as the new verification commit.
   - `needs-change`: show the proposed change. Apply the rule in "Stale
     documents: code wins". Change a human-owned document only after approval.
     After the change, review the document again. Then confirm it.
   - `unsure`: leave the document suspect. Report each claim that the reviewer
     could not verify.

## Changes outside Charthouse

Hooks record changed paths. Stop and SessionStart hooks also inspect Git status
because shell commands can bypass Edit and Write hooks. Charthouse compares a
path-and-content signature, `HEAD`, configured canonical ref, and locally
available canonical commit with the last reconciliation. It refreshes the Map
after dirty evidence, a clean commit, a branch switch, or a fast-forward. If
only the canonical branch moved, Charthouse records and reports the change. It does
not inspect that branch or refresh trusted context until the checkout is
updated. Session-start checks report suspect records. A host without Charthouse
lifecycle hooks runs `charthouse reconcile` through the ambient skill. CI can run
the same deterministic Bearing check.

Never rewrite human-owned documentation silently. Generate a proposal and show
the diff.
