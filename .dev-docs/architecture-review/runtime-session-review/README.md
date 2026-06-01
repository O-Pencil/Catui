# Runtime Session Review

```yaml
review_id: runtime-session-review
parent_finding: ../findings/F01-agent-session-god-module.md
scope: core/runtime/agent-session.ts and direct runtime collaborators
status: active
created_at: 2026-06-01
```

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
| [AS01](./findings/AS01-session-context-service-locator.md) | selected | Prevent runtime controller context from becoming a new service locator |
| [AS02](./findings/AS02-model-controller-boundary.md) | selected | Make `ModelController` the single model/thinking owner |
| [AS03](./findings/AS03-session-switch-state-restore.md) | selected | Isolate session switch state restoration |
| [AS04](./findings/AS04-compaction-coordinator-placeholder.md) | open | Avoid placeholder coordinators that hide no complexity |
| [AS05](./findings/AS05-tool-runtime-controller-boundary.md) | open | Protect S1: `ToolOrchestrator` as the only tool dispatch point |
| [AS06](./findings/AS06-agent-session-public-facade.md) | open | Keep `AgentSession` as the stable facade while internals split |

## Non-Goals

- Do not introduce new user-visible behavior.
- Do not change mode-layer imports unless a card explicitly approves a public API change.
- Do not create controller APIs for external callers. Controllers are internal runtime collaborators.
- Do not use line count as a pass/fail rule; use it only as a review trigger.

## Relationship To P4

This review is the detailed decision surface for [P4 runtime god split](../execution-plan/P4-runtime-split.md). P4 remains the execution runbook; this directory explains why each split is valid and how to judge it.
