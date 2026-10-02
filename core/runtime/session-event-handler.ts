/**
 * [WHO]: SessionEventHandler owns event journaling/order and post-run recovery
 * [FROM]: ExtensionEventBridge, message types and named session capabilities
 * [TO]: AgentSession event subscription and reconnect
 * [HERE]: core/runtime/session-event-handler.ts - event lifecycle owner
 */
import type { AgentEvent } from "@catui/agent-core";
import type { AssistantMessage } from "@catui/ai/types";
import type { SessionManager } from "../session/session-manager.js";
import type { ExtensionRunner } from "../extensions-host/index.js";
import type { AgentSessionEvent } from "./session-events.js";
import { ExtensionEventBridge } from "./event-bridge.js";
import { extractUserMessageText } from "./session-queries.js";

export interface SessionEventContext {
  appendMessage: SessionManager["appendMessage"];
  appendCustomMessageEntry: SessionManager["appendCustomMessageEntry"];
  delivered(text: string): void;
  emit(event: AgentSessionEvent): void;
  getExtensionRunner(): ExtensionRunner | undefined;
  onSuccess(): void;
  isRetryableError(message: AssistantMessage): boolean;
  handleError(message: AssistantMessage): Promise<boolean>;
  checkCompaction(message: AssistantMessage): Promise<void>;
  debug(level: "basic" | "verbose", source: "tool", message: string, data: Record<string, unknown>): void;
  logError(message: string, data: Record<string, unknown>): void;
}

export class SessionEventHandler {
  private _lastAssistantMessage: AssistantMessage | undefined;
  private readonly _extensionEventBridge: ExtensionEventBridge;
  constructor(private readonly context: SessionEventContext) {
    this._extensionEventBridge = new ExtensionEventBridge({ getExtensionRunner: context.getExtensionRunner });
  }
  handle = async (event: AgentEvent): Promise<void> => {
    // Journal completed messages before asynchronous extension hooks. A model-request
    // boundary may commit a new working window as soon as the tool batch completes.
    if (event.type === "message_end") {
      if (event.message.role === "custom") {
        this.context.appendCustomMessageEntry(
          event.message.customType, event.message.content, event.message.display, event.message.details,
        );
      } else if (event.message.role === "user" || event.message.role === "assistant" || event.message.role === "toolResult") {
        this.context.appendMessage(event.message);
      }
    }
    // When a user message starts, check if it's from either queue and remove it BEFORE emitting
    // This ensures the UI sees the updated queue state
    if (event.type === "message_start" && event.message.role === "user") {
      this.context.delivered(extractUserMessageText(event.message.content));
    }

    // Notify all listeners (UI) first for responsive rendering,
    // then emit to extensions in parallel (they shouldn't block rendering).
    // For high-frequency streaming events (message_update), extensions run in background.
    if (event.type === "message_update") {
      // Streaming updates: emit to UI immediately, don't await extensions
      this.context.emit(event);
      // Emit dedicated tool_input_delta for tool call argument streaming
      const ame = event.assistantMessageEvent;
      if (ame.type === "toolcall_delta") {
        const block = ame.partial.content[ame.contentIndex] as { id?: string; name?: string } | undefined;
        if (block?.id) {
          this.context.emit({ type: "tool_input_delta", toolCallId: block.id, toolName: block.name ?? "", delta: ame.delta });
        }
      }
      this._extensionEventBridge.emitExtensionEvent(event).catch((err) => {
        this.context.logError("[extension] message_update event error", { error: err });
      });
    } else {
      // All other events: extensions run concurrently with UI notification
      const extensionPromise = this._extensionEventBridge.emitExtensionEvent(event);
      this.context.emit(event);
      // Emit session state change for GUI consumption
      if (event.type === "agent_start") {
        this.context.emit({ type: "session_state_changed", state: "running", timestamp: Date.now() });
      } else if (event.type === "agent_end") {
        this.context.emit({ type: "session_state_changed", state: "idle", timestamp: Date.now() });
      }
      await extensionPromise;
    }

    // Handle session persistence
    if (event.type === "tool_execution_start") {
      this.context.debug("verbose", "tool", "tool_start", { toolName: event.toolName, toolCallId: event.toolCallId });
    } else if (event.type === "tool_execution_end") {
      this.context.debug("verbose", "tool", "tool_end", { toolName: event.toolName, isError: event.isError });
    }

    if (event.type === "message_end") {
      // Track assistant message for auto-compaction (checked on agent_end)
      if (event.message.role === "assistant") {
        this._lastAssistantMessage = event.message;

        // Reset retry counter on successful assistant response
        const assistantMsg = event.message as AssistantMessage;
        if (assistantMsg.stopReason !== "error") {
          this.context.onSuccess();
        }
      }
    }

    // Check auto-retry and auto-compaction after agent completes
    if (event.type === "agent_end" && this._lastAssistantMessage) {
      const msg = this._lastAssistantMessage;
      this._lastAssistantMessage = undefined;

      // Check for retryable errors first (overloaded, rate limit, server errors)
      if (this.context.isRetryableError(msg)) {
        const didRetry = await this.context.handleError(msg);
        if (didRetry) return; // Retry was initiated, don't proceed to compaction
      }

      await this.context.checkCompaction(msg);
    }

    if (event.type === "agent_end" && this.context.getExtensionRunner()) {
      // Emit agent_end only after retry and compaction settle.
      // This lets post-run extensions react to a stable end state.
      void this.context.getExtensionRunner()!
        .emit({
          type: "agent_end",
          messages: event.messages,
        })
        .catch((err) => {
          this.context.logError("[extension] agent_end event error", { error: err });
        });
    }
  };

}
