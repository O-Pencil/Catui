# Runtime Reliability Review

Status: implemented; local acceptance passed; PR CI pending.

Scope: repair four reproduced failures in main at `a8c5a1f`: asynchronous event
ordering, discarded journal failures, tool-call transform composition, and npm
publication availability delays.

## Ownership decision (§2b)

These are existing capabilities, not new extension features. Session event state,
journaling and asynchronous notification ordering stay in `core/runtime/`.
Extension hook composition stays in `core/extensions-host/`. Publication receipt
state belongs to the optional evolution extension's delivery adapter and local
`SourceJob` contract. No package protocol or model-provider changes are required.

## Design

- Commit journal writes and assistant/retry state synchronously. An event write
  failure aborts the active agent, emits a session error, and is retained until
  the owning prompt rejects. Do not retry writes or continue a goal after a failed
  journal. Already-started tool effects cannot be rolled back.
- Deliver extension lifecycle notifications through a session-owned ordered
  queue, while emitting UI updates immediately. Capture the completed assistant
  at agent_end; run recovery only after preceding hooks settle. Keep the final
  extension agent_end notification detached, since it may start another prompt.
- Await queued processing at prompt boundaries and before session transitions.
  Cancellation suppresses pending recovery without awaiting its own calling hook.
  Keep the agent's synchronous subscriber contract intact.
- Each tool_call hook receives the prior hook's effective input. No-op results
  retain previous transforms, and the first block terminates the pipeline.
- Persist a publication-attempt receipt before upload and an acceptance receipt
  after success. A missing public version with a receipt is a pending state, not
  permission to upload again. Reconcile on later supervisor ticks; verify exact
  integrity before publishing a GitHub release or permitting adoption. Ambiguous
  failed uploads remain pending for owner investigation rather than duplication.

## Compatibility and cost

No new model requests, prompts, tools, dependencies or default-loaded extensions.
The session error source gains `session` for the existing sdk:error event.
Existing synchronous Agent subscribers remain synchronous. SourceJob receipt
fields are optional for old ledgers. Lifecycle notifications become ordered;
UI token rendering remains immediate. This does not provide filesystem fsync or
undo a tool that has already executed.

## Acceptance

Require real Agent event-dispatch regressions with deferred hooks and failing
journal writes, immediate UI updates, terminal failure without continuation,
multiple transform/no-op/block hooks through runner and SDK policy, and delayed
registry visibility across durable restarts. Include non-404 registry failures,
immutable integrity mismatch and ambiguous upload outcomes. Run the five feature
workflow gates, structure gate, focused regressions, agent-core tests and critical
harness lifecycle suites; complete the §6 PR self-check.
