# Runtime Session Refactor Plan

```yaml
review_id: runtime-session-review
status: active
created_at: 2026-06-01
parent_phase: P4
total_findings: 12
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
| 7 | [AS07](./findings/AS07-event-bridge-boundary.md) | load-bearing | DIP, locality | high / medium | AS06 |
| 8 | [AS08](./findings/AS08-session-lifecycle-boundary.md) | load-bearing | DIP, locality, lifecycle | high / medium | AS06, AS07 |
| 9 | [AS10](./findings/AS10-tree-navigation-boundary.md) | load-bearing | depth, locality, leverage | high / medium | AS06 |
| 10 | [AS11](./findings/AS11-session-fork-boundary.md) | structural | locality, lifecycle | medium / low | AS08, AS10 |
| 11 | [AS09](./findings/AS09-reload-runtime-boundary.md) | structural | DIP, lifecycle | medium / medium | AS06 |
| 12 | [AS12](./findings/AS12-teardown-abort-boundary.md) | opinionated | locality | n/a (rejected) | none |

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
| AS04 | selected | P4.x-a/b landed: `CompactionController` owns manual + auto compaction flows, abort slots, and compaction lifecycle capabilities; `AgentSession` keeps loop continuation and facade wiring. Boundary: branch-summary remains with session-tree flow |
| AS05 | selected | `ToolRuntimeController` owns tool source merge, wrapping, active-name policy, and orchestrator registry updates |
| AS06 | selected | modes, SDK, sub-agent runtime, and package barrels continue through `AgentSession` / `createAgentSession`; controller collaborators are not exported through public barrels |
| AS07 | selected | `ExtensionEventBridge` owns extension event mapping and turn indexing only; `AgentSession` retains public subscribe, persistence ordering, retry/compaction ordering, and Soul post-turn recording |
| AS08 | selected | lifecycle extraction owns session identity-change choreography only: `newSession()`, `switchSession()`, and `fork()`; reload, tree navigation, branch summary, MCP/Soul refresh, and tool rebuild policy stay out |
| AS10 | landed | `navigateTree()` (~206 lines, largest remaining method) owns real state (`_branchSummarySlot`) + behavior (tree positioning, branch summary, extension override) → extract `SessionTreeController` (incl. `abortBranchSummary` + the last abort slot). Next slice |
| AS11 | selected via AS08 | `fork()` is a session-identity change (new file), same shape as new/switch — implement under the lifecycle slice, not the tree controller |
| AS09 | deferred | `reload()` is a runtime-rebuild + sequencing problem; only extract if paired with `_buildRuntime` as a `RuntimeRebuildController`. Lower priority than AS10 |
| AS12 | rejected | `abort()`/`dispose()`/mode shutdown are thin sequencers over already-owned collaborators (RetryCoordinator/Agent/ExtensionRunner/Listeners); a teardown controller would own no state → RS-5 placeholder. Keep on `AgentSession` |

## Validation Checklist

- [ ] `npm run verify:quality` passes
- [ ] Public API symbol diff unchanged or intentional
- [ ] Runtime P2/P3 docs updated
- [ ] No runtime collaborator imports `agent-session.ts`
- [ ] No mode imports a controller directly
- [ ] Maintainer confirms behavior-critical paths to validate on stronger machine
