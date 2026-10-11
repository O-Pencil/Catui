# Local deployment context budgets

Status: reviewed; approved for implementation before source changes.

## Evidence and scope

FreeToken serving gpt-oss-20b reported 131072 context tokens in `/v1/models`,
but `/v1/cache/status` and its startup log showed only 8606 KV tokens. A fresh
Catui request with `hi` contained 23691 prompt tokens and overflowed. History
compaction cannot remove the fixed system prompt and tool catalog.

## Ownership decision (§2b)

This repairs existing model-discovery and request-budget primitives shared by
interactive, print, RPC and SDK sessions. `core/model/` owns optional deployment
metadata; `core/runtime/` owns request validation; `core/session/compaction/`
owns capacity-scaled compaction settings. No new extension behavior or commands,
protocol contracts, dependencies, or provider-specific branches in modes.

## Decision

- Identify FreeToken from its server-reported ownership, not model names or ports.
- Clamp advertised context to positive, safe KV pages × page size while serving.
  Optional API failure/loading/malformed data preserves standard discovery.
- Recheck the configured custom OpenAI endpoint at request boundaries, with a
  short session-local metadata cache. Apply limits in memory, never rewrite config.
- Use FreeToken's optional tokenizer endpoint for a fixed-prompt check. Do not
  reject requests from character estimates, truncate instructions, or drop tools.
  A fixed prompt that cannot fit receives actionable diagnostics before inference.
- Scale small-window compaction budgets without persisting settings; retain
  ordinary cloud defaults. Bound summary output to the model output maximum.
- Never repartition GPU memory, restart the server, or infer tool execution from text.

## Acceptance

Mock HTTP coverage for actual vs advertised capacity, authentication, API prefixes,
fallbacks, cancellation, refresh and model switches; request checks preserve context;
small/cloud compaction regression tests. Run the five repository gates and §6 PR
self-check. Live read-only capacity verification uses the existing local endpoint.

No public export removals; additional internal helpers and optional discovery metadata
are additive. Metadata/tokenizer calls add no generation calls; cache unchanged
fixed prompts and bound metadata timeouts. See findings/LC01-capacity.md.
