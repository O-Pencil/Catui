# Runtime Session Review

```yaml
review_id: runtime-session-review
parent_finding: ../findings/F01-agent-session-god-module.md
scope: core/runtime/agent-session.ts and direct runtime collaborators
status: closed
created_at: 2026-06-01
closed_at: 2026-06-02
outcome: 8 selected+landed, 1 grouped (AS11→AS08), 1 deferred (AS09), 1 rejected (AS12)
```

> **CLOSED 2026-06-02.** All 12 cards reached terminal disposition; selected slices
> landed with `## Resolution` backfilled. Structural gates (RS-1/RS-2/RS-3) verified on
> the branch (see [Closeout](#closeout--p4-sign-off-handoff)). Heavy gates (RS-4 facade
> behavior, RS-6 DIP, build/quality/wiki) hand off to P4 sign-off.

## Purpose

This is a focused architecture review for `AgentSession` decomposition. It is a child review of F01, not a replacement for the top-level architecture review.

Use this review pattern whenever a load-bearing core module is being split and the split can create new coupling, new service locators, or unclear ownership.

## When To Use This Pattern

Run a专项评审 before implementation when all of the following are true:

- The target module is a composition root, lifecycle manager, or public facade.
- The refactor moves behavior into new modules, not just files.
- The module has external callers that must remain stable.
- New seams are expected to be reused by SDK, modes, extensions, sub-agents, or tests.

For small helper extraction, use normal code review. For core decomposition, use this directory shape.

## Workflow

1. **Map**: identify concrete method clusters and mutable state ownership.
2. **Card**: write one finding card per coupling or ownership risk under `findings/`.
3. **Gate**: evaluate the proposed slice against `gates.md`.
4. **Grill**: maintainer chooses which cards are selected, rejected, or deferred.
5. **Implement**: code changes happen after the card is accepted.
6. **Record**: update `refactor-plan.md` with the actual order and validation status.

This mirrors `../workflow.md`, but with smaller scope and no HTML report requirement unless the maintainer requests one.

## Current Finding Set

| Finding | Status | Purpose |
|---------|--------|---------|
| [AS01](./findings/AS01-session-context-service-locator.md) | ✅ landed | Prevent runtime controller context from becoming a new service locator |
| [AS02](./findings/AS02-model-controller-boundary.md) | ✅ landed | Make `ModelController` the single model/thinking owner |
| [AS03](./findings/AS03-session-switch-state-restore.md) | ✅ landed | Isolate session switch state restoration |
| [AS04](./findings/AS04-compaction-coordinator-placeholder.md) | ✅ landed | Avoid placeholder coordinators that hide no complexity |
| [AS05](./findings/AS05-tool-runtime-controller-boundary.md) | ✅ landed | Protect S1: `ToolOrchestrator` as the only tool dispatch point |
| [AS06](./findings/AS06-agent-session-public-facade.md) | ✅ landed | Keep `AgentSession` as the stable facade while internals split |
| [AS07](./findings/AS07-event-bridge-boundary.md) | ✅ landed | Keep event bridge narrow and protect turn lifecycle ownership |
| [AS08](./findings/AS08-session-lifecycle-boundary.md) | ✅ landed | Keep session lifecycle extraction limited to identity-change choreography |
| [AS09](./findings/AS09-reload-runtime-boundary.md) | ⏸ deferred | Treat reload as runtime rebuild work, not a thin lifecycle controller |
| [AS10](./findings/AS10-tree-navigation-boundary.md) | ✅ landed | Keep tree navigation and branch summary under a dedicated tree controller |
| [AS11](./findings/AS11-session-fork-boundary.md) | ✅ landed via AS08 | Group fork with session identity-change lifecycle, not tree navigation |
| [AS12](./findings/AS12-teardown-abort-boundary.md) | ✖ rejected | Keep abort/dispose teardown on `AgentSession` instead of creating a placeholder controller |

**Disposition roll-up**: 9 landed (AS01–08 + AS10, with AS11 grouped into AS08) · 1 deferred (AS09, re-open only if `_buildRuntime` needs an owner) · 1 rejected (AS12, re-open only if teardown gains owned state). Every landed card carries a `## Resolution` (landing commit + owner + boundary corrections); ownership is indexed in [`core/runtime/CLAUDE.md` §Capability Ownership](../../../core/runtime/CLAUDE.md).

## Non-Goals

- Do not introduce new user-visible behavior.
- Do not change mode-layer imports unless a card explicitly approves a public API change.
- Do not create controller APIs for external callers. Controllers are internal runtime collaborators.
- Do not use line count as a pass/fail rule; use it only as a review trigger.

## Relationship To P4

This review is the detailed decision surface for [P4 runtime god split](../execution-plan/P4-runtime-split.md). P4 remains the execution runbook; this directory explains why each split is valid and how to judge it.

## Closeout — P4 sign-off handoff

**Result of decomposition**: `agent-session.ts` 3550 → **2375** lines; 10 owners extracted (1603 lines) under the capability-context pattern. `agent-session.ts` is now a composition root (state + facade + loop continuation + teardown), holding **no abort slots** (all three live in their owning controllers).

### Gates verified at closeout (on-branch, no build required)

| Gate | Statement | Evidence (2026-06-02, branch `refactor/arch-candidate-d`) |
|------|-----------|-----------------------------------------------------------|
| RS-1 | No controller imports `agent-session.ts` (one-directional) | `grep '^\s*import.*agent-session'` over all `*-controller.ts` + helpers → 0 hits (matches are P3 comments only) |
| RS-2 | Context is named capabilities, not whole `AgentSession` | 4 `*ControllerContext` contracts in `session-context.ts`; that file does not import `agent-session.ts` |
| RS-3 | Single owner; no residual state on facade | `agent-session.ts` holds 0 abort slots; each slot owned by compaction/tree controller |
| RS-5 | No fake/placeholder extraction | enforced by rejecting AS12 (teardown) + deferring AS09 (reload) — both would own no state |

### Gates that hand off to P4 sign-off (need a capable machine)

| Gate | Statement | Where verified |
|------|-----------|----------------|
| RS-4 | Facade behavior stable — public `AgentSession` API + mode callers unchanged | characterization replay + symbols diff vs `main` → [refactor-validation.md §2/§5](../refactor-validation.md) |
| RS-6 | DIP isomorphism (P2 member list + Capability Ownership + P3 headers ↔ code) | `npx tsx scripts/verify-dip.ts` |
| — | No new import cycles from the split | `scripts/verify-quality.ts` (F08) |
| — | Compiles + builds | `npm run build` (already green at `91ab9de`, re-confirm post-resolution-docs) |
| — | Structural feature/symbol catalog refreshed | `npm run wiki:all` → [refactor-validation.md §5](../refactor-validation.md) |

These five rows are the P4 entry conditions in [sign-off-main.md](../execution-plan/sign-off-main.md); this review supplies the WHY (cards) and WHO-OWNS-WHAT (Capability Ownership table) feeding them.
