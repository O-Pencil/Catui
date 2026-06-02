# AS07: Event bridge must not steal lifecycle ownership from `AgentSession`

```yaml
finding_id: AS07
severity: load-bearing
lenses: [DIP, locality, leverage]
files_primary:
  - core/runtime/agent-session.ts
files_secondary:
  - core/extensions-host/
  - modes/interactive/interactive-mode.ts
  - modes/rpc/rpc-mode.ts
  - modes/acp/acp-mode.ts
  - modes/print-mode.ts
status: selected
```

## Problem

`AgentSession._handleAgentEvent()` currently mixes several different responsibilities:

- public `AgentSessionEvent` fanout through `subscribe()`
- extension event mapping and forwarding
- user/follow-up queue cleanup
- session persistence for ended messages
- retry and auto-compaction decision points
- Soul interaction recording after a turn

This makes it tempting to create a broad `EventBridge` that receives `AgentSession` or owns the full turn lifecycle. That would reduce line count but move the god object shape into a new file.

## Deletion Test

> If an event bridge were deleted, would behavior concentrate in callers or return to `AgentSession`?

**Result**: it should return only event mapping/fanout behavior. If deleting it forces callers to recreate session persistence, retry, compaction, or Soul lifecycle decisions, the bridge is too broad.

## Proposed Direction

Create an event bridge only if it stays narrow:

- It may own `AgentEvent` -> extension event mapping.
- It may own listener fanout helpers if the public `subscribe()` contract stays in `AgentSession`.
- It must not own session persistence, retry, compaction, queue mutation, or Soul recording.
- It must not expose a new public event API to modes.
- It must not import `agent-session.ts` or receive an `AgentSession` instance.

Keep these in `AgentSession` unless a later lifecycle card explicitly moves them:

- public `AgentSessionEvent` type and `subscribe()`
- `_handleAgentEvent()` turn-level orchestration
- session persistence ordering
- retry / compaction ordering after `agent_end`
- Soul post-turn recording
- disconnect/reconnect subscription lifecycle

## Benefits

- **Locality**: extension event mapping becomes readable and testable without touching the session lifecycle.
- **DIP**: modes continue depending on `AgentSession`, not event internals.
- **Leverage**: later session-lifecycle work can reason about event ordering without hidden ownership transfer.

## Before / After Sketch

```
BAD
AgentSession -> EventBridge owns persistence + retry + compaction + extension mapping

GOOD
AgentSession owns turn lifecycle
AgentSession -> EventBridge maps/fans out extension-facing events
```

## Decision Criteria

Accept a P4.7 implementation only if:

- the bridge has a narrow dependency object, not `AgentSession`
- no mode imports the bridge
- public `AgentSessionEvent` remains exported from `agent-session.ts`
- `AgentSession` remains the only owner of post-agent-end ordering
- behavior remains reachable through the same `session.subscribe()` API

## Decision

2026-06-01: introduce `ExtensionEventBridge` as a narrow internal runtime collaborator. It owns only extension-facing event mapping and extension turn indexing. `AgentSession` keeps the public event facade, listener fanout, session persistence, retry/compaction ordering after `agent_end`, Soul post-turn recording, and disconnect/reconnect lifecycle.

## Resolution

**Landed**: `b79b4f4` (extract extension event bridge) · 2026-06-01
**Owner**: `core/runtime/event-bridge.ts` (`ExtensionEventBridge`)
**Outcome**: the bridge owns extension event mapping and turn indexing only. `AgentSession` retains public `subscribe`, persistence ordering, retry/compaction ordering, and Soul post-turn recording — i.e. the bridge maps events but does not own session-event policy.

## References

- Gate: `../gates.md` RS-1, RS-3, RS-4, RS-5
- Prior facade review: `./AS06-agent-session-public-facade.md`
