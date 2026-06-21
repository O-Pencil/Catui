# EC01: Grub Diagnostics And Handoff

## Finding

`readFeatureList()` catches every read, parse, and schema error and returns
`null`. `GrubController.validateFeatureListAfterTurn()` therefore cannot tell
the agent where malformed JSON occurred. Terminal snapshots also omit the
remaining feature IDs at the iteration limit.

## Decision

Keep the existing nullable reader for callers that only need best-effort data.
Add a diagnostic reader for the controller, preserving the parse error and a
small line-numbered context window. Extend terminal formatting by reading the
durable feature list and reporting passing and pending entries.

## Non-goals

- Automatic rollback of user files
- Iteration budget renewal
- Interactive renewal prompts
- A new reset command

