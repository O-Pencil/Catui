# packages/agent-core/

> P2 | Parent: ../AGENT.md

Member List
agent.ts: Agent class and AgentOptions, main agent with message loop, coordinates with agent-loop for execution
agent-loop.ts: agentLoop and agentLoopContinue, agent execution loop and state machine, transforms to Message[] at LLM boundary
structured-adaptive-agent-loop.ts: structuredAdaptiveAgentLoop and structuredAdaptiveAgentLoopContinue, weak-model-compatible loop with ordered tool results and concurrency-safe tool batching
structured-adaptive-tool-orchestration.ts: runStructuredAdaptiveTools and partitionStructuredAdaptiveToolCalls, weak-model-compatible tool batching/execution layer with ordered tool_result pairing
index.ts: agent-core barrel exports, entry point for package, exports Agent, agentLoop, proxy utilities, types
proxy.ts: ProxyStreamOptions and streamProxy, proxy stream for apps routing LLM calls through server, manages auth isolation
types.ts: AgentLoopConfig, CustomAgentMessages, AgentState, AgentToolResult, AgentTool, agent-related type definitions, foundational for all modules
vitest.config.ts: Vitest configuration for agent-core package tests

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
