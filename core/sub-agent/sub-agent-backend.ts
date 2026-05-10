/**
 * [WHO]: InProcessSubAgentBackend class - in-process SubAgent backend
 * [FROM]: Depends on core/runtime/sdk, ./sub-agent-types
 * [TO]: Consumed by ./sub-agent-runtime, ./index.ts
 * [HERE]: core/sub-agent/sub-agent-backend.ts - in-process SubAgent implementation
 */

import { createAgentSession, type CreateAgentSessionOptions } from "../runtime/sdk.js";
import type { AgentMessage } from "@pencil-agent/agent-core";
import type { AgentSessionEvent } from "../runtime/agent-session.js";
import type { SubAgentBackend, SubAgentEvent, SubAgentHandle, SubAgentSpec, SubAgentResult } from "./sub-agent-types.js";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

/**
 * In-process SubAgent backend.
 * Wraps createAgentSession() to run SubAgent in the same process.
 */
export class InProcessSubAgentBackend implements SubAgentBackend {
  async spawn(spec: SubAgentSpec): Promise<SubAgentHandle> {
    const id = crypto.randomUUID();
    const prompt = await buildPromptWithContextFiles(spec);

    // Create an internal AbortController that can be triggered by external signal or timeout
    const internalAbortController = new AbortController();

    // Forward external signal abort to internal controller
    const signalHandler = () => {
      if (!internalAbortController.signal.aborted) {
        internalAbortController.abort();
      }
    };
    spec.signal.addEventListener("abort", signalHandler);

    // Create agent session with our internal signal
    const options: CreateAgentSessionOptions = {
      cwd: spec.cwd,
      tools: spec.tools,
      signal: internalAbortController.signal,
      model: spec.model,
    };

    const { session } = await createAgentSession(options);
    const unsubscribe = session.subscribe((event) => {
      const subAgentEvent = toSubAgentEvent(id, event);
      if (subAgentEvent) {
        spec.onEvent?.(subAgentEvent);
      }
    });
    const timeoutMs = spec.timeoutMs;

    let status: "running" | "done" | "aborted" | "error" = "running";
    let result: SubAgentResult | undefined;

    // Set up timeout if specified
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) {
      timeoutId = setTimeout(() => {
        if (status === "running") {
          internalAbortController.abort();
        }
      }, timeoutMs);
    }

    // Start the prompt
    const promptPromise = (async () => {
      try {
        spec.onEvent?.({ type: "agent_start", subAgentId: id, timestamp: Date.now() });
        await session.prompt(prompt, {
          images: spec.images,
        });
        status = "done";

        // Extract the last assistant message as the result
        const assistantMessages = session.messages.filter(isAssistantMessage);
        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        const responseText = lastAssistant ? extractTextFromContent(lastAssistant.content) : "";

        result = {
          success: true,
          response: responseText,
        };
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          status = "aborted";
          result = {
            success: false,
            error: "Aborted",
          };
        } else {
          status = "error";
          result = {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      } finally {
        if (spec.exitHook && result) {
          try {
            await spec.exitHook(result);
          } catch (error: unknown) {
            status = "error";
            result = {
              success: false,
              error: `exitHook failed: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        // Clean up signal handler
        spec.signal.removeEventListener("abort", signalHandler);
        unsubscribe();
        spec.onEvent?.({
          type: "agent_end",
          subAgentId: id,
          timestamp: Date.now(),
          success: result?.success ?? false,
          error: result?.error,
        });
      }
    })();

    return {
      id,
      get status() {
        return status;
      },
      async result(): Promise<SubAgentResult> {
        await promptPromise;
        return (
          result ?? {
            success: false,
            error: "No result available",
          }
        );
      },
      async abort(): Promise<void> {
        internalAbortController.abort();
        await session.abort();
      },
      async terminate(): Promise<void> {
        internalAbortController.abort();
        await session.abort();
      },
    };
  }
}

function isAssistantMessage(message: AgentMessage): message is AgentMessage & { role: "assistant"; content: unknown } {
  return message.role === "assistant" && "content" in message;
}

function toSubAgentEvent(subAgentId: string, event: AgentSessionEvent): SubAgentEvent | undefined {
  const timestamp = Date.now();
  switch (event.type) {
    case "message_update":
      return {
        type: "message_update",
        subAgentId,
        timestamp,
        text: extractMessageText(event.message),
        deltaType: event.assistantMessageEvent.type,
      };
    case "message_end":
      return {
        type: "message_end",
        subAgentId,
        timestamp,
        text: extractMessageText(event.message),
      };
    case "tool_execution_start":
      return {
        type: "tool_start",
        subAgentId,
        timestamp,
        toolName: event.toolName,
        args: event.args,
      };
    case "tool_execution_update":
      return {
        type: "tool_update",
        subAgentId,
        timestamp,
        toolName: event.toolName,
        partialResult: event.partialResult,
      };
    case "tool_execution_end":
      return {
        type: "tool_end",
        subAgentId,
        timestamp,
        toolName: event.toolName,
        isError: event.isError,
      };
    default:
      return undefined;
  }
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: "text"; text: string } =>
        typeof part === "object" && part !== null && "type" in part && part.type === "text" && typeof (part as { text?: unknown }).text === "string"
      )
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

function extractMessageText(message: unknown): string {
  if (typeof message !== "object" || message === null || !("content" in message)) {
    return "";
  }
  return extractTextFromContent((message as { content?: unknown }).content);
}

async function buildPromptWithContextFiles(spec: SubAgentSpec): Promise<string> {
  if (!spec.contextFiles?.length) {
    return spec.prompt;
  }

  const chunks: string[] = [];
  for (const filePath of spec.contextFiles) {
    const absolutePath = isAbsolute(filePath) ? filePath : resolve(spec.cwd, filePath);
    try {
      const content = await readFile(absolutePath, "utf8");
      chunks.push(`### ${filePath}\n\`\`\`\n${content}\n\`\`\``);
    } catch (error: unknown) {
      chunks.push(
        `### ${filePath}\n(unavailable: ${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  return [
    "The following files are injected as current task context. Treat them as read-only context unless the task instructions explicitly allow updates.",
    "",
    ...chunks,
    "",
    spec.prompt,
  ].join("\n");
}
