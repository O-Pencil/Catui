# core/runtime/

> P2 | Parent: ../CLAUDE.md

Member List
event-bus.ts: EventBus interface, EventBusController, createEventBus(), typed event emission system for extension hooks, key methods: emit(), on() returns unsubscribe function
sdk.ts: createAgentSession(options) factory, creates all services with dependency injection, wires up extensions, applies loop framework/policy overrides, consumed by all run modes (interactive/print/rpc)
agent-session.ts: AgentSession class, central session lifecycle manager, wraps Agent from agent-core, coordinates compaction, in-loop recovery and recoverable error-tail pruning, forwards agent_result telemetry to extensions, exposes runtime loop policy updates, emits events, handles model switching, all modes delegate to this class
turn-context.ts: Generic per-turn hint bus on globalThis, TURN_CONTEXT_GLOBAL_KEY, TurnContext interface (currently structuralAnchor), setTurnContext/getTurnContext/resetTurnContext; producer-side API for SAL→mem-core decoupling (mem-core has read-only mirror at packages/mem-core/src/turn-context.ts using same global key)
pencil-agent.ts: PencilAgent helper class wrapping Agent core
retry-coordinator.ts: Retry coordination for transient failures
bash-runner.ts: BashRunner class — bash execution + pending-message queue extracted from AgentSession (P4.1); deps injected as closures (getCwd/getShellCommandPrefix/appendToAgent/appendToSession/isStreaming), no Agent/SessionManager import
thinking-levels.ts: pure thinking-level logic extracted from AgentSession (P4.2) — THINKING_LEVELS(_WITH_XHIGH), modelSupportsThinking/Xhigh, availableThinkingLevels, clampThinkingLevel, nextThinkingLevel; no session state, reusable by rpc/print
model-cycle.ts: pure model-cycle decisions extracted from AgentSession (P4.2) — pickThinkingLevelOnModelChange, nextCyclicIndex; the side-effecting apply sequence stays in session via _applyModelChange

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent CLAUDE.md
