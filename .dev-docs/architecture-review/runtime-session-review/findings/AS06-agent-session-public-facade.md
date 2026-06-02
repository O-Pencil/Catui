# AS06: `AgentSession` must remain the public facade while internals split

```yaml
finding_id: AS06
severity: load-bearing
lenses: [DIP, leverage, locality]
files_primary:
  - core/runtime/agent-session.ts
  - index.ts
  - core/index.ts
files_secondary:
  - modes/interactive/interactive-mode.ts
  - modes/rpc/rpc-mode.ts
  - modes/acp/acp-mode.ts
  - modes/print-mode.ts
status: selected
```

## Problem

Splitting `AgentSession` can accidentally leak internal controllers to modes or package exports. That would reduce `agent-session.ts` line count while increasing global coupling.

The facade is load-bearing: modes, SDK, extensions, and sub-agent runtime rely on a stable session object.

## Deletion Test

> If `AgentSession` facade were deleted, would complexity concentrate?

**Result**: dramatically concentrates.

Every mode would need to assemble runtime collaborators directly. That is the opposite of the P4 goal.

## Proposed Direction

Keep `AgentSession` as the public facade:

- external callers continue using `AgentSession` methods
- controller types remain internal unless explicitly re-exported for API compatibility
- mode-layer imports must not target `core/runtime/*-controller.ts`
- root and core barrels should not expose controllers by default

If an internal type such as `CycleModelError` is already externally used, re-export it from `agent-session.ts` rather than requiring mode callers to import controller internals.

## Decision

2026-06-01: keep `AgentSession` as the public facade. Modes, sub-agent runtime, package barrels, and SDK creation continue to depend on `AgentSession` / `createAgentSession`; `ModelController`, `ToolRuntimeController`, `CompactionController`, and `session-context` remain internal runtime collaborators and are not exported from `index.ts` or `core/index.ts`.

Validation notes:

- No mode imports `model-controller.ts`, `tool-runtime-controller.ts`, `compaction-controller.ts`, or `session-context.ts`.
- Runtime controllers do not import `agent-session.ts`.
- The unused `AgentSession.toolOrchestrator` getter was removed so the facade does not leak the internal dispatch primitive.

## Benefits

- **Leverage**: all modes benefit from internal decomposition without churn.
- **Locality**: runtime internals can change while public session API stays stable.
- **DIP**: P2/P3 docs can distinguish public facade from internal collaborators.

## Before / After Sketch

```
BAD
modes/* -> ModelController / ToolRuntimeController / CompactionController

GOOD
modes/* -> AgentSession facade -> internal controllers
```

## Resolution

**Landed**: `6aaaed5` (close agent session facade review) · 2026-05-31
**Owner**: `core/runtime/agent-session.ts` (the facade itself)
**Outcome**: all public entry stays on `AgentSession` / `createAgentSession`. Controllers are internal collaborators — not exported through `core/index.ts` or the root barrel, and not imported by any mode.
**Verified continuously**: RS-4 checks (no mode imports a controller; no controller in public barrels) pass after every later slice.

## References

- Gate: `../gates.md` RS-4
- Parent finding: `../findings/F01-agent-session-god-module.md`
