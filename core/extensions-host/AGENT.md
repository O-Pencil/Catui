# core/extensions-host/

> P2 | Parent: ../AGENT.md

Member List
index.ts: Extension system public API, re-exports from loader.ts, runner.ts, types.ts, wrapper.ts, consumed by SDK and extensions themselves
wrapper.ts: wrapRegisteredTool(), wraps RegisteredTool into AgentTool, uses runner's createContext() for consistent context across tools
types.ts: All extension-related TypeScript types and interfaces, key types: Extension, ExtensionContext, HookEvent types, AgentResultEvent, ToolDefinition, RegisteredTool, SlashCommand
loader.ts: ExtensionLoader, discoverAndLoadExtensions(), loadExtensions(), loadExtensionFromFactory(), extension discovery and loading via jiti, key invariant: extensions loaded from ~/.nanopencil/agent/extensions/ and project .pencil/extensions/
runner.ts: ExtensionRunner class, extension execution and lifecycle management, event emission to hooks, tool wrapping, key hooks: session_start, session_shutdown, before_agent_start, agent_result, after_agent_end, tool_call

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
