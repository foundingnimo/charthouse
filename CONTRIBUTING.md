# Contributing to Charthouse

Thank you for helping improve Charthouse. You can send an idea as a GitHub
suggestion or contribute a tested code change.

## Start through Charthouse

If Charthouse is installed, tell the agent what should improve or run:

```text
/charthouse contribute "<idea>"
```

Charthouse records a private, deduplicated candidate and offers two paths:

- **Suggestion:** prepare an issue title and body for `foundingnimo/charthouse`.
- **Code PR:** prepare the change, regression test, and draft pull request.

Charthouse shows the exact text or diff before it asks to create anything on
GitHub. It does not create an issue, branch, commit, push, or pull request
without explicit approval.

## Protect the target repository

Generalize the report. Do not include a target repository's name, absolute
paths, ticket identifiers, product code, raw logs, credentials, secrets,
customer details, or other private data. A minimal synthetic example is
better than copied project material.

Candidate records stay in private user state. They do not enter the target
repository or the installed runtime.

## Make a code change

Work in a source checkout of this repository. Do not edit `~/.charthouse` or
another installed runtime.

1. Start from the current default branch.
2. Make the smallest change that fixes the general Charthouse behavior.
3. Add or update a regression test.
4. Run:

   ```bash
   npm test
   npm run validate
   ```

5. Update the README, command reference, specification, or architecture when
   behavior changed.
6. Add a concise entry under `## Unreleased` in `CHANGELOG.md` for a
   user-visible change.
7. Open a draft pull request with the supplied template.

Do not commit generated target-repository Maps, Navigators, Chronicles, or
private contribution state to Charthouse.

## Release note

Maintainers release from `package.json` with `npm version patch`, `minor`, or
`major`. Contributors do not need to change the package version in a pull
request unless asked.
