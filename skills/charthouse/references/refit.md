# Refit workflow

A Refit is an evidence-based repository restructuring proposal.

## Inputs

- Approved current-state Map
- Human-owned Charter
- Duplication findings
- Boundary violations
- Documentation contradictions
- Ownership gaps
- Build and deployment constraints

## Required proposal fields

- Problem
- Current location
- Proposed location
- Evidence
- Expected benefit
- Risk
- Compatibility requirement
- Migration sequence
- Verification method
- Affected Navigators
- Confidence

## Rules

- Do not describe current state as intended state.
- Do not propose a Refit against a template Charter. `charthouse refit` refuses; run `charthouse charter create` first.
- Do not call similar code duplicate behavior without checking differences.
- Do not move code during proposal generation.
- Prefer small vertical migrations.
- Keep each intermediate repository state buildable.
- Create a separate Voyage and human gate for implementation.
- Run a Map update after every approved structural migration.
