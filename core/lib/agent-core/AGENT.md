# core/lib/agent-core/

> P2 | Parent: ../AGENT.md

Queue contract: agent.ts clearFollowUpQueue optionally removes only messages matching its predicate; omitted predicates retain full-clear compatibility.

Member List
agent.ts: Agent class, AgentOptions, AgentLoopPolicyOptions, main agent with message loop, coordinates execution, resumes durable approval checkpoints with paired tool results, stores last run result including transition history, runtime-settable loop policy plumbing; prepareContext commits working state at provider boundaries
agent-loop.ts: agentLoop and agentLoopContinue, agent execution loop and state machine, transforms to Message[] at LLM boundary, emits request/result telemetry and semantic transition traces, recovers model/output errors with paired failed-turn traces, tombstones recovered error turns, enforces standard tool lifecycle and tool-result budget gates; applies committed prepareContext before transient transforms
agent-loop-continuations.ts: computeRecoveryMaxTokens, createOutputTokenRecoveryMessage, createTokenBudgetContinuation, shared output continuation policy for agent loops
agent-loop-stream-events.ts: waitForAssistantStreamEvent, shared abortable assistant-stream iterator utility for agent loops
agent-loop-tool-results.ts: enforceToolResultBatchSize, createInterruptedToolResults, and createSkippedToolCallLimitResults, shared aggregate tool-result budget and skipped/interrupted tool-call completion policy for agent loops
agent-loop-tool-summaries.ts: PendingToolUseSummary, flushReadyToolUseSummaries, startToolUseSummary, shared non-blocking tool summary policy for agent loops
agent-run-result.ts: resolveAgentRunLoopFramework(), buildAgentRunPolicy(), shared agent_result framework/policy telemetry helpers
structured-adaptive-agent-loop.ts: structuredAdaptiveAgentLoop and structuredAdaptiveAgentLoopContinue, weak-model-compatible loop with ordered tool results, semantic transition traces, transition history telemetry, concurrency-safe tool batching, paired failed-turn and aborted-stream tool traces, and aggregate tool-result budget enforcement; shares committed prepareContext semantics with standard loop
structured-adaptive-tool-orchestration.ts: runStructuredAdaptiveTools and partitionStructuredAdaptiveToolCalls, weak-model-compatible tool batching/execution layer with ordered tool_result pairing and approval checkpoint identity propagation
structured-adaptive-streaming-tool-executor.ts: StructuredAdaptiveStreamingToolExecutor, starts and inventories complete streamed tool calls before assistant done while preserving ordered tool_result emission and terminal trace accounting
tool-policy.ts: ToolPolicyPipeline, deterministic fail-closed pre-execution policy evaluation with typed allow/deny/pause decisions and input transforms
loop-progress.ts: LoopProgressTracker, bounded canonical tool-evidence fingerprinting and livelock detection primitive
run-checkpoint.ts: AgentRunCheckpoint with session/conversation boundary, CheckpointStore, resolveRunCheckpoint, and InMemoryCheckpointStore versioned at-most-once pause/resume primitives
run-trace-context.ts: shared run/turn/model/tool/checkpoint/transition trace instrumentation used by both loop implementations
run-trace-recorder.ts: RunTraceRecorder, bounded serialized sink delivery, redaction, required/best-effort failure policy, and latched overflow failures
index.ts: agent-core barrel exports, entry point for package, exports Agent, agentLoop, proxy utilities, types
proxy.ts: ProxyStreamOptions and streamProxy, proxy stream for apps routing LLM calls through server, manages auth isolation
types.ts: AgentLoopConfig, AgentRunResult transition history, AgentRunPolicy, CustomAgentMessages, AgentState, AgentToolResult, AgentTool, loop limits/budgets, agent-related type definitions, foundational for all modules; optional synchronous prepareContext contract for persisted context transitions
vitest.config.ts: Vitest configuration for agent-core package tests

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
