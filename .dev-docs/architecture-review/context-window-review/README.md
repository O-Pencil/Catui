# Context window continuity

Status: implementation approved by the user's request for a default, configuration-free experience.

## Decision and ownership

Add a default `extensions/builtin/context-management/` feature providing bounded branch-history retrieval, versioned working notes, context-budget hints, and a model-requested window handoff. No new user setting, dependency, timer, network call, or long-term memory store is required. This is an intentional GB-2 default behavior change.

The extension owns policy and tools. `core/runtime/context-window-controller.ts` owns committing a handoff at a model-request boundary. The private agent library gains an optional committed-context preparation hook, separate from transient extension context transforms, used by both loop frameworks. SessionManager remains the sole persistence owner. Existing compaction entries represent checkpoints, with a `context-window` detail marker and a model-authored handoff instead of a separate summary-model call. Old readers continue to reconstruct these checkpoints. No new session identity or protocol package type is introduced.

Existing compaction remains the automatic overflow/threshold fallback when a model does not request a handoff. Task budgets, permissions, queued messages, and model configuration are not reset by a window change. Notes are branch-local custom session entries, not NanoMem facts.

## Acceptance

- Default registry and source/distribution discovery require no configuration.
- Handoffs preserve complete tool call/result groups and commit only after persistence catches up.
- Reopening, branching, repeated windows, abort, unknown usage, small windows, and failed persistence retain safe behavior.
- History is bounded, paginated, branch-scoped, and identifies original entries; historical instructions are data.
- Notes survive restart and follow the selected branch.
- No summary-model call is added by the feature. Tool schemas and small runtime hints add prompt cost; history results and notes have explicit bounds.
- Run targeted tests, the five repository gates, package distribution validation, and PR self-review. Keep unrelated work outside the feature commit.

See [findings/CW01-boundaries.md](findings/CW01-boundaries.md) and [closure.md](closure.md).
