# Runtime Session Refactor Plan

```yaml
review_id: runtime-session-review
status: active
created_at: 2026-06-01
parent_phase: P4
total_findings: 6
```

## Priority Order

| Rank | Finding | Severity | Lenses | Leverage / Cost | Depends On |
|------|---------|----------|--------|-----------------|------------|
| 1 | [AS01](./findings/AS01-session-context-service-locator.md) | load-bearing | seam, locality | high / low-medium | none |
| 2 | [AS02](./findings/AS02-model-controller-boundary.md) | load-bearing | depth, locality | high / low | AS01 |
| 3 | [AS03](./findings/AS03-session-switch-state-restore.md) | structural | seam, locality | medium / medium | AS02 |
| 4 | [AS04](./findings/AS04-compaction-coordinator-placeholder.md) | structural | depth, leverage | medium / medium | none |
| 5 | [AS05](./findings/AS05-tool-runtime-controller-boundary.md) | load-bearing | seam, leverage | high / medium | AS01 |
| 6 | [AS06](./findings/AS06-agent-session-public-facade.md) | load-bearing | DIP, leverage | high / low | all slices |

## Ordering Rationale

The context seam comes first because every controller extraction depends on it. Model/thinking is the smallest currently active slice, so it is the right proving ground. Session switch and tool runtime follow because they cross behavior boundaries and need the controller pattern to be settled before extraction.

## Execution Suggestion

1. Close AS01/AS02 together for the current `ModelController` slice.
2. Record the accepted context shape as the template for later controllers.
3. Do not claim compaction/tool/session lifecycle as complete until their placeholder wiring is removed or replaced by real behavior.
4. Keep `AgentSession` as the only public facade throughout P4.

## Phase Decisions

| Finding | Decision | Notes |
|---------|----------|-------|
| AS01 | selected | narrow `ModelControllerContext` implemented for current model slice |
| AS02 | selected | `ModelController` owns model/thinking set, cycle, restore for current slice |
| AS03 | selected | model/thinking restore is delegated to `ModelController`; switch flow remains lifecycle orchestration |
| AS04 | in progress | P4.x-a: real `CompactionController` owns the manual compaction flow + its abort slot (narrow `CompactionControllerContext`, lifecycle as capabilities). P4.x-b: move auto-compaction + collapse abortCompaction/isCompacting. Boundary: branch-summary excluded (belongs to session-tree flow) |
| AS05 | selected | `ToolRuntimeController` owns tool source merge, wrapping, active-name policy, and orchestrator registry updates |
| AS06 | pending | enforced continuously |

## Validation Checklist

- [ ] `npm run verify:quality` passes
- [ ] Public API symbol diff unchanged or intentional
- [ ] Runtime P2/P3 docs updated
- [ ] No runtime collaborator imports `agent-session.ts`
- [ ] No mode imports a controller directly
- [ ] Maintainer confirms behavior-critical paths to validate on stronger machine
