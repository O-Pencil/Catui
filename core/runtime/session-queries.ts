/**
 * [WHO]: SessionStats and pure session/context queries
 * [FROM]: Agent/AI message types and session compaction accounting
 * [TO]: AgentSession and regression tests
 * [HERE]: core/runtime/session-queries.ts - pure snapshot queries
 */
import type { AgentMessage } from "@catui/agent-core";
import type { AssistantMessage, Model } from "@catui/ai/types";
import type { ContextUsage } from "../extensions-host/index.js";
import { getLatestCompactionEntry, type SessionEntry } from "../session/session-manager.js";
import { calculateContextTokens, estimateContextTokens } from "../session/compaction/index.js";

/** Session statistics for /session command */
export interface SessionStats {
  sessionFile: string | undefined;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
}

export function getSessionStats(messages: AgentMessage[], sessionFile: string | undefined, sessionId: string): SessionStats {
  const state = { messages };
  const userMessages = state.messages.filter((m) => m.role === "user").length;
  const assistantMessages = state.messages.filter(
    (m) => m.role === "assistant",
  ).length;
  const toolResults = state.messages.filter(
    (m) => m.role === "toolResult",
  ).length;

  let toolCalls = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalCost = 0;

  for (const message of state.messages) {
    if (message.role === "assistant") {
      const assistantMsg = message as AssistantMessage;
      toolCalls += assistantMsg.content.filter(
        (c) => c.type === "toolCall",
      ).length;
      totalInput += assistantMsg.usage.input;
      totalOutput += assistantMsg.usage.output;
      totalCacheRead += assistantMsg.usage.cacheRead;
      totalCacheWrite += assistantMsg.usage.cacheWrite;
      totalCost += assistantMsg.usage.cost.total;
    }
  }

  return {
    sessionFile,
    sessionId,
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages: state.messages.length,
    tokens: {
      input: totalInput,
      output: totalOutput,
      cacheRead: totalCacheRead,
      cacheWrite: totalCacheWrite,
      total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
    },
    cost: totalCost,
  };
}

export function getContextUsage(messages: AgentMessage[], model: Model<any> | undefined, branchEntries: SessionEntry[]): ContextUsage | undefined {
  if (!model) return undefined;

  const contextWindow = model.contextWindow ?? 0;
  if (contextWindow <= 0) return undefined;

  // After compaction, the last assistant usage reflects pre-compaction context size.
  // We can only trust usage from an assistant that responded after the latest compaction.
  // If no such assistant exists, context token count is unknown until the next LLM response.
  const latestCompaction = getLatestCompactionEntry(branchEntries);

  if (latestCompaction) {
    // Check if there's a valid assistant usage after the compaction boundary
    const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
    let hasPostCompactionUsage = false;
    for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
      const entry = branchEntries[i];
      if (entry.type === "message" && entry.message.role === "assistant") {
        const assistant = entry.message;
        if (
          assistant.stopReason !== "aborted" &&
          assistant.stopReason !== "error"
        ) {
          const contextTokens = calculateContextTokens(assistant.usage);
          if (contextTokens > 0) {
            hasPostCompactionUsage = true;
          }
          break;
        }
      }
    }

    if (!hasPostCompactionUsage) {
      return { tokens: null, contextWindow, percent: null };
    }
  }

  const estimate = estimateContextTokens(messages);
  const percent = (estimate.tokens / contextWindow) * 100;

  return {
    tokens: estimate.tokens,
    contextWindow,
    percent,
  };
}

export function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
  return typeof content === "string" ? content : content.filter(c => c.type === "text").map(c => c.text).join("");
}
