# Closure

Implemented default context continuity with no new user configuration:

- `session_history` retrieves original visible conversation text from the active branch with IDs and bounded pagination.
- `working_notes` persists versioned task notes in the existing session journal.
- `new_context` saves a handoff and queues a safe, same-session transition. Both loop frameworks commit it before the next provider request, after completed tool messages reach the journal.
- Existing compaction checkpoints provide backwards-compatible replay; historical records remain intact. Ineffective or oversized handoffs retain the current context. Existing automatic compaction remains the fallback.
- Message persistence precedes asynchronous extension hooks. Failed journal appends roll back the in-memory entry and leaf pointer.
- Plan mode permits session-local continuity tools without granting workspace mutation permissions.

## Validation

- 13 feature tests: default discovery, retrieval bounds, original evidence after compaction, hidden-reasoning exclusion, branch isolation, note revisions/reopening, unknown budgets, plan permissions, complete tool batches, failed persistence, repeated windows, both agent loops, and actual SDK/extension-host wiring.
- 28 existing plan/session/extension regression tests passed.
- 104 existing agent-core loop and Agent tests passed.
- Release-build regression passed; CLI version smoke passed.
- Five acceptance gates: `verify:dip`, `verify:quality`, `verify:package-boundary`, `build`, and `tsc --noEmit` passed. Distribution package-boundary verification passed as well.
- CI now runs both new feature suites on Node 20 and 22.

## PR self-review

P1/P2/P3 maps updated. New feature policy belongs to the default extension; shared context commitment belongs to runtime/session and the private agent engine. No reverse runtime import from the new extension, new npm dependency, protocol package change, settings migration, or removed public export. Additive optional extension-host and private-loop capabilities are intentional. Existing user work is excluded from the feature PR.

Prompt cost is explicitly non-neutral: the three model-facing tool schemas/descriptions serialize to 1968 characters and default guidance to 539 characters, plus one small transient budget hint per model request. Exact token counts depend on the provider. No additional model call is made to generate a handoff summary. Retrieval and note payloads are bounded.

## Limits and reopen conditions

This is a hybrid default, not a claim that all models reliably initiate handoffs. Automatic compaction protects models that ignore the tools or whose requested handoff cannot fit safely. Historical retrieval exposes text and tool-call arguments, not image payloads or hidden reasoning. Pending in-memory requests are cancelled on abort; saved notes survive restart. Persistence inherits the existing JSONL journal's filesystem durability guarantees.

Live-provider task success, latency, and cost improvements have not been benchmarked. Reopen the design if evaluations show repetitive handoff requests, poor retrieval recall, or frequent fallback on small-context models. Do not remove automatic compaction based only on these offline tests.
