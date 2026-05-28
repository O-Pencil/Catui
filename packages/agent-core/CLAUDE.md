# packages/agent-core/

> P2 | Parent: ../CLAUDE.md

Member List
agent.ts: Agent class, AgentOptions, AgentLoopPolicyOptions, main agent with message loop, coordinates with agent-loop for execution, stores last run result, runtime-settable loop policy plumbing
agent-loop.ts: agentLoop and agentLoopContinue, agent execution loop and state machine, transforms to Message[] at LLM boundary, emits request/result telemetry with transition history, recovers model/output errors, enforces standard tool lifecycle and tool-result budget gates
agent-loop-continuations.ts: computeRecoveryMaxTokens, createOutputTokenRecoveryMessage, createTokenBudgetContinuation, shared output continuation policy for agent loops
agent-loop-tool-results.ts: enforceToolResultBatchSize, shared aggregate tool-result budget policy for agent loops
agent-loop-tool-summaries.ts: PendingToolUseSummary, flushReadyToolUseSummaries, startToolUseSummary, shared non-blocking tool summary policy for agent loops
agent-run-result.ts: resolveAgentRunLoopFramework(), buildAgentRunPolicy(), shared agent_result framework/policy telemetry helpers
structured-adaptive-agent-loop.ts: structuredAdaptiveAgentLoop and structuredAdaptiveAgentLoopContinue, weak-model-compatible loop with ordered tool results, transition history telemetry, concurrency-safe tool batching, and aggregate tool-result budget enforcement
structured-adaptive-tool-orchestration.ts: runStructuredAdaptiveTools and partitionStructuredAdaptiveToolCalls, weak-model-compatible tool batching/execution layer with ordered tool_result pairing
structured-adaptive-streaming-tool-executor.ts: StructuredAdaptiveStreamingToolExecutor, starts complete streamed tool calls before assistant done while preserving ordered tool_result emission
index.ts: agent-core barrel exports, entry point for package, exports Agent, agentLoop, proxy utilities, types
proxy.ts: ProxyStreamOptions and streamProxy, proxy stream for apps routing LLM calls through server, manages auth isolation
types.ts: AgentLoopConfig, AgentRunResult transition history, AgentRunPolicy, CustomAgentMessages, AgentState, AgentToolResult, AgentTool, loop limits/budgets, agent-related type definitions, foundational for all modules

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent CLAUDE.md
