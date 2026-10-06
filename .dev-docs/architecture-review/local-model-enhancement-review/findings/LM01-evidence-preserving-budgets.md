# LM01: Reduce model-visible payload without losing tool evidence

Status: design resolved.

Evidence: `core/tools/truncate.ts` defaults to 2000 lines/50 KiB; `agent-loop-tool-results.ts` enforces a separate aggregate character limit by truncating text. `context-management` already owns working notes, history retrieval, and handoff guidance. Its presence does not justify a second task-state implementation.

Decision: use the existing transient `context` hook, not `tool_result`, for previews. A `tool_result` rewrite would persist the reduced result and make disabling the feature unable to recover omitted evidence. Readback searches the active session branch, never sibling history or hidden reasoning. The extension cannot recover content already truncated upstream; documentation must make this limit explicit.

Invariants: preserve each result and its call ID, role, timestamp, status, details and non-text blocks; never manufacture success or execute text as a tool call. No background summarizer. A tiny budget still retains a complete recovery notice. Limits on body characters are distinguished from total request tokens and memory use.

Cache review: a rolling history-wide budget would re-truncate earlier results as new turns arrive, invalidating reusable prefixes. Use per-assistant-batch budgets instead and test append stability. The existing runtime remains responsible for the complete conversation window.

Risk: head/tail previews can omit the relevant middle. Mitigation: explicit omission notice, bounded offset-based readback, preserved source journal, and regression tests recovering a middle sentinel. Many tiny results or images can still exceed a context window; existing runtime compaction remains necessary.
