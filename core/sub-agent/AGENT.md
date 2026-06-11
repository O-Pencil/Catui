# core/sub-agent/

> P2 | Parent: ../AGENT.md

Member List
index.ts: Barrel exports for both SubAgent runtime and CC-style Agent tool system — SubAgentRuntime, subAgentRuntime, InProcessSubAgentBackend, SubAgentSpec/Result/Handle/Backend types, createAgentTool, createTaskToolAlias, AGENT_TOOL_NAME, TASK_TOOL_NAME, AgentDefinitionRegistry, agentDefinitionRegistry, filterToolsForAgent, extractAgentResult, checkHandoffSafety, AgentInput/Output types
sub-agent-types.ts: Core SubAgent interfaces — SubAgentSpec (prompt/tools/cwd/signal/timeoutMs/model/contextFiles/exitHook/onEvent), SubAgentEvent, SubAgentHandle (id/status/result/abort/terminate), SubAgentResult, SubAgentBackend; consumed by backend and runtime
sub-agent-backend.ts: InProcessSubAgentBackend — wraps createAgentSession() with AbortSignal forwarding, timeout, contextFiles prompt injection, realtime AgentSession event forwarding, exitHook completion callback; spawn returns SubAgentHandle; single backend for Phase A
sub-agent-runtime.ts: SubAgentRuntime class — active agent registry, spawn/abortAll/terminateAll; default global instance subAgentRuntime; consumed by extension orchestrators
subprocess-backend.ts: SubprocessSubAgentBackend — worker_threads-based crash-isolated backend, abort/lifecycle wiring; worker LLM loop deferred (see file doc)
subprocess-worker.ts: Minimal worker entry for subprocess backend — receives WorkerSpec via workerData, posts result/error back via parentPort
agent-definition.ts: AgentDefinition interface (25+ fields), AgentDefinitionSource, AgentPermissionMode, AgentIsolationMode, built-in agent definitions (general-purpose, explore, plan); per CC §IV, §V
agent-input-output.ts: AgentInput (TypeBox schema), AgentOutputCompleted, AgentOutputAsync, AgentOutput union, AgentSpawnMetadata, AgentUsage, type guards; per CC §III
agent-registry.ts: AgentDefinitionRegistry class — name registry, definition cache, lookup, reload from disk; global singleton agentDefinitionRegistry; per CC §XIV
agent-tool-filter.ts: filterToolsForAgent, resolveAgentModel, isReadOnlyTool, getToolDescriptionsForAgent — tool filtering by agent definition and permission mode; per CC §IX
agent-result-extractor.ts: extractAgentResult, truncateResult — extracts final assistant message from sub-agent conversation, enforces MAX_RESULT_SIZE_CHARS (100k) truncation; per CC §11.2 (VS8)
agent-handoff-safety.ts: checkHandoffSafety — handoff classifier for auto mode security review, checkRecursionLimits for fork depth enforcement; per CC §XII (ES8)
agent-output-persistence.ts: getOutputFilePath, writeAgentOutputFile, readAgentOutputFile, getTasksDir — file-based background task output persistence to .nanopencil/tasks/; per CC §XI.3 (lY/qR6)
agent-prompt-builder.ts: buildNotesSystemPrompt, buildWorktreeNotes — system prompt "Notes:" section injection listing additional working directories; per CC §X (Z18)
agent-definition-loader.ts: loadAgentDefinitionsFromDirectory, parseMarkdownAgentDefinition, parseJsonAgentDefinition — custom agent definition loader from .nanopencil/agents/ markdown/JSON files; per CC §XV (mM4/uM4)
agent-tool.ts: createAgentTool, createTaskToolAlias — the "Agent"/"Task" tool for LLM invocation, full CC §VI spawn flow: resolve definition → filter tools → build prompt → create worktree → create session → iterate stream → extract result → handoff check → cleanup; includes telemetry (CC §XVI), auto-background conversion via Promise.race (CC §XIII), progress event forwarding via onSubAgentEvent callback (CC §XV)
send-message-tool.ts: createSendMessageTool — the "SendMessage" tool for addressing named running agents (inter-agent messaging, CC §XI); consumed by agent-session.ts alongside Agent/Task tools
agent-telemetry.ts: emitAgentSelected, emitAgentCompleted, emitAgentAutoModeDecision, emitAgentMemoryLoaded — structured telemetry events for the Agent tool; maps to CC §XVI tengu_* events; EventBus bridge via setAgentTelemetryEventBus; logger-only by default

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file on changes and verify against parent core/AGENT.md
