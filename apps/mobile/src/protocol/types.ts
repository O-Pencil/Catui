/**
 * [WHO]: Provides RpcCommand, RpcResponse, RpcServerMessage, RpcSessionState, RpcExtensionUIRequest, isTranscriptMessage() and related wire types
 * [FROM]: Depends on nothing (structural mirror of modes/rpc/rpc-types.ts + rpc-command-handler.ts RpcServerMessage; no repo-source imports)
 * [TO]: Consumed by src/protocol/client.ts, src/state/session-store.ts, src/state/wiring.ts, src/views/*
 * [HERE]: apps/mobile/src/protocol/types.ts - wire-level protocol types for the Catui remote WebSocket connection; server types are canonical, this mirror exists because importing repo source types would transitively pull the whole repository type graph into an app with its own lockfile. Only JSON shapes that cross the wire are mirrored; server-internal types stay loosely typed.
 */

// ============================================================================
// Content blocks and messages (subset of @catui/ai Message used by the UI)
// ============================================================================

export interface TextContent {
	type: "text";
	text: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	redacted?: boolean;
}

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number };
}

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	provider: string;
	model: string;
	usage: Usage;
	stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
	errorMessage?: string;
	timestamp: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	isError: boolean;
	timestamp: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

/** Opaque custom message (MCP capability hints, etc.) — hidden from the transcript. */
export interface CustomMessage {
	role: "custom";
	customType: string;
	content: string;
	display: boolean;
	timestamp: number;
}

// ============================================================================
// Model info
// ============================================================================

export interface ModelInfo {
	id: string;
	provider: string;
	name?: string;
	reasoning?: boolean;
	[key: string]: unknown;
}

// ============================================================================
// Commands (client -> server), one JSON object per text frame
// ============================================================================

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type RpcCommand =
	| { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
	| { id?: string; type: "steer"; message: string; images?: ImageContent[] }
	| { id?: string; type: "follow_up"; message: string; images?: ImageContent[] }
	| { id?: string; type: "abort" }
	| { id?: string; type: "new_session"; parentSession?: string }
	| { id?: string; type: "get_state" }
	| { id?: string; type: "set_model"; provider: string; modelId: string }
	| { id?: string; type: "cycle_model" }
	| { id?: string; type: "get_available_models" }
	| { id?: string; type: "set_thinking_level"; level: ThinkingLevel }
	| { id?: string; type: "cycle_thinking_level" }
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }
	| { id?: string; type: "bash"; command: string }
	| { id?: string; type: "abort_bash" }
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "list_sessions" }
	| { id?: string; type: "set_session_name"; name: string }
	| { id?: string; type: "get_messages" }
	| { id?: string; type: "get_commands" };

// ============================================================================
// Session list (list_sessions response)
// ============================================================================

export interface RpcSessionListEntry {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
}

// ============================================================================
// Slash commands (get_commands response)
// ============================================================================

export interface RpcSlashCommand {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
	category?: string;
}

// ============================================================================
// Session state (get_state response)
// ============================================================================

export interface RpcSessionState {
	model?: ModelInfo;
	thinkingLevel: ThinkingLevel;
	agentLoopFramework: string;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	lastResult?: { success?: boolean; error?: string; [key: string]: unknown };
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
}

// ============================================================================
// Responses (server -> client)
// ============================================================================

export interface RpcSuccessResponse {
	id?: string;
	type: "response";
	command: string;
	success: true;
	data?: unknown;
}

export interface RpcErrorResponse {
	id?: string;
	type: "response";
	command: string;
	success: false;
	error: string;
}

export type RpcResponse = RpcSuccessResponse | RpcErrorResponse;

// ============================================================================
// Extension UI requests (server -> client)
// ============================================================================

export type RpcExtensionUIRequest =
	| { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "input"; title: string; placeholder?: string; timeout?: number }
	| { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
	| { type: "extension_ui_request"; id: string; method: "openExternalEditor"; title?: string; filePath: string }
	| { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
	| { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText: string | undefined }
	| { type: "extension_ui_request"; id: string; method: "setWidget"; widgetKey: string; widgetLines: string[] | undefined; widgetPlacement?: "aboveEditor" | "belowEditor" }
	| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
	| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string };

export type RpcExtensionUIResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true };

// ============================================================================
// Agent events (server -> client, broadcast)
// ============================================================================

export type AgentEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[] }
	| { type: "agent_result"; success?: boolean; error?: string; [key: string]: unknown }
	| { type: "turn_start" }
	| { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent?: unknown }
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown }
	| { type: "session_state_changed"; state: "idle" | "running" | "compacting" | "retrying"; timestamp: number }
	| { type: "auto_compaction_start"; reason: string }
	| { type: "auto_compaction_end"; result: unknown; aborted: boolean; willRetry: boolean; errorMessage?: string }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number; errorMessage: string }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
	| { type: "sdk:mcp_ready"; toolCount: number; tools: string[]; mcpTools: string[] }
	| { type: "sdk:error"; source: string; error: unknown }
	| { type: "sub_agent_start"; subAgentId: string; agentType: string; description: string }
	| { type: "sub_agent_end"; subAgentId: string; success: boolean }
	| { type: "debug"; level: string; source: string; message: string };

/** Every message the remote server pushes over the WebSocket. */
export type RpcServerMessage =
	| RpcResponse
	| RpcExtensionUIRequest
	| AgentEvent
	| { type: "extension_error"; extensionPath: string; event: string; error: string };

// ============================================================================
// Deep link (catui://connect?endpoint=...&token=...&name=...)
// ============================================================================

export interface ConnectParams {
	endpoint: string;
	token: string;
	name?: string;
}
