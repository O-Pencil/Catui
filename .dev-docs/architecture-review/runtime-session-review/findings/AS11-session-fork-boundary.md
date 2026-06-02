# AS11: fork() belongs with session lifecycle, not tree navigation

```yaml
finding_id: AS11
severity: structural
lenses: [locality, lifecycle]
files_primary:
  - core/runtime/agent-session.ts
files_secondary:
  - core/runtime/session-context.ts
  - core/session/session-manager.ts
status: grouped-with-AS08
```

## Problem

`fork()` (~62 lines) reads like a tree/branch operation by name, so it is tempting to bundle it with `navigateTree()` (AS10). But its behavior is a **session-identity change**, the same shape as `newSession()`/`switchSession()`:

- validate the target entry (must be a user message)
- `session_before_fork` extension hook (cancellable)
- clear session-bound pending queue (`_pendingNextTurnMessages`)
- create a **new session file**: `sessionManager.newSession()` or `createBranchedSession()`
- set `agent.sessionId`
- rebuild session context and (optionally) replace agent messages
- emit `session_fork`

The defining difference from `navigateTree()`: **fork creates a new session file** (new identity); `navigateTree()` stays in the same file and moves the leaf. fork shares its skeleton — validate → before-hook → identity transition → message restore → after-hook — with `newSession`/`switchSession`.

## Deletion Test

> Which existing slice would naturally re-absorb fork?

**Result**: the session lifecycle slice (`newSession`/`switchSession`, AS08), not the tree controller. Putting fork in `SessionTreeController` would split "identity change" ownership across two controllers and duplicate the before/after-hook + message-restore skeleton.

## Verdict — GROUP WITH AS08 (session lifecycle), NOT AS10

`fork()` is closer to switch/new. When the session-lifecycle slice (AS08) is implemented:

- include `fork()` alongside `newSession()`/`switchSession()`
- it shares the identity-transition + before/after-hook + message-restore capabilities
- do **not** place fork in `SessionTreeController`

Sequencing: implement AS10 (tree) first (it owns the last abort slot and the biggest method), then AS08 (lifecycle incl. fork) once the switch contract is stable — matching AS08's own staging note.

## Decision Criteria (when implemented under AS08)

- fork is owned by the session-lifecycle collaborator, not the tree controller
- `session_before_fork` cancellation and `session_fork` emission order unchanged
- pending-queue clearing uses the same explicit capability as new/switch
- new-file vs branched-file decision (`parentId` check) is byte-identical
- `skipConversationRestore` behavior preserved

## Resolution

**Landed**: `5768693` (extract session lifecycle identity flow) · 2026-06-01
**Owner**: `core/runtime/session-lifecycle-controller.ts` (`fork()`)
**Outcome**: as predicted, `fork()` was grouped with the lifecycle slice (AS08), not the tree controller. The new-file vs branched-file decision (`parentId` check), `session_before_fork`/`session_fork` hook order, `skipConversationRestore`, and the **next-turn-only** queue clear are all byte-identical to the original.
**Decision-criteria correction**: Decision Criterion "pending-queue clearing uses the same explicit capability as new/switch" was a pre-implementation assumption and is **wrong** — the original `fork()` cleared only `_pendingNextTurnMessages`, not steering/follow-up. The implementation preserved that by giving fork its own `clearPendingNextTurnMessages` capability, distinct from new/switch's `clearPendingQueues`. Trust the Resolution over that criterion.

## References

- Lifecycle boundary: `./AS08-session-lifecycle-boundary.md`
- Tree boundary: `./AS10-tree-navigation-boundary.md`
