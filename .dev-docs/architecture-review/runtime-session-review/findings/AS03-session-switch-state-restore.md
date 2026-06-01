# AS03: Session switching mixes lifecycle flow with model/thinking restore

```yaml
finding_id: AS03
severity: structural
lenses: [seam, locality]
files_primary:
  - core/runtime/agent-session.ts
files_secondary:
  - core/runtime/model-controller.ts
  - core/session/session-manager.ts
status: selected
```

## Problem

`switchSession()` performs several unrelated responsibilities in one flow:

- extension cancellation and switch events
- abort and message queue reset
- session file replacement
- agent message replacement
- model restore
- thinking-level restore/defaulting

The model/thinking restore rules are not just data loading. They decide whether to append history, whether to emit `model_select`, and how to clamp defaults to current model capabilities.

## Deletion Test

> If the model/thinking restore block were deleted from `switchSession()`, would complexity concentrate elsewhere?

**Result**: concentrates.

Callers would need to know how session entries encode model/thinking state. The restore behavior belongs behind a runtime seam, but not necessarily inside the lifecycle method itself.

## Proposed Direction

Move model/thinking restoration behind `ModelController` methods:

- `restoreModel(model)`
- later: `restoreThinkingFromSession(...)`
- optionally: `restoreFromSessionState(...)`

Keep `switchSession()` responsible for orchestration:

1. ask extensions whether switch can proceed
2. abort/disconnect
3. load session messages
4. delegate state restore
5. reconnect

## Benefits

- **Locality**: changing model restore behavior no longer requires editing the full session switch flow.
- **Leverage**: fork/resume/new session flows can reuse the same state restore contract.

## Before / After Sketch

```
BEFORE
switchSession()
  ├─ lifecycle
  ├─ extension events
  ├─ message replacement
  ├─ model restore
  └─ thinking restore

AFTER
switchSession()
  ├─ lifecycle
  ├─ extension events
  ├─ message replacement
  └─ modelController.restore...
```

## References

- Gate: `../gates.md` RS-3
- Adjacent: AS02
