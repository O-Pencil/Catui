# AS02: `ModelController` must be the only model/thinking side-effect owner

```yaml
finding_id: AS02
severity: load-bearing
lenses: [depth, locality, leverage]
files_primary:
  - core/runtime/model-controller.ts
  - core/runtime/agent-session.ts
files_secondary:
  - core/runtime/model-cycle.ts
  - core/runtime/thinking-levels.ts
  - core/model/switcher.ts
status: selected
```

## Problem

The current extraction correctly groups model and thinking operations, but it must avoid two failure modes:

- Leaving model restore or thinking restore side effects in `AgentSession`.
- Keeping a second model-switching authority such as old `ModelSwitcher` wiring alongside `ModelController`.

If both exist, future maintainers cannot know which path owns persistence, settings defaults, model-select events, or API-key validation.

## Deletion Test

> If `ModelController` were deleted after extraction, would complexity concentrate in callers, vanish, or stay roughly the same?

**Result**: concentrates.

The logic would return to `AgentSession`: API-key validation, scoped cycling, OAuth failure classification, thinking-level persistence, and `model_select` emission. This module hides real behavior and earns its existence.

## Proposed Direction

Make `ModelController` the single owner of:

- `setModel`
- `cycleModel`
- `restoreModel`
- `setThinkingLevel`
- `cycleThinkingLevel`
- model/thinking persistence side effects
- `model_select` event emission

Keep these pure helpers:

- `model-cycle.ts`: next cyclic index and thinking default after model change
- `thinking-levels.ts`: support/clamp/next-level decisions

Remove or retire any unused `ModelSwitcher` path from `AgentSession`.

## Benefits

- **Leverage**: all modes use the same public `AgentSession` methods while model policy is owned once.
- **Locality**: model persistence/event behavior changes in one file.
- **Testability**: cycle behavior can be tested through fake context and pure helpers.

## Before / After Sketch

```
BEFORE
AgentSession
  ├─ setModel/cycleModel
  ├─ _applyModelChange
  ├─ _emitModelSelect
  └─ ModelSwitcher placeholder

AFTER
AgentSession facade -> ModelController
ModelController -> model-cycle.ts + thinking-levels.ts
```

## ADR / DIP Conflict Callouts

- `core/runtime/AGENT.md` and `CLAUDE.md` must list `model-controller.ts` and `session-context.ts` when this lands.

## Resolution

**Landed**: `67edfd7` + `fd169e2` · 2026-06-01
**Owner**: `core/runtime/model-controller.ts` (pure helpers: `model-cycle.ts`, `thinking-levels.ts`)
**Context**: `ModelControllerContext`
**Outcome**: `ModelController` owns model set/cycle/restore and thinking-level set/cycle/restore. The pure decisions (xhigh fallback, cyclic index, level clamping) live in `model-cycle.ts`/`thinking-levels.ts`; the apply side-effects go through context capabilities. `AgentSession` methods are thin delegators.
**Criteria met**: single owner for model+thinking; no controller imports `agent-session.ts`.

## References

- Parent finding: `../findings/F01-agent-session-god-module.md`
- Gate: `../gates.md` RS-3
