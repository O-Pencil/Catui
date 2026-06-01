/**
 * [WHO]: Provides ExtensionEventBridge, ExtensionEventBridgeDeps
 * [FROM]: Depends on agent-core AgentEvent, extensions-host event types, and ExtensionRunner
 * [TO]: Consumed by core/runtime/agent-session.ts for extension-facing event fanout
 * [HERE]: core/runtime/event-bridge.ts - narrow extension event mapping extracted from AgentSession
 *
 * Extracted from AgentSession (P4.7 / AS07). This bridge owns only AgentEvent ->
 * extension event mapping and extension turn indexing. AgentSession keeps public
 * subscribe(), session persistence, retry/compaction ordering, and Soul lifecycle work.
 */

import type { AgentEvent } from "@pencil-agent/agent-core";
import {
  type AgentResultEvent,
  type ExtensionRunner,
  type MessageEndEvent,
  type MessageStartEvent,
  type MessageUpdateEvent,
  type ToolExecutionEndEvent,
  type ToolExecutionStartEvent,
  type ToolExecutionUpdateEvent,
  type TurnEndEvent,
  type TurnStartEvent,
} from "../extensions-host/index.js";

export interface ExtensionEventBridgeDeps {
  getExtensionRunner: () => ExtensionRunner | undefined;
}

export class ExtensionEventBridge {
  private _turnIndex = 0;

  constructor(private readonly deps: ExtensionEventBridgeDeps) {}

  async emitExtensionEvent(event: AgentEvent): Promise<void> {
    const runner = this.deps.getExtensionRunner();
    if (!runner) return;

    if (event.type === "agent_start") {
      this._turnIndex = 0;
      await runner.emit({ type: "agent_start" });
    } else if (event.type === "agent_result") {
      const extensionEvent: AgentResultEvent = { ...event };
      await runner.emit(extensionEvent);
    } else if (event.type === "turn_start") {
      const extensionEvent: TurnStartEvent = {
        type: "turn_start",
        turnIndex: this._turnIndex,
        timestamp: Date.now(),
      };
      await runner.emit(extensionEvent);
    } else if (event.type === "turn_end") {
      const extensionEvent: TurnEndEvent = {
        type: "turn_end",
        turnIndex: this._turnIndex,
        message: event.message,
        toolResults: event.toolResults,
      };
      await runner.emit(extensionEvent);
      this._turnIndex++;
    } else if (event.type === "message_start") {
      const extensionEvent: MessageStartEvent = {
        type: "message_start",
        message: event.message,
      };
      await runner.emit(extensionEvent);
    } else if (event.type === "message_update") {
      const extensionEvent: MessageUpdateEvent = {
        type: "message_update",
        message: event.message,
        assistantMessageEvent: event.assistantMessageEvent,
      };
      await runner.emit(extensionEvent);
    } else if (event.type === "message_end") {
      const extensionEvent: MessageEndEvent = {
        type: "message_end",
        message: event.message,
      };
      await runner.emit(extensionEvent);
    } else if (event.type === "tool_execution_start") {
      const extensionEvent: ToolExecutionStartEvent = {
        type: "tool_execution_start",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };
      await runner.emit(extensionEvent);
    } else if (event.type === "tool_execution_update") {
      const extensionEvent: ToolExecutionUpdateEvent = {
        type: "tool_execution_update",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        partialResult: event.partialResult,
      };
      await runner.emit(extensionEvent);
    } else if (event.type === "tool_execution_end") {
      const extensionEvent: ToolExecutionEndEvent = {
        type: "tool_execution_end",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      };
      await runner.emit(extensionEvent);
    }
  }
}
