# Changelog

## Unreleased

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
