# Knowledge workflow

Canonical knowledge lives in `docs/charthouse/knowledge/`. Generated host rules and
skills are delivery views, not independent sources.

## Admission test

Promote a candidate only when all answers are yes:

1. Will this information help future work?
2. Is the information difficult to derive from current code?
3. Does evidence support the claim?
4. Is the scope precise?
5. Does the record define when it can become invalid?
6. Does the record avoid secrets and raw reasoning?

Put failed candidates in Chronicle. Do not invent filler knowledge.

## Record lifecycle

Valid states:

- `draft`
- `active`
- `suspect`
- `stale`
- `superseded`
- `retired`

Use stable IDs in the form `K-0001`. Never reuse an ID.

## Inline markers

Default association comes from manifest scopes and path-scoped rules. Add an
inline marker only for a symbol-specific, counterintuitive, security, data,
compatibility, or cross-package constraint.

Use this language-neutral body inside the correct comment syntax:

```text
CHARTHOUSE[K-0001]: Keep token rotation atomic.
```

The explanation must remain useful without Charthouse. Maximum 15 words.

## Verification

The context verifier checks:

- Claim against code, tests, or human decision
- Scope against affected paths and symbols
- Conflict with active records
- Invalidation condition
- ASD-STE100 style
- Word limit
- Secret exposure
- Pointer resolution

## Mutation behavior

`show`, `search`, `history`, `who`, and `why` are read-only.

`propose`, `update`, and `retire` create drafts. Show the diff. Apply only after
approval and context verification.

Before an agent applies an approved knowledge mutation, inspect the canonical
relationship in `charthouse status --json`. An unpinned or invalid branch cannot be
overridden. Stop when the checkout is behind, diverged, or detached. Charthouse does
not fetch or modify Git. If the user deliberately accepts checkout drift,
record the canonical ref, commit, relationship, and approval in Chronicle
before writing.

After an approved mutation, regenerate the matching file under
`.claude/rules/charthouse/` and update `.charthouse/manifest.json`.
