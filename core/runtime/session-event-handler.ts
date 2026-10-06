/**
 * [WHO]: SessionEventHandler owns synchronous journaling, ordered hook delivery and latched run failures
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
  abortAgent(): void;
}

export class SessionEventHandler {
  private _lastAssistantMessage: AssistantMessage | undefined;
  private _pending: Promise<void> = Promise.resolve();
  private _failure: { error: unknown } | undefined;
  private _cancelled = false;
  private readonly _extensionEventBridge: ExtensionEventBridge;
  constructor(private readonly context: SessionEventContext) {
    this._extensionEventBridge = new ExtensionEventBridge({ getExtensionRunner: context.getExtensionRunner });
  }
  /** UI and journal work completes before this synchronous Agent subscriber returns. */
  handle = (event: AgentEvent): void => {
    if (event.type === "agent_start") {
      this._failure = undefined;
      this._cancelled = false;
      this._lastAssistantMessage = undefined;
    }
    // Journal completed messages before asynchronous extension hooks. A model-request
    // boundary may commit a new working window as soon as the tool batch completes.
    if (event.type === "message_end" && !this._failure) {
      try {
        if (event.message.role === "custom") {
          this.context.appendCustomMessageEntry(
            event.message.customType, event.message.content, event.message.display, event.message.details,
          );
        } else if (event.message.role === "user" || event.message.role === "assistant" || event.message.role === "toolResult") {
          this.context.appendMessage(event.message);
        }
      } catch (error) {
        this.fail(error, "Session journal write failed");
      }
    }
    // When a user message starts, check if it's from either queue and remove it BEFORE emitting
    // This ensures the UI sees the updated queue state
    if (event.type === "message_start" && event.message.role === "user") {
      this.context.delivered(extractUserMessageText(event.message.content));
    }

    if (event.type === "message_end" && event.message.role === "assistant" && !this._failure) {
      this._lastAssistantMessage = event.message;
      if (event.message.stopReason !== "error") this.context.onSuccess();
    }
    const completedAssistant = event.type === "agent_end" ? this._lastAssistantMessage : undefined;
    if (event.type === "agent_end") this._lastAssistantMessage = undefined;

    // Rendering never waits for extension I/O. Lifecycle hooks run in dispatch order.
    this.context.emit(event);
    if (event.type === "message_update") {
      // Emit dedicated tool_input_delta for tool call argument streaming
      const ame = event.assistantMessageEvent;
      if (ame.type === "toolcall_delta") {
        const block = ame.partial.content[ame.contentIndex] as { id?: string; name?: string } | undefined;
        if (block?.id) {
          this.context.emit({ type: "tool_input_delta", toolCallId: block.id, toolName: block.name ?? "", delta: ame.delta });
        }
      }
    } else {
      // Emit session state change for GUI consumption
      if (event.type === "agent_start") {
        this.context.emit({ type: "session_state_changed", state: "running", timestamp: Date.now() });
      } else if (event.type === "agent_end") {
        this.context.emit({ type: "session_state_changed", state: "idle", timestamp: Date.now() });
      }
    }

    // Handle session persistence
    if (event.type === "tool_execution_start") {
      this.context.debug("verbose", "tool", "tool_start", { toolName: event.toolName, toolCallId: event.toolCallId });
    } else if (event.type === "tool_execution_end") {
      this.context.debug("verbose", "tool", "tool_end", { toolName: event.toolName, isError: event.isError });
    }

    // Avoid retaining every token delta when nobody consumes it.
    if (event.type === "message_update" && !this.context.getExtensionRunner()?.hasHandlers("message_update")) return;
    this._pending = this._pending.then(async () => {
      if (this._failure) return;
      await this._extensionEventBridge.emitExtensionEvent(event);
      if (event.type !== "agent_end" || this._failure || this._cancelled) return;
      if (completedAssistant) {
        if (this.context.isRetryableError(completedAssistant) && await this.context.handleError(completedAssistant)) return;
        await this.context.checkCompaction(completedAssistant);
      }
      // End hooks may initiate a new prompt, so they must not hold this queue.
      void this.context.getExtensionRunner()?.emit({ type: "agent_end", messages: event.messages })
        .catch(error => this.context.logError("[extension] agent_end event error", { error }));
    }).catch(error => this.fail(error, "Session event processing failed"));
  };

  /** Drain lifecycle work, including work appended while a recovery is finishing. */
  async waitForCompletion(): Promise<void> {
    let pending: Promise<void>;
    do {
      pending = this._pending;
      await pending;
    } while (pending !== this._pending);
  }

  throwIfFailed(): void {
    if (this._failure) throw this._failure.error;
  }

  cancelRecovery(): void {
    this._cancelled = true;
  }

  private fail(error: unknown, message: string): void {
    if (this._failure) return;
    this._failure = { error };
    this._lastAssistantMessage = undefined;
    this.context.abortAgent();
    this.context.logError(message, { error });
    this.context.emit({ type: "sdk:error", source: "session", error });
  }
}
