# AS05: Tool runtime needs one dispatch owner before S1 can hold

```yaml
finding_id: AS05
severity: load-bearing
lenses: [seam, leverage, locality]
files_primary:
  - core/runtime/agent-session.ts
  - core/runtime/tool-runtime-controller.ts
  - core/tools/orchestrator.ts
files_secondary:
  - core/runtime/default-tools.ts
  - core/mcp/
  - core/extensions-host/
status: selected
```

## Problem

Tool setup crosses built-in tools, extension tools, MCP tools, active tool names, wrapping, and runtime rebuilds. P4's S1 says `ToolOrchestrator` must be the only dispatch point, but that cannot hold if `AgentSession` keeps assembling tool sets directly.

The risk is a split where dispatch is nominally centralized but activation and wrapping rules remain scattered.

## Deletion Test

> If a future `ToolRuntimeController` were deleted, would complexity concentrate?

**Result**: concentrates if it owns activation/wrapping/refresh; vanishes if it only forwards to `ToolOrchestrator`.

The module is justified only if it owns the policy around tool availability and tool source integration.

## Proposed Direction

Create a tool runtime boundary only when it can own:

- base tool registry
- static custom tools
- extension registered tools
- MCP refresh tools
- active tool name changes
- wrapping through extension hooks
- rebuild of agent tool list

`ToolOrchestrator` remains the single dispatch primitive; the controller owns runtime policy around it.

## Decision

2026-06-01: first consolidated the live runtime registry into `ToolOrchestrator`, then introduced `ToolRuntimeController` for source merge, extension wrapping, active-name policy, and registry updates. `AgentSession` still owns extension lifecycle, MCP refresh, prompt application, and final `agent.setTools(...)` facade wiring.

## Benefits

- **Leverage**: S1 becomes enforceable by code shape, not just documentation.
- **Locality**: adding tool runtime categories no longer requires editing `AgentSession`.

## Before / After Sketch

```
BEFORE
AgentSession assembles tools -> ToolOrchestrator dispatches

AFTER
AgentSession facade -> ToolRuntimeController -> ToolOrchestrator
```

## Resolution

**Landed**: `2a28075` (consolidate tool registry) + `6f5ef64` (extract tool runtime controller) · 2026-05-31
**Owner**: `core/runtime/tool-runtime-controller.ts`
**Outcome**: `ToolRuntimeController` owns tool source merge, wrapping, active-name policy, and orchestrator registry updates (`replaceTools`/`setCustomTools`).
**S1 held**: the controller only updates the `ToolOrchestrator`; it adds no parallel dispatch path. `ToolOrchestrator` remains the single tool dispatch point.

## References

- Gate: `../gates.md` RS-3
- P4 S1: `../execution-plan/P4-runtime-split.md`
