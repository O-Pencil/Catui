# core/runtime/

> P2 | Parent: ../AGENT.md

Member List
event-bus.ts: EventBus interface, EventBusController, createEventBus(), typed event emission system for extension hooks, key methods: emit(), on() returns unsubscribe function
sdk.ts: createAgentSession(options) factory, creates all services with dependency injection, wires up extensions, consumed by all run modes (interactive/print/rpc)
agent-session.ts: AgentSession class, central session lifecycle manager, wraps Agent from agent-core, coordinates compaction, emits events, handles model switching, all modes delegate to this class
default-tools.ts: createDefaultRuntimeTools(), default read/bash/edit/write/time tool wiring with settings-aware image/shell/write-boundary configuration
extension-core-bindings.ts: bindExtensionCore(), adapts AgentSession host capabilities into ExtensionRunner action/context APIs
slash-command-catalog.ts: buildSessionSlashCommands(), buildExtensionSlashCommands(), shared slash command catalog assembly for runtime and extension views
turn-context.ts: Generic per-turn hint bus on globalThis, TURN_CONTEXT_GLOBAL_KEY, TurnContext interface (currently structuralAnchor), setTurnContext/getTurnContext/resetTurnContext; producer-side API for SAL→mem-core decoupling (mem-core has read-only mirror at packages/mem-core/src/turn-context.ts using same global key)
pencil-agent.ts: PencilAgent helper class wrapping Agent core
retry-coordinator.ts: Retry coordination for transient failures

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
