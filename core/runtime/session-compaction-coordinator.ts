/**
 * [WHO]: SessionCompactionCoordinator — loop-driven compaction decisions + in-loop model-error recovery
 * [FROM]: Depends on agent-core, ai/overflow, session/compaction (calculateContextTokens, shouldCompact),
 *         session-manager (getLatestCompactionEntry), ./session-recovery (pruneRecoverableErrorTail),
 *         ./session-context (SessionCompactionCoordinatorContext)
 * [TO]: Consumed by agent-session.ts (delegates check()/recoverModelErrorInLoop()/runAuto())
 * [HERE]: core/runtime/agent-session.ts split (AS04) — owns WHEN to compact (overflow/threshold) and the
 *         recoverable-tail retry decision; the compaction flow itself stays in compaction-controller.ts
 *
 * Extracted from AgentSession (AS04). Decision logic moved line-by-line; session state is reached through
 * the narrow SessionCompactionCoordinatorContext. Loop continuation (agent.continue kicks) remains owned
 * by AgentSession and is requested via the continueAgentLoop capability.
 */

import type {
  AgentMessage,
  AgentModelErrorRecoveryResult,
} from "@catui/agent-core";
import type { AssistantMessage } from "@catui/ai/types";
import { isContextOverflow } from "@catui/ai/overflow";
import { calculateContextTokens, shouldCompact } from "../session/compaction/index.js";
import { getLatestCompactionEntry } from "../session/session-manager.js";
import { pruneRecoverableErrorTail } from "./session-recovery.js";
import type { SessionCompactionCoordinatorContext } from "./session-context.js";

export class SessionCompactionCoordinator {
  constructor(private readonly ctx: SessionCompactionCoordinatorContext) {}

  /**
   * Check if compaction is needed and run it.
   * Called after agent_end and before prompt submission.
   *
   * Two cases:
   * 1. Overflow: LLM returned context overflow error, remove error message from agent state, compact, auto-retry
   * 2. Threshold: Context over threshold, compact, NO auto-retry (user continues manually)
   *
   * @param assistantMessage The assistant message to check
   * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
   */
  async check(
    assistantMessage: AssistantMessage,
    skipAbortedCheck = true,
  ): Promise<void> {
    const settings = this.ctx.getCompactionSettings();
    if (!settings.enabled) return;

    // Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
    if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return;

    const model = this.ctx.getModel();
    const contextWindow = model?.contextWindow ?? 0;

    // Skip overflow check if the message came from a different model.
    // This handles the case where user switched from a smaller-context model (e.g. opus)
    // to a larger-context model (e.g. codex) - the overflow error from the old model
    // shouldn't trigger compaction for the new model.
    const sameModel =
      model &&
      assistantMessage.provider === model.provider &&
      assistantMessage.model === model.id;

    // Skip overflow check if the error is from before a compaction in the current path.
    // This handles the case where an error was kept after compaction (in the "kept" region).
    // The error shouldn't trigger another compaction since we already compacted.
    // Example: opus fails → switch to codex → compact → switch back to opus → opus error
    // is still in context but shouldn't trigger compaction again.
    const compactionEntry = getLatestCompactionEntry(
      this.ctx.getBranch(),
    );
    const errorIsFromBeforeCompaction =
      compactionEntry !== null &&
      assistantMessage.timestamp <
        new Date(compactionEntry.timestamp).getTime();

    // Case 1: Overflow - LLM returned context overflow error
    if (
      sameModel &&
      !errorIsFromBeforeCompaction &&
      isContextOverflow(assistantMessage, contextWindow)
    ) {
      // Remove the error message from agent state (it IS saved to session for history,
      // but we don't want it in context for the retry)
      const messages = this.ctx.getAgentMessages();
      if (
        messages.length > 0 &&
        messages[messages.length - 1].role === "assistant"
      ) {
        this.ctx.replaceAgentMessages(messages.slice(0, -1));
      }
      await this.runAuto("overflow", true);
      return;
    }

    // Case 2: Threshold - turn succeeded but context is getting large
    // Skip if this was an error (non-overflow errors don't have usage data)
    if (assistantMessage.stopReason === "error") return;

    const contextTokens = calculateContextTokens(assistantMessage.usage);
    if (shouldCompact(contextTokens, contextWindow, settings)) {
      await this.runAuto("threshold", false);
    }
  }

