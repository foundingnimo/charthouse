# Pull-request context workflow

Pull-request context is a bounded review aid. It is not a knowledge source.

## Commands

- `pr preview`: Generate context locally. Do not change the pull request.
- `pr update`: Replace the generated block after external-write authorization.
- `pr check`: Compare the block head marker with the current pull-request head.
- `pr reviewers`: List responsible Navigators and unresolved ownership.

## Source range

Generate context from the pull-request merge-base and head. Do not summarize the
full repository or an unrelated working tree.

Run a Bearing check before generation.

## Required block

Use these markers:

```text
<!-- CHARTHOUSE:START head=<commit> -->
<!-- CHARTHOUSE:END -->
```

Replace only content between markers. Preserve all human-authored pull-request
text outside the block.

Include only:

- Affected capabilities
- Primary Navigator and required reviews
- Important rationale
- Relevant active knowledge
- Charter constraints
- Architecture impact
- Documentation state
- Bearing-check result
- New or superseded knowledge
- Unresolved risks

Maximum 250 words. Use ASD-STE100 Simplified Technical English.

`charthouse pr` refuses to run while the Charter is a template, because the block
reports Charter constraints. Run `charthouse charter create` first.

Exclude raw transcripts, routine details, irrelevant history, full task logs,
secrets, hidden reasoning, and exhaustive file lists.

If the head commit changes, mark the previous block suspect until regeneration.
