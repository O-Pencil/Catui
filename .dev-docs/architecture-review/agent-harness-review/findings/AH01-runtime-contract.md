# AH01 — One execution contract, three reliability features

## Finding

Tool authorization is currently split between SDK `canUseTool` and extension hooks;
plan mode consequently owns two predicates with different write semantics. Coarse
turn limits and transient UI approvals have no shared runtime state seam.

## Decision

Introduce one typed agent-core policy decision model and make both loop
implementations consume it. Compose SDK and extension policies at runtime. Build
livelock tracking and durable checkpoints on the same per-run state boundary rather
than embedding them in individual tools or modes.

## Compatibility

All new knobs are optional. Existing `canUseTool` and extension hooks are adapters.
SDK plan mode without an explicit plan path keeps its legacy markdown allowance for
the deprecation window; strict behavior is selected by `planFilePath`.

