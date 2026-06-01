# core/runtime/

> P2 | Parent: ../CLAUDE.md

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
tool-runtime-controller.ts: ToolRuntimeController, ToolRuntimeBuildOptions, ToolRuntimeBuildResult, owns runtime tool source merge, extension wrapping, active tool resolution, and ToolOrchestrator registry updates
prompt-assembly.ts: buildRuntimeSystemPrompt(), getActiveBaseToolNames(), owns runtime prompt resource assembly and base-tool filtering; Soul injection state remains in AgentSession
export-bridge.ts: exportSessionHtml(), getLastAssistantText(), owns HTML export wiring and last assistant text extraction; Theme remains injected through AgentSessionConfig
thinking-levels.ts: pure thinking-level logic extracted from AgentSession (P4.2) — THINKING_LEVELS(_WITH_XHIGH), modelSupportsThinking/Xhigh, availableThinkingLevels, clampThinkingLevel, nextThinkingLevel; no session state, reusable by rpc/print
model-cycle.ts: pure model-cycle decisions extracted from AgentSession (P4.2) — pickThinkingLevelOnModelChange, nextCyclicIndex; side effects are owned by model-controller.ts

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent CLAUDE.md
