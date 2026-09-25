# ASD-STE100 writing rules

Use ASD-STE100 Simplified Technical English for Charthouse notes.

Do not claim formal compliance unless a configured STE checker passes the
content. Charthouse version 0.1 enforces a practical subset and records approved
technical nouns.

## Required style

- Use one fact or instruction per sentence.
- Use active voice when possible.
- Use short sentences.
- Use one technical term for one concept.
- Give every pronoun a clear referent.
- Do not use idioms, jokes, marketing text, or rhetorical questions.
- Do not use an abbreviation before its definition.
- Keep code identifiers unchanged.
- Use words from the project vocabulary for domain-specific concepts.
- Use direct causal form: `Condition causes result.`

## Knowledge record headings

Use these headings when applicable:

```text
Decision
Reason
Constraint
Rejected alternative
Scope
Invalidation condition
Evidence
```

Do not invent content to fill an empty heading. Omit an unused heading.

## Limits

- Active generated rule: maximum 150 words.
- Pull-request context block: maximum 250 words.
- Navigator mission: maximum 40 words.
- One-line marker explanation: maximum 15 words.

## Technical vocabulary

Read `docs/charthouse/vocabulary.yml` when it exists. Add a technical noun only
when the project uses the term consistently. A vocabulary change requires the
same review as a knowledge change.

## Examples

Preferred:

```text
The worker writes the event to the shared queue.
The transaction prevents duplicate active jobs.
```

Avoid:

```text
The event is subsequently propagated through the relevant asynchronous
processing infrastructure.
```
