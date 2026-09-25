# Changelog

## Unreleased

## 0.2.0 (2026-09-25)

- `tool gap record` rejects a Voyage or Expedition id that does not exist.
- `./install.sh --uninstall` and `./install.ps1 -Uninstall` remove a sidecar
  installation. Repositories keep their Charthouse state.
- The installers no longer delete a folder at `CHARTHOUSE_HOME` or
  `~/.claude/charthouse` that is not a Charthouse runtime. They stop instead,
  or keep the legacy folder.
- The Map gate is staged in the Expedition. `expedition synthesize` records the
  synthesis inputs and refuses stale surveys. `expedition stage` checks the
  draft Map, and `expedition approve` records each boundary approval. Canonical
  state changes only when `navigator regenerate` publishes the approved draft.
- After synthesis starts, `expedition resume` checks the synthesis inputs
  instead of calling every survey stale after a `map update`, and publication
  refuses when those inputs changed.
- Before synthesis, an edit and a Stop-hook `reconcile` no longer make every
  accepted survey stale. An accepted report is checked against the structure
  of the current Map, not its generation time or commit. A new report must
  still match the current Map exactly.

## 0.1.0 (2026-09-25)

- First public release.
- Map a repository with a deterministic inventory scan and four isolated
  survey agents, then synthesize a current-state Map for human approval.
- Record each accepted survey as a durable Expedition checkpoint that an
  interrupted session can resume.
- Publish Navigators only after every capability boundary has human approval,
  each survey checkpoint is valid, and a publication rescan finds no new
  boundary.
- Keep a Charter, a Logbook of path-scoped knowledge, and Instruction
  Contracts, and detect stale context with pointer and fingerprint Bearing
  checks.
- Review a document when its watched evidence changes, and confirm it from a
  new commit.
- Coordinate agent sessions with Voyage records, path leases, and a project
  writer lock.
- Check canonical Git references before reviews and trusted-state changes.
- Give ranked, bounded task briefs, and reconcile context at session and task
  boundaries.
- Provide a read-only Node.js Toolbox and a Tool Gap Log for operations that
  the Toolbox does not have.
- Keep secret-like file names out of the Map, and reject excluded paths as
  survey evidence.
- Install as portable skills plus Claude Code agents, hooks, and path rules.
