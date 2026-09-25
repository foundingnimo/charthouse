# Contribute improvements to Charthouse

The contribution workflow turns an observed Charthouse limitation or a user's idea
into a sanitized GitHub suggestion or a code-bearing pull request. The local
candidate log is user-private state. It does not belong to the target
repository or the installed Charthouse runtime.

## Detect a candidate

Treat an observation as a Charthouse improvement candidate only when current
evidence shows a problem or opportunity in Charthouse itself:

- A Charthouse command, adapter, hook, policy, or generated view is wrong.
- Charthouse repeats a workaround or lacks a reusable operation.
- Charthouse uses unnecessary time, tokens, context, or delegation.
- A supported host or repository shape exposes a compatibility problem.
- A safety rule and a required Charthouse operation conflict.

Do not record ordinary product-code defects, repository architecture findings,
or a user's preference about the target project as Charthouse improvements.

After the current task is answered, record a concise, generalized candidate:

```text
charthouse contribute record --key <slug> --type <bug|enhancement> \
  --title "<generic title>" --observed "<verified Charthouse behavior>" \
  --expected "<desired Charthouse behavior>" --source <ambient|tool-gap|user> --json
```

Never include the target repository's name, absolute paths, tickets, product
code, raw logs, secrets, credentials, or customer details. Generalize the
evidence before recording it. The deterministic command rejects absolute paths
and common credential forms.

Offer a choice only when `outcome` is `created`:

```text
Charthouse improvement candidate MI-0001: <title>. Prepare a GitHub suggestion or a code PR?
```

Do not repeat the offer when the candidate was updated, dismissed, or already
submitted. Do not interrupt urgent product work unless the Charthouse problem blocks
it.

## User-started contribution

When the user runs `/charthouse contribute "<idea>"` or asks to improve Charthouse, infer
the smallest generic observed and expected behavior from the current evidence,
record it with source `user`, and show the candidate. Ask only for information
that materially changes the proposal.

## Prepare a suggestion

Run `charthouse contribute preview <id> --as suggestion --json`. Show the exact
title and body. Ask for authorization before the external write. After
approval, create an issue in `foundingnimo/charthouse` through an available GitHub
connector or authenticated `gh` CLI. Then record the returned URL:

```text
charthouse contribute submitted <id> --as suggestion --url <issue-url>
```

## Prepare a pull request

Run `charthouse contribute preview <id> --as pr --json`. Locate a Charthouse source
checkout from the standalone install stamp when possible. Verify that its
package is `@foundingnimo/charthouse`. Never edit `~/.charthouse` or another installed
runtime. If the source checkout is dirty or unavailable, ask before creating a
clean clone or worktree.

Implement the smallest change, add a regression test, and run `npm test` plus
`npm run validate`. Show the diff and the exact draft-PR title and body. Ask for
explicit authorization before commit, push, or GitHub creation. Prefer a draft
PR against `foundingnimo/charthouse`. After success, record its URL:

```text
charthouse contribute submitted <id> --as pr --url <pull-request-url>
```

If the change is not yet implementable, prepare a suggestion instead. A
suggestion can later become a PR.

## Other commands

```text
charthouse contribute list [--status candidate|dismissed|submitted]
charthouse contribute show <id>
charthouse contribute dismiss <id> --reason "<reason>"
charthouse contribute doctor [--clear-stale-lock]
```

Submission is never automatic. Local detection and preview do not authorize a
GitHub write.
