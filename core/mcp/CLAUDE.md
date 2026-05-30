# core/mcp/

> P2 | Parent: ../CLAUDE.md

Member List
mcp-config.ts: MCPConfig interface, loadMcpConfig(), saveMcpConfig(), listEnabledMCPServers(), MCP server configuration management, key invariant: configs stored in ~/.nanopencil/agent/mcp.json
figma-auth.ts: registerFigmaMcpOAuthProvider(), Figma OAuth integration for MCP servers, handles OAuth flow and credential storage
mcp-types.ts: MCPServerConfig, MCPTool, MCPToolResult shared contracts for MCP client/config/adapter boundaries
mcp-client.ts: MCPClient class, MCP client for JSON-RPC over stdio, key invariant: one client per MCP server process
mcp-guidance.ts: APIKeyGuidance interface, getAPIKeyGuidance(), formatGuidanceMessage(), getMissingKeyServers(), requiresAPIKey(), API key guidance for MCP servers
mcp-adapter.ts: createMCPTool(), loadMCPTools(), getMCPToolDisplayName(), adapts MCP tools to NanoPencil tool system, converts MCP tool schema to ToolDefinition
index.ts: MCP module barrel exports, re-exports MCPClient, MCP contracts, createMCPTool, loadMCPTools, guidance utilities
mcp-manager.ts: MCPManager class, MCP server lifecycle and tool integration, manages client connections and tool registration

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent CLAUDE.md
