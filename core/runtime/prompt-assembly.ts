/**
 * [WHO]: Provides buildRuntimeSystemPrompt(), getActiveBaseToolNames()
 * [FROM]: Depends on ResourceLoader for loaded prompts/context and prompt/system-prompt for rendering
 * [TO]: Consumed by core/runtime/agent-session.ts when refreshing the agent system prompt
 * [HERE]: core/runtime/prompt-assembly.ts - prompt input assembly extracted from AgentSession
 *
 * Extracted from AgentSession (P4.5). This module owns prompt resource assembly only.
 * Soul injection state and prompt application remain in AgentSession.
 */

import type { AgentTool } from "@catui/agent-core";
import type { ResourceLoader } from "../platform/config/resource-loader.js";
import { buildSystemPrompt } from "../prompt/system-prompt.js";

export interface RuntimeSystemPromptOptions {
  cwd: string;
  resourceLoader: ResourceLoader;
  toolNames: string[];
  baseToolRegistry: Map<string, AgentTool>;
  soulInjection?: string;
  /**
   * Names of currently active MCP-powered tools (prefix `mcp_`). When
   * provided and non-empty, the rendered system prompt gains an
   * "MCP Tools Awareness" section. Defaults to deriving from `toolNames`
   * so existing callers don't need to opt in.
   */
  mcpToolNames?: readonly string[];
}

export function buildRuntimeSystemPrompt(
  options: RuntimeSystemPromptOptions,
): string {
  const validToolNames = options.toolNames.filter((name) =>
    options.baseToolRegistry.has(name),
  );
  const mcpToolNames =
    options.mcpToolNames ?? options.toolNames.filter((n) => n.startsWith("mcp_"));
  const appendSystemPromptParts = options.resourceLoader.getAppendSystemPrompt();
  const appendSystemPrompt =
    appendSystemPromptParts.length > 0
      ? appendSystemPromptParts.join("\n\n")
      : undefined;

  return buildSystemPrompt({
    cwd: options.cwd,
    skills: options.resourceLoader.getSkills().skills,
    contextFiles: options.resourceLoader.getAgentsFiles().agentsFiles,
    customPrompt: options.resourceLoader.getSystemPrompt(),
    appendSystemPrompt,
    selectedTools: validToolNames,
    soulInjection: options.soulInjection,
    mcpToolNames,
  });
}

export function getActiveBaseToolNames(
  activeToolNames: string[],
  baseToolRegistry: Map<string, AgentTool>,
): string[] {
  return activeToolNames.filter((name) => baseToolRegistry.has(name));
}