  async recoverModelErrorInLoop(event: {
    message: AgentMessage;
    messages: AgentMessage[];
    errorSubtype: string;
    attempt: number;
  }): Promise<AgentModelErrorRecoveryResult> {
    const settings = this.ctx.getCompactionSettings();
    if (event.message.role !== "assistant") return { action: "stop" };

    const assistantMessage = event.message as AssistantMessage;
    if (event.errorSubtype !== "context_overflow") {
      if (!this.ctx.isRetryableError(assistantMessage)) {
        return { action: "stop" };
      }
      const shouldRetry =
        await this.ctx.handleErrorInLoop(assistantMessage);
      if (!shouldRetry) return { action: "stop" };
      const retryMessages = pruneRecoverableErrorTail(
        this.ctx.getAgentMessages(),
        assistantMessage,
      );
      this.ctx.replaceAgentMessages(retryMessages);
      return {
        action: "retry",
        messages: retryMessages,
        transition: {
          reason: "model_error_recovery",
          subtype: event.errorSubtype,
          attempt: event.attempt,
        },
      };
    }

    if (!settings.enabled) return { action: "stop" };

    const model = this.ctx.getModel();
    const contextWindow = model?.contextWindow ?? 0;
    const sameModel =
      model &&
      assistantMessage.provider === model.provider &&
      assistantMessage.model === model.id;
    if (!sameModel || !isContextOverflow(assistantMessage, contextWindow)) {
      return { action: "stop" };
    }

    const compactionEntry = getLatestCompactionEntry(
      this.ctx.getBranch(),
    );
    const errorIsFromBeforeCompaction =
      compactionEntry !== null &&
      assistantMessage.timestamp < new Date(compactionEntry.timestamp).getTime();
    if (errorIsFromBeforeCompaction) return { action: "stop" };

    const messages = this.ctx.getAgentMessages();
    this.ctx.replaceAgentMessages(
      pruneRecoverableErrorTail(messages, assistantMessage),
    );

    const recoveredMessages = await this.runAuto("overflow", true, {
      triggerContinue: false,
    });
    if (!recoveredMessages) return { action: "stop" };
    return {
      action: "retry",
      messages: recoveredMessages,
      transition: {
        reason: "model_error_recovery",
        subtype: event.errorSubtype,
        attempt: event.attempt,
      },
    };
  }

  /**
   * Internal: Run auto-compaction with events.
   */
  async runAuto(
    reason: "overflow" | "threshold",
    willRetry: boolean,
    options?: { triggerContinue?: boolean },
  ): Promise<AgentMessage[] | undefined> {
    const triggerContinue = options?.triggerContinue ?? true;
    const messages = await this.ctx.runAutoCompaction(reason, willRetry);
    if (messages === undefined) return undefined;

    // Loop continuation (owned by AgentSession): retry the failed turn or kick the queue.
    if (willRetry && triggerContinue) {
      const current = this.ctx.getAgentMessages();
      const lastMsg = current[current.length - 1];
      if (lastMsg?.role === "assistant" && (lastMsg as AssistantMessage).stopReason === "error") {
        this.ctx.replaceAgentMessages(current.slice(0, -1));
      }
      this.ctx.continueAgentLoop();
    } else if (!willRetry && this.ctx.hasQueuedMessages()) {
      // Auto-compaction can complete while follow-up/steering/custom messages are waiting.
      // Kick the loop so queued messages are actually delivered.
      this.ctx.continueAgentLoop();
    }
    return messages;
  }
}
