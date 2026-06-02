# AS04: Coordinator placeholders are shallow unless they own real behavior

```yaml
finding_id: AS04
severity: structural
lenses: [depth, leverage]
files_primary:
  - core/runtime/agent-session.ts
  - core/session/compaction/
files_secondary:
  - core/runtime/AGENT.md
  - core/runtime/CLAUDE.md
status: selected
```

## Problem

`AgentSession` already had a `CompactionCoordinator`, but a coordinator that is wired with placeholder callbacks does not reduce complexity. It can make the design look decomposed while the real behavior still lives in `AgentSession`.

This is dangerous because it satisfies naming but not depth.

## Deletion Test

> If the placeholder coordinator were deleted, would complexity concentrate in callers or vanish?

**Result**: likely vanishes until it owns real compaction behavior.

If the coordinator has empty/default callbacks and no call path owns compaction state, deleting it does not force callers to reimplement compaction. That is a shallow module signal.

## Proposed Direction

Either:

- finish the compaction extraction so the coordinator owns real state and behavior, or
- remove/avoid exposing it until the extraction is ready.

Do not mark P4 compaction as complete while coordinator wiring is placeholder.

## Decision

2026-06-01: remove the shallow `CompactionCoordinator` placeholder. It had no real data ownership, no external consumer, and no independent behavior. P4.x-a/b now move the real compaction behavior into `CompactionController`; branch-summary coordination still remains outside that controller by design.

## Benefits

- **Leverage**: a real compaction controller can be tested and reasoned about independently.
- **Locality**: compaction thresholds, aborts, branch summary, and extension hooks move together.

## Before / After Sketch

```
BAD
AgentSession owns compaction
CompactionCoordinator exists but receives no real data

GOOD
AgentSession facade -> CompactionController -> compaction pipeline
```

## Resolution

**Landed**: `ab10c8d` (remove placeholder) → `32c1e25` (P4.x-a manual) → `ee0fcfc` + `8b468e3` (P4.x-b auto) · 2026-06-01
**Owner**: `core/runtime/compaction-controller.ts`
**Context**: `CompactionControllerContext`
**Outcome**: the shallow `CompactionCoordinator` (no-op `compact`) was deleted, then replaced by a real `CompactionController` owning manual `compact()`, auto `runAuto()`, and both abort slots (`_slot`/`_autoSlot`). Lifecycle effects (disconnect/abort/reconnect) and event emission are capabilities.
**Boundary refinement**: (1) loop-continuation after auto-compaction (retry-tail prune + `agent.continue()`) stays in `AgentSession` — it is loop control, not compaction. (2) branch-summary was **excluded** and went to `SessionTreeController` (AS10).

## References

- Gate: `../gates.md` RS-5
- P4 runbook: `../execution-plan/P4-runtime-split.md`
