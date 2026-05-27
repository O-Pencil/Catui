# packages/agent-core/

> P2 | Parent: ../CLAUDE.md

Member List
agent.ts: Agent class and AgentOptions, main agent with message loop, coordinates with agent-loop for execution
agent-loop.ts: agentLoop and agentLoopContinue, agent execution loop and state machine, transforms to Message[] at LLM boundary, emits request/result telemetry, recovers model/output errors, enforces standard tool lifecycle gates
agent-loop-continuations.ts: computeRecoveryMaxTokens, createOutputTokenRecoveryMessage, createTokenBudgetContinuation, shared output continuation policy for agent loops
index.ts: agent-core barrel exports, entry point for package, exports Agent, agentLoop, proxy utilities, types
proxy.ts: ProxyStreamOptions and streamProxy, proxy stream for apps routing LLM calls through server, manages auth isolation
types.ts: AgentLoopConfig, CustomAgentMessages, AgentState, AgentToolResult, AgentTool, agent-related type definitions, foundational for all modules

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent CLAUDE.md
