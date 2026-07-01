/**
 * [WHO]: buildMcpCapabilitiesHint(), MCP_CAPABILITIES_CUSTOM_TYPE
 * [FROM]: Depends on ToolDefinition (type-only).
 * [TO]: Consumed by core/runtime/agent-session.ts:warmupMcpTools to inject a
 *       one-shot system hint message into the session after MCP tools are
 *       loaded.
 * [HERE]: core/mcp/mcp-capabilities-hint.ts - render the MCP capabilities
 *         summary that gets persisted into the session as a CustomMessage so
 *         the LLM sees it at the start of every subsequent turn.
 *
 * The hint is intentionally distinct from the system prompt's "MCP Tools
 * Awareness" paragraph (added in system-prompt-mcp-section). The system
 * prompt version is fixed at session start; this hint is appended at the
 * moment MCP becomes ready, so if the user starts chatting before MCP
 * finishes loading they still get the signal in the very next turn rather
 * than waiting until the next system-prompt rebuild.
 */
import type { ToolDefinition } from "../extensions-host/index.js";

/**
 * Stable custom type used for the one-shot MCP capabilities hint CustomMessage.
 * Picked to be unique enough not to collide with other extension types
 * ("mcp.capabilities" is namespaced).
 */
export const MCP_CAPABILITIES_CUSTOM_TYPE = "mcp.capabilities";

/**
 * Maximum number of MCP capabilities to list in the hint before collapsing
 * to "+N more". Keeps the injected message short — long lists dilute signal.
 */
const MAX_LISTED = 8;

/**
 * Render the MCP capabilities hint body. The output is a short markdown-ish
 * paragraph intended to be persisted as a CustomMessage (role: "custom",
 * customType: MCP_CAPABILITIES_CUSTOM_TYPE). `convertToLlm` will turn it
 * into a user-role message that the LLM sees at the top of its context.
 *
 * Input tools may be the full ToolDefinition[]; we only need the name and
 * description (description already includes scenario phrases thanks to
 * mcp-tool-description-scenaric + mcp-tool-schema-aware-description).
 */
export function buildMcpCapabilitiesHint(tools: readonly ToolDefinition[]): string {
  if (tools.length === 0) return "";

  const lines: string[] = [];
  lines.push(
    "[MCP capabilities loaded] The following MCP-powered tools are now available. Use the matching `mcp_*` tool whenever the user's request fits its description, instead of approximating with bash/read/curl. You do NOT need to call any of these unless the task matches; this is just an awareness reminder.",
  );

  const listed = tools.slice(0, MAX_LISTED);
  for (const tool of listed) {
    // description is already long (~200-300 chars with scenario phrases);
    // truncate at sentence boundary when possible to keep the hint compact.
    const desc = tool.description ?? "";
    const oneSentence = desc.split(". ").slice(0, 2).join(". ") + (desc.includes(".") ? "." : "");
    lines.push(`- ${tool.name}: ${oneSentence.length > 0 ? oneSentence : desc.slice(0, 160)}`);
  }
  if (tools.length > MAX_LISTED) {
    lines.push(`- (+${tools.length - MAX_LISTED} more — see /mcp tools for the full list)`);
  }
  return lines.join("\n");
}