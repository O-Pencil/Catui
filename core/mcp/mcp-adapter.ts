/**
 * [WHO]: createMCPTool(), loadMCPTools(), getMCPToolDisplayName()
 * [FROM]: Depends on extensions, mcp-client, mcp-guidance
 * [TO]: Consumed by core/mcp/index.ts, core/mcp/mcp-manager.ts
 * [HERE]: core/mcp/mcp-adapter.ts - adapts MCP tools to Catui tool system
 */
import type { ToolDefinition } from "../extensions-host/index.js";
import type { MCPClient } from "./mcp-client.js";
import type { MCPTool } from "./mcp-types.js";
import { formatGuidanceMessage, getAPIKeyGuidance } from "./mcp-guidance.js";
import { getMcpServerHint } from "./mcp-server-hints.js";
import {
  inferScenariosFromSchema,
  renderSchemaInferences,
} from "./mcp-schema-inference.js";

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
 * Build a short, scenario-oriented guidance string for the system prompt.
 *
 * Distinct from `description` (which tells the LLM what the tool *does*).
 * `guidance` tells the LLM *when* to reach for it, framed as a user-observable
 * intent. Server id and bare tool name (after `<server>/`) are passed through
 * so callers can refine later (e.g. schema-aware hints in
 * `mcp-tool-schema-aware-description`).
 *
 * Kept short on purpose: longer prose wastes prompt budget and dilutes the
 * signal across many tools.
 */
export function buildMcpToolGuidance(
  serverId: string,
  rawToolName: string,
  inputSchema?: unknown,
): string {
  const bareName = rawToolName.includes("/")
    ? rawToolName.slice(rawToolName.indexOf("/") + 1)
    : rawToolName;
  const serverHint = getMcpServerHint(serverId);
  const schemaFragment = renderSchemaInferences(
    inferScenariosFromSchema(inputSchema),
  );
  const schemaClause = schemaFragment ? ` ${schemaFragment}` : "";
  return [
    `Use mcp_${serverId}_${bareName} when the user's request matches the MCP server "${serverId}" — typically ${serverHint}.`,
    `Prefer this over read/bash approximations whenever the task targets ${serverId}.${schemaClause}`,
  ].join(" ");
}

/**
 * Build a scenario-oriented description suffix.
 *
 * `description` keeps the upstream tool's own wording as the leading clause so
 * callers that rely on its semantics (e.g. /mcp tools list, mcp guidance)
 * still see the original text. The suffix adds a one-line "use when…" pointer
 * that nudges the LLM toward recognizing user-query → MCP-tool matches it
 * might otherwise miss.
 */
function buildMcpDescriptionSuffix(
  serverId: string,
  inputSchema?: unknown,
): string {
  const serverHint = getMcpServerHint(serverId);
  const schemaFragment = renderSchemaInferences(
    inferScenariosFromSchema(inputSchema),
  );
  const schemaClause = schemaFragment ? ` ${schemaFragment}` : "";
  return ` Use this when the user asks about ${serverHint}; it routes through MCP server "${serverId}".${schemaClause}`;
}

/**
 * Create a Catui ToolDefinition from an MCP tool definition
 */
export function createMCPTool(
  mcpClient: MCPClient,
  mcpTool: MCPTool,
): ToolDefinition {
  const rawToolName = mcpTool.name; // Full name like "filesystem/read"
  const toolName = toSafeToolName(rawToolName);
  const [serverId] = rawToolName.split("/");
  const baseDescription = mcpTool.description ?? "(no description from MCP server)";

  return {
    name: toolName,
    label: rawToolName,
    description: `${baseDescription}${buildMcpDescriptionSuffix(
      serverId,
      mcpTool.inputSchema,
    )} (MCP: ${rawToolName})`,
    guidance: buildMcpToolGuidance(serverId, rawToolName, mcpTool.inputSchema),
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

        // Format tool result for Catui
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
 * Load all MCP tools as Catui ToolDefinitions
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
