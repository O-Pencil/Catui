/**
 * [WHO]: AgentSessionEvent, AgentSessionEventListener, mapSubAgentEvent()
 * [FROM]: Depends on agent-core (AgentEvent), session/compaction (CompactionResult), sub-agent (SubAgentEvent)
 * [TO]: Consumed by agent-session.ts (public re-export + _emit wiring), barrels core/index.ts and runtime.ts via re-export
 * [HERE]: core/runtime/session-events.ts - session event contract + SubAgentEvent mapping for TUI display
 */
import type { AgentEvent } from "@catui/agent-core";
import type { CompactionResult } from "../session/compaction/index.js";
import type { SubAgentEvent } from "../sub-agent/index.js";

/** Session-specific events that extend the core AgentEvent */
export type AgentSessionEvent =
  | AgentEvent
  | { type: "auto_compaction_start"; reason: "threshold" | "overflow" }
  | {
      type: "auto_compaction_end";
      result: CompactionResult | undefined;
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
    }
  | {
      type: "auto_retry_start";
      attempt: number;
      maxAttempts: number;
      delayMs: number;
      errorMessage: string;
    }
  | {
      type: "auto_retry_end";
      success: boolean;
      attempt: number;
      finalError?: string;
    }
  | {
      type: "sdk:error";
      source: "soul" | "mcp" | "eventbus";
      error: unknown;
    }
  | {
      // Emitted when deferred (non-blocking) MCP tool loading finishes and the
      // tools have been merged into the active runtime. Lets the UI surface a
      // "MCP ready" status without blocking startup. See warmupMcpTools().
      type: "sdk:mcp_ready";
      toolCount: number;
      /** Full list of active tool names at the time of emission. */
      tools: string[];
      /** Current model ID, if any. */
      model?: string;
      /** Names of MCP-powered tools (subset of tools[]). */
      mcpTools: string[];
    }
  // Sub-agent lifecycle events (forwarded from SubAgentEvent)
  | { type: "sub_agent_start"; subAgentId: string; agentType: string; description: string; isAsync: boolean; parentToolCallId?: string }
  | { type: "sub_agent_tool_start"; subAgentId: string; toolName: string; input?: unknown; parentToolCallId?: string }
  | { type: "sub_agent_tool_end"; subAgentId: string; toolName: string; isError: boolean; output?: unknown; durationMs?: number; parentToolCallId?: string }
  | { type: "sub_agent_end"; subAgentId: string; success: boolean; parentToolCallId?: string }
  | { type: "tool_input_delta"; toolCallId: string; toolName: string; delta: string }
  | { type: "session_state_changed"; state: "idle" | "running" | "compacting" | "retrying"; timestamp: number }
  | {
      type: "debug";
      level: "basic" | "verbose";
      source: "session" | "mcp" | "model" | "tool" | "resource" | "extension";
      message: string;
      data?: Record<string, unknown>;
      timestamp: number;
    };

/** Listener function for agent session events */
export type AgentSessionEventListener = (event: AgentSessionEvent) => void;

/** Map SubAgentEvent to AgentSessionEvent for TUI display. */
export function mapSubAgentEvent(event: SubAgentEvent): AgentSessionEvent | undefined {
  switch (event.type) {
    case "agent_start":
      return { type: "sub_agent_start", subAgentId: event.subAgentId, agentType: event.agentType, description: event.description, isAsync: event.isAsync, parentToolCallId: event.parentToolCallId };
    case "tool_start":
      return { type: "sub_agent_tool_start", subAgentId: event.subAgentId, toolName: event.toolName, input: event.args, parentToolCallId: event.parentToolCallId };
    case "tool_end":
      return { type: "sub_agent_tool_end", subAgentId: event.subAgentId, toolName: event.toolName, isError: event.isError, output: event.result, durationMs: event.durationMs, parentToolCallId: event.parentToolCallId };
    case "agent_end":
      return { type: "sub_agent_end", subAgentId: event.subAgentId, success: event.success, parentToolCallId: event.parentToolCallId };
    default:
      return undefined;
  }
}
