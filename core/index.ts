/**
 * [WHO]: Barrel exports for core API surface
 * [FROM]: Depends on runtime/, tools/, extensions/, session/, model/, config/
 * [TO]: Consumed by index.ts (package root barrel)
 * [HERE]: Public entry point for core functionality; consumed by modes and SDK
 */

export {
  AgentSession,
  type AgentSessionConfig,
  type AgentSessionEvent,
  type AgentSessionEventListener,
  type ModelCycleResult,
  type PromptOptions,
  type SessionStats,
} from "./runtime/agent-session.js";
export {
  type BashExecutorOptions,
  type BashResult,
  executeBash,
  executeBashWithOperations,
} from "./platform/exec/bash-executor.js";
export type { CompactionResult } from "./session/compaction/index.js";
export {
  createEventBus,
  type EventBus,
  type EventBusController,
} from "./runtime/event-bus.js";

// SDK wrapper and logger
export {
  PencilAgent,
  quickAgent,
  type PencilAgentOptions,
} from "./runtime/pencil-agent.js";
export {
  type SDKLogger,
  silentLogger,
  defaultLogger,
} from "./runtime/sdk.js";

// Extensions system
export {
  type AgentEndEvent,
  type AgentStartEvent,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type BeforeAgentStartEvent,
  type ContextEvent,
  discoverAndLoadExtensions,
  type ExecOptions,
  type ExecResult,
  type Extension,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type ExtensionError,
  type ExtensionEvent,
  type ExtensionFactory,
  type ExtensionFlag,
  type ExtensionHandler,
  ExtensionRunner,
  type ExtensionShortcut,
  type ExtensionUIContext,
  type LoadExtensionsResult,
  type MessageRenderer,
  type RegisteredCommand,
  type SessionBeforeCompactEvent,
  type SessionBeforeForkEvent,
  type SessionBeforeSwitchEvent,
  type SessionBeforeTreeEvent,
  type SessionCompactEvent,
  type SessionForkEvent,
  type SessionShutdownEvent,
  type SessionStartEvent,
  type SessionSwitchEvent,
  type SessionTreeEvent,
  type ToolCallEvent,
  type ToolDefinition,
  type ToolRenderResultOptions,
  type ToolResultEvent,
  type TurnEndEvent,
  type TurnStartEvent,
  wrapToolsWithExtensions,
} from "./extensions-host/index.js";

// MCP (Model Context Protocol) support
export { MCPManager } from "./mcp/mcp-manager.js";

// Debug logging (re-exported from ai package)
export {
	getDebugLogger,
	createDebugLogger,
	debug,
	type DebugLogLevel,
} from "./lib/ai/dist/debug-logger.js";
export type {
  MCPServerConfig,
  MCPTool,
  MCPToolResult,
} from "./mcp/mcp-client.js";
export {
  loadMCPConfig,
  saveMCPConfig,
  addMCPServer,
  removeMCPServer,
  getMCPServer,
  listMCPServers,
  listEnabledMCPServers,
} from "./mcp/mcp-config.js";
