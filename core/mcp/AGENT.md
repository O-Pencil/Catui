# core/mcp/

> P2 | Parent: ../AGENT.md

Member List
mcp-config.ts: MCPConfig interface, loadMcpConfig(), saveMcpConfig(), listEnabledMCPServers(), MCP server configuration management, key invariant: configs stored in ~/.catui/agent/mcp.json
figma-auth.ts: registerFigmaMcpOAuthProvider(), Figma OAuth integration for MCP servers, handles OAuth flow and credential storage
mcp-types.ts: MCPServerConfig, MCPTool, MCPToolResult shared contracts for MCP client/config/adapter boundaries
mcp-client.ts: MCPClient class, MCP client for JSON-RPC over stdio, key invariant: one client per MCP server process
mcp-guidance.ts: APIKeyGuidance interface, getAPIKeyGuidance(), formatGuidanceMessage(), getMissingKeyServers(), requiresAPIKey(), API key guidance for MCP servers
mcp-server-hints.ts: MCP_SERVER_HINTS, getMcpServerScenarios(), getMcpServerHint(), per-server scenario vocabulary for guidance text consumed by mcp-adapter
mcp-schema-inference.ts: SCENARIO_RULES, inferScenariosFromSchema(), renderSchemaInferences(), inputSchema.properties field-name → scenario phrase inference, complements server-level hints at tool grain
mcp-capabilities-hint.ts: buildMcpCapabilitiesHint(), MCP_CAPABILITIES_CUSTOM_TYPE, renders one-shot MCP capability summary persisted as a CustomMessage by agent-session.warmupMcpTools
mcp-adapter.ts: createMCPTool(), loadMCPTools(), getMCPToolDisplayName(), adapts MCP tools to Catui tool system, converts MCP tool schema to ToolDefinition; emits scenario-aware guidance/description via mcp-server-hints
index.ts: MCP module barrel exports, re-exports MCPClient, MCP contracts, createMCPTool, loadMCPTools, guidance utilities
mcp-manager.ts: MCPManager class, MCP server lifecycle and tool integration, manages client connections and tool registration

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
