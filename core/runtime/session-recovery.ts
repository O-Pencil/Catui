/**
 * [WHO]: ParsedSkillBlock, parseSkillBlock(), pruneRecoverableErrorTail()
 * [FROM]: Depends on agent-core (AgentMessage), ai (AssistantMessage)
 * [TO]: Consumed by agent-session.ts (public re-export), session-compaction-coordinator.ts, test/agent-session-recovery-tail.test.ts
 * [HERE]: core/runtime/session-recovery.ts - pure skill-block parsing + recoverable error-tail pruning, no session state
 */
import type { AgentMessage } from "@catui/agent-core";
import type { AssistantMessage } from "@catui/ai/types";

// ============================================================================
// Skill Block Parsing
// ============================================================================

/** Parsed skill block from a user message */
export interface ParsedSkillBlock {
  name: string;
  location: string;
  content: string;
  userMessage: string | undefined;
}

/**
 * Parse a skill block from message text.
 * Returns null if the text doesn't contain a skill block.
 */
export function parseSkillBlock(text: string): ParsedSkillBlock | null {
  const match = text.match(
    /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/,
  );
  if (!match) return null;
  return {
    name: match[1],
    location: match[2],
    content: match[3],
    userMessage: match[4]?.trim() || undefined,
  };
}

export function pruneRecoverableErrorTail(
  messages: AgentMessage[],
  assistantMessage: AssistantMessage,
): AgentMessage[] {
  const interruptedToolCallIds = new Set(
    assistantMessage.content
      .filter((part) => part.type === "toolCall")
      .map((part) => part.id),
  );
  let end = messages.length;

  while (
    end > 0 &&
    isRecoverableTailToolResult(messages[end - 1], interruptedToolCallIds)
  ) {
    end--;
  }

  if (
    end > 0 &&
    isSameRecoverableAssistantMessage(messages[end - 1], assistantMessage)
  ) {
    end--;
  }

  return messages.slice(0, end);
}

function isRecoverableTailToolResult(
  message: AgentMessage,
  interruptedToolCallIds: ReadonlySet<string>,
): boolean {
  return (
    message.role === "toolResult" &&
    interruptedToolCallIds.has(message.toolCallId)
  );
}

function isSameRecoverableAssistantMessage(
  message: AgentMessage,
  assistantMessage: AssistantMessage,
): boolean {
  return (
    message.role === "assistant" &&
    message.stopReason === assistantMessage.stopReason &&
    message.timestamp === assistantMessage.timestamp &&
    message.provider === assistantMessage.provider &&
    message.model === assistantMessage.model &&
    message.api === assistantMessage.api &&
    message.errorMessage === assistantMessage.errorMessage
  );
}
