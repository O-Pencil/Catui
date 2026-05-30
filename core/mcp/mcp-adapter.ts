/**
 * [WHO]: createMCPTool(), loadMCPTools(), getMCPToolDisplayName()
 * [FROM]: Depends on extensions, mcp-client, mcp-guidance
 * [TO]: Consumed by core/mcp/index.ts, core/mcp/mcp-manager.ts
 * [HERE]: core/mcp/mcp-adapter.ts - adapts MCP tools to NanoPencil tool system
 */
import type { ToolDefinition } from "../extensions-host/index.js";
import type { MCPClient, MCPTool } from "./mcp-client.js";
import { formatGuidanceMessage, getAPIKeyGuidance } from "./mcp-guidance.js";

function toSafeToolName(fullName: string): string {
  const normalized = `mcp_${fullName.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  if (normalized.length <= 60) return normalized;

  let hash = 0;
  for (let i = 0; i < fullName.length; i++) {
    hash = (hash * 31 + fullName.charCodeAt(i)) | 0;
  }
  const suffix = Math.abs(hash).toString(36);
  return `${normalized.slice(0, 50)}_${suffix}`;
}

/**
 * Create a NanoPencil ToolDefinition from an MCP tool definition
 */
export function createMCPTool(
  mcpClient: MCPClient,
  mcpTool: MCPTool,
): ToolDefinition {
  const rawToolName = mcpTool.name; // Full name like "filesystem/read"
  const toolName = toSafeToolName(rawToolName);
  const [serverId] = rawToolName.split("/");

  return {
    name: toolName,
    label: rawToolName,
    description: `${mcpTool.description} (MCP: ${rawToolName})`,
    // Use TypeBox Object schema with any properties since MCP tools have dynamic schemas
    parameters:
      (mcpTool.inputSchema as any) ??
      ({
        type: "object",
        properties: {},
        additionalProperties: true,
      } as any),

    async execute(
      toolCallId: string,
      params: Record<string, any>,
      signal: AbortSignal | undefined,
      onUpdate: ((details: any) => void) | undefined,
      ctx: any,
    ) {
      try {
        const result = await mcpClient.callTool(rawToolName, params);

        if (result.error) {
          // Check if error is due to missing API key and provide guidance
          const guidance = getAPIKeyGuidance(serverId);
          if (guidance && result.error?.toLowerCase().includes("key")) {
            return {
              content: [
                { type: "text", text: formatGuidanceMessage(guidance, true) },
              ],
              details: { error: result.error },
            };
          }

          return {
            content: [
              {
                type: "text",
              text: result.content.map((c) => c.text || "").join("\n"),
            },
          ],
          details: { error: result.error },
          };
        }

        // Format tool result for NanoPencil
        const output = result.content
          .map((c) => {
            if (c.type === "text") {
              return c.text || "";
            } else if (c.type === "image") {
              return `[Image: ${c.data?.uri || "unknown"}]`;
            } else if (c.type === "resource") {
              return `[Resource: ${JSON.stringify(c.data)}]`;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text", text: output }],
          details: undefined,
        };
      } catch (error) {
        // Check if error is related to missing API key and provide guidance
        const guidance = getAPIKeyGuidance(serverId);
        if (guidance && String(error).toLowerCase().includes("key")) {
          return {
            content: [
              { type: "text", text: formatGuidanceMessage(guidance, true) },
            ],
            details: {
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }

        return {
          content: [{ type: "text", text: `Failed to call MCP tool ${rawToolName}` }],
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}

/**
 * Load all MCP tools as NanoPencil ToolDefinitions
 */
export async function loadMCPTools(
  mcpClient: MCPClient,
): Promise<ToolDefinition[]> {
  const mcpTools = await mcpClient.listTools();

  return mcpTools.map((mcpTool) => createMCPTool(mcpClient, mcpTool));
}

/**
 * Get a human-readable display name for an MCP tool
 */
export function getMCPToolDisplayName(mcpTool: MCPTool): string {
  if (mcpTool.displayName) {
    return mcpTool.displayName;
  }

  const [serverId, ...nameParts] = mcpTool.name.split("/");
  const toolName = nameParts.join("/");

  return `${serverId}/${toolName}`;
}
