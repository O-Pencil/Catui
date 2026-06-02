/**
 * [WHO]: Provides SessionLifecycleController — session identity-change choreography
 * [FROM]: Depends on agent-core (ThinkingLevel), extensions-host session hook result types,
 *         session-manager (SessionManager type), and ./session-context
 * [TO]: Consumed by core/runtime/agent-session.ts (constructs one, delegates newSession()/switchSession()/fork())
 * [HERE]: core/runtime/agent-session.ts split (AS08) — session identity transitions
 *
 * Extracted from AgentSession (AS08/AS11). Owns the new/switch/fork choreography: before/after extension
 * hooks, agent disconnect/abort/reset, pending-queue clearing, session-manager transition, message
 * rebuild, and (on resume) model/thinking restoration delegated through the context to
 * ModelController. Behavior is identical to the former AgentSession methods.
 */

import type { ThinkingLevel } from "@pencil-agent/agent-core";
import type {
  SessionBeforeForkResult,
  SessionBeforeSwitchResult,
} from "../extensions-host/index.js";
import type { SessionManager } from "../session/session-manager.js";
import type { SessionLifecycleControllerContext } from "./session-context.js";

export interface NewSessionOptions {
  parentSession?: string;
  setup?: (sessionManager: SessionManager) => Promise<void>;
}

export interface ForkResult {
  selectedText: string;
  cancelled: boolean;
}

export class SessionLifecycleController {
  constructor(private readonly ctx: SessionLifecycleControllerContext) {}

  /**
   * Start a new session, optionally with initial messages and parent tracking.
   * Listeners are preserved and continue receiving events.
   * @returns true if completed, false if cancelled by an extension
   */
  async newSession(options?: NewSessionOptions): Promise<boolean> {
    const previousSessionFile = this.ctx.getSessionFile();

    // Emit session_before_switch event with reason "new" (can be cancelled)
    const runner = this.ctx.getExtensionRunner();
    if (runner?.hasHandlers("session_before_switch")) {
      const result = (await runner.emit({
        type: "session_before_switch",
        reason: "new",
      })) as SessionBeforeSwitchResult | undefined;

      if (result?.cancel) {
        return false;
      }
    }

    this.ctx.disconnectFromAgent();
    await this.ctx.abortAgent();
    this.ctx.resetAgent();
    this.ctx.sessionNewSession(options?.parentSession);
    this.ctx.syncAgentSessionId();
    this.ctx.clearPendingQueues();

    this.ctx.appendThinkingLevelChange(this.ctx.getThinkingLevel());

    // Run setup callback if provided (e.g., to append initial messages)
    if (options?.setup) {
      await this.ctx.runSetup(options.setup);
      // Sync agent state with session manager after setup
      const sessionContext = this.ctx.buildSessionContext();
      this.ctx.replaceAgentMessages(sessionContext.messages);
    }

    this.ctx.reconnectToAgent();

    // Emit session_switch event with reason "new" to extensions
    if (runner) {
      await runner.emit({
        type: "session_switch",
        reason: "new",
        previousSessionFile,
      });
    }

    return true;
  }

  /**
   * Resume an existing session file: restore messages, model, and thinking level.
   * @returns true if completed, false if cancelled by an extension
   */
  async switchSession(sessionPath: string): Promise<boolean> {
    const previousSessionFile = this.ctx.getSessionFile();

    // Emit session_before_switch event (can be cancelled)
    const runner = this.ctx.getExtensionRunner();
    if (runner?.hasHandlers("session_before_switch")) {
      const result = (await runner.emit({
        type: "session_before_switch",
        reason: "resume",
        targetSessionFile: sessionPath,
      })) as SessionBeforeSwitchResult | undefined;

      if (result?.cancel) {
        return false;
      }
    }

    this.ctx.disconnectFromAgent();
    await this.ctx.abortAgent();
    this.ctx.clearPendingQueues();

    // Set new session
    this.ctx.sessionSetFile(sessionPath);
    this.ctx.syncAgentSessionId();

    // Reload messages
    const sessionContext = this.ctx.buildSessionContext();

    // Emit session_switch event to extensions
    if (runner) {
      await runner.emit({
        type: "session_switch",
        reason: "resume",
        previousSessionFile,
      });
    }

    this.ctx.replaceAgentMessages(sessionContext.messages);

    // Restore model if saved
    if (sessionContext.model) {
      const availableModels = this.ctx.getAvailableModels();
      const match = availableModels.find(
        (m) => m.provider === sessionContext.model!.provider && m.id === sessionContext.model!.modelId,
      );
      if (match) {
        await this.ctx.restoreModel(match);
      }
    }

    const hasThinkingEntry = this.ctx.getBranch().some((entry) => entry.type === "thinking_level_change");
    this.ctx.restoreThinkingLevel({
      hasThinkingEntry,
      sessionThinkingLevel: sessionContext.thinkingLevel as ThinkingLevel,
      defaultThinkingLevel: this.ctx.getDefaultThinkingLevel(),
    });

    this.ctx.reconnectToAgent();
    return true;
  }

  /**
   * Create a new session identity from a user-message branch point.
   * @returns selected user text plus cancellation state
   */
  async fork(entryId: string): Promise<ForkResult> {
    const previousSessionFile = this.ctx.getSessionFile();
    const selectedEntry = this.ctx.getEntry(entryId);

    if (
      !selectedEntry ||
      selectedEntry.type !== "message" ||
      selectedEntry.message.role !== "user"
    ) {
      throw new Error("Invalid entry ID for forking");
    }

    const selectedText = this.ctx.extractUserMessageText(
      selectedEntry.message.content,
    );
    let skipConversationRestore = false;

    const runner = this.ctx.getExtensionRunner();
    if (runner?.hasHandlers("session_before_fork")) {
      const result = (await runner.emit({
        type: "session_before_fork",
        entryId,
      })) as SessionBeforeForkResult | undefined;

      if (result?.cancel) {
        return { selectedText, cancelled: true };
      }
      skipConversationRestore = result?.skipConversationRestore ?? false;
    }

    this.ctx.clearPendingNextTurnMessages();

    if (!selectedEntry.parentId) {
      this.ctx.sessionNewSession(previousSessionFile);
    } else {
      this.ctx.sessionCreateBranchedSession(selectedEntry.parentId);
    }
    this.ctx.syncAgentSessionId();

    const sessionContext = this.ctx.buildSessionContext();

    if (runner) {
      await runner.emit({
        type: "session_fork",
        previousSessionFile,
      });
    }

    if (!skipConversationRestore) {
      this.ctx.replaceAgentMessages(sessionContext.messages);
    }

    return { selectedText, cancelled: false };
  }
}
