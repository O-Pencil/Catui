# core/runtime/

> P2 | Parent: ../AGENT.md

Member List
event-bus.ts: EventBus interface, EventBusController, createEventBus(), typed event emission system for extension hooks, key methods: emit(), on() returns unsubscribe function
event-bridge.ts: ExtensionEventBridge, ExtensionEventBridgeDeps, owns AgentEvent-to-extension-event mapping and extension turn indexing; AgentSession keeps public subscribe, persistence, retry/compaction, and Soul ordering
sdk.ts: createAgentSession(options) factory, creates all services with dependency injection, wires up extensions, applies loop framework/policy overrides, consumed by all run modes (interactive/print/rpc)
agent-session.ts: AgentSession class, central session lifecycle manager, wraps Agent from agent-core, coordinates compaction, in-loop recovery and recoverable error-tail pruning, forwards agent_result telemetry to extensions, exposes runtime loop policy updates, emits events, handles model switching, all modes delegate to this class
turn-context.ts: Generic per-turn hint bus on globalThis, TURN_CONTEXT_GLOBAL_KEY, TurnContext interface (currently structuralAnchor), setTurnContext/getTurnContext/resetTurnContext; producer-side API for SAL→mem-core decoupling (mem-core has read-only mirror at packages/mem-core/src/turn-context.ts using same global key)
pencil-agent.ts: PencilAgent helper class wrapping Agent core
retry-coordinator.ts: Retry coordination for transient failures
bash-runner.ts: BashRunner class — bash execution + pending-message queue extracted from AgentSession (P4.1); deps injected as closures (getCwd/getShellCommandPrefix/appendToAgent/appendToSession/isStreaming), no Agent/SessionManager import
session-context.ts: ModelControllerContext, ModelSelectPayload, and ScopedModel contracts; narrow capability seam for runtime controllers
model-controller.ts: ModelController, CycleModelError, ModelCycleResult, owns model set/cycle/restore and thinking-level mutations formerly embedded in AgentSession
compaction-controller.ts: CompactionController — owns manual + auto compaction flows and their abort slots (AS04); reads session via narrow CompactionControllerContext (lifecycle disconnect/reconnect/abort as capabilities); AgentSession remains the facade and loop continuation host
session-tree-controller.ts: SessionTreeController — owns navigateTree() + branch summarization + the branch-summary abort slot (AS10); reads session via narrow SessionTreeControllerContext; after this slice AgentSession holds no abort slots
session-lifecycle-controller.ts: SessionLifecycleController — owns new/switch/fork session identity-change choreography (AS08/AS11); reads session through SessionLifecycleControllerContext; reload/tree/teardown remain separate owners
tool-runtime-controller.ts: ToolRuntimeController, ToolRuntimeBuildOptions, ToolRuntimeBuildResult, owns runtime tool source merge, extension wrapping, active tool resolution, and ToolOrchestrator registry updates
prompt-assembly.ts: buildRuntimeSystemPrompt(), getActiveBaseToolNames(), owns runtime prompt resource assembly and base-tool filtering; Soul injection state remains in AgentSession
default-tools.ts: createDefaultRuntimeTools(), default read/bash/edit/write/time tool wiring with settings-aware image/shell/write-boundary configuration
extension-core-bindings.ts: bindExtensionCore(), adapts AgentSession host capabilities into ExtensionRunner action/context APIs
slash-command-catalog.ts: buildSessionSlashCommands(), buildExtensionSlashCommands(), shared slash command catalog assembly for runtime and extension views
export-bridge.ts: exportSessionHtml(), getLastAssistantText(), owns HTML export wiring and last assistant text extraction; Theme remains injected through AgentSessionConfig
thinking-levels.ts: pure thinking-level logic extracted from AgentSession (P4.2) — THINKING_LEVELS(_WITH_XHIGH), modelSupportsThinking/Xhigh, availableThinkingLevels, clampThinkingLevel, nextThinkingLevel; no session state, reusable by rpc/print
model-cycle.ts: pure model-cycle decisions extracted from AgentSession (P4.2) — pickThinkingLevelOnModelChange, nextCyclicIndex; side effects are owned by model-controller.ts

## Capability Ownership (runtime subsystem)

> The DIP fourth axis: **which concern is owned by which file, with what capability contract, and why**.
> Member List = WHAT/WHERE (structure). This table = WHO-OWNS-WHAT + WHY. The Owner column is
> verify-dip-checked (every owner is a real member above). WHY links to the decision record; the
> generated `llm-wiki/` carries the symbol/dependency detail. Keep this table updated on any
> ownership move (same covenant as the member list).

| Concern | Owner | Capability contract | Why (review card) |
|---------|-------|---------------------|-------------------|
| model set/cycle + thinking level | `model-controller.ts` | `ModelControllerContext` | [AS02](../../.dev-docs/architecture-review/runtime-session-review/findings/AS02-model-controller-boundary.md), [AS03](../../.dev-docs/architecture-review/runtime-session-review/findings/AS03-session-switch-state-restore.md) |
| manual + auto compaction (+ abort slots) | `compaction-controller.ts` | `CompactionControllerContext` | [AS04](../../.dev-docs/architecture-review/runtime-session-review/findings/AS04-compaction-coordinator-placeholder.md) |
| session-tree navigation + branch summary | `session-tree-controller.ts` | `SessionTreeControllerContext` | [AS10](../../.dev-docs/architecture-review/runtime-session-review/findings/AS10-tree-navigation-boundary.md) |
| session new/switch/fork (identity change) | `session-lifecycle-controller.ts` | `SessionLifecycleControllerContext` | [AS08](../../.dev-docs/architecture-review/runtime-session-review/findings/AS08-session-lifecycle-boundary.md), [AS11](../../.dev-docs/architecture-review/runtime-session-review/findings/AS11-session-fork-boundary.md) |
| tool runtime merge/wrap/active/registry | `tool-runtime-controller.ts` | `ToolRuntimeBuildOptions/Result` | [AS05](../../.dev-docs/architecture-review/runtime-session-review/findings/AS05-tool-runtime-controller-boundary.md) |
| extension event mapping + turn indexing | `event-bridge.ts` | `ExtensionEventBridgeDeps` | [AS07](../../.dev-docs/architecture-review/runtime-session-review/findings/AS07-event-bridge-boundary.md) |
| bash execution + pending-message queue | `bash-runner.ts` | closure deps (`BashRunnerDeps`) | P4.1 |
| runtime prompt resource assembly | `prompt-assembly.ts` | function deps | P4 |
| HTML export + last assistant text | `export-bridge.ts` | function deps | P4 |
| retry coordination | `retry-coordinator.ts` | `RetryCoordinatorHost` | pre-existing |
| pure thinking-level / model-cycle logic | `thinking-levels.ts`, `model-cycle.ts` | pure functions (no session state) | P4.2 |
| cancellation slot / listener registry (primitives) | `../platform/abort-slot.ts`, `../platform/listeners.ts` | reusable primitives | P4.2 |
| composition root: state, facade, loop continuation, teardown | `agent-session.ts` | — (owns adapters + orchestration) | [AS06](../../.dev-docs/architecture-review/runtime-session-review/findings/AS06-agent-session-public-facade.md); reload [AS09 deferred], teardown [AS12 rejected] |

**Reading order for a new maintainer**: this table → the owner file's P3 header (local contract) → the review card (why this boundary) → `llm-wiki/pages/*/symbols.md` (exported surface).

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent core/AGENT.md. The Capability Ownership table moves with the member list — any ownership change updates both.
