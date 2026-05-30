/**
 * [WHO]: MCPConfig, loadMcpConfig(), saveMcpConfig(), listEnabledMCPServers()
 * [FROM]: Depends on node:fs, node:path, node:os, config, mcp-client
 * [TO]: Consumed by core/index.ts, core/mcp/mcp-manager.ts, modes/interactive/interactive-mode.ts, extensions/builtin/mcp/index.ts
 * [HERE]: core/mcp/mcp-config.ts - MCP server configuration management
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { getAgentDir } from "../../config.js";
import { defaultAgentDirContext, type AgentDirContext } from "../agent-dir/agent-dir-context.js";
import type { MCPServerConfig } from "./mcp-client.js";

export interface MCPConfig {
  mcpServers: MCPServerConfig[];
}

const DEFAULT_MCP_CONFIG: MCPConfig = {
  mcpServers: [
    // ===== Core Tools (enabled by default) =====
    // Note: filesystem directory is dynamically set by MCPManager at runtime
    {
      id: "filesystem",
      name: "Filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "{cwd}"],
      enabled: true,
      transport: "stdio",
      toolTimeout: 30000,
    },
    {
      id: "fetch",
      name: "Fetch (Web Scraper)",
      command: "npx",
      args: ["-y", "@kazuph/mcp-fetch"],
      enabled: false,
      transport: "stdio",
      toolTimeout: 30000,
    },
    {
      id: "sequential-thinking",
      name: "Sequential Thinking",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      enabled: true,
      transport: "stdio",
      toolTimeout: 30000,
    },
    {
      id: "memory",
      name: "Memory (Knowledge Graph)",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      enabled: true,
      transport: "stdio",
      toolTimeout: 30000,
    },
    {
      id: "figma-desktop",
      name: "Figma Desktop MCP",
      url: "http://127.0.0.1:3845/mcp",
      enabled: false,
      transport: "http",
      toolTimeout: 60000,
      initTimeout: 20000,
    },
    {
      id: "figma-remote",
      name: "Figma Remote MCP",
      url: "https://mcp.figma.com/mcp",
      authProvider: "figma",
      authHeaderName: "Authorization",
      authScheme: "bearer",
      enabled: false,
      transport: "http",
      toolTimeout: 60000,
      initTimeout: 20000,
    },
    // ===== Database Tools =====
    {
      id: "sqlite",
      name: "SQLite (Database)",
      command: "npx",
      args: ["-y", "mcp-server-sqlite"],
      enabled: false,
      transport: "stdio",
      toolTimeout: 30000,
    },
    // ===== Tools requiring API Key =====
    {
      id: "github",
      name: "GitHub",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_TOKEN: "", // Enable after user sets it
      },
      enabled: false,
      transport: "stdio",
      toolTimeout: 30000,
    },
    {
      id: "brave-search",
      name: "Brave Search",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: {
        BRAVE_API_KEY: "", // Free tier: 2000 queries per month
      },
      enabled: false,
      transport: "stdio",
      toolTimeout: 60000,
    },
    // ===== Development Tools =====
    {
      id: "git",
      name: "Git",
      command: "npx",
      args: ["-y", "@liangshanli/mcp-server-git"],
      enabled: false,
      transport: "stdio",
      toolTimeout: 30000,
    },
    {
      id: "postgres",
      name: "PostgreSQL",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      env: {
        POSTGRES_CONNECTION_STRING: "", // User's local database
      },
      enabled: false,
      transport: "stdio",
      toolTimeout: 30000,
    },
  ],
};

/**
 * Get the path to the MCP configuration file
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export function getMCPConfigPath(agentDir?: string): string {
	const env = process.env.MCP_CONFIG_PATH;
	if (env && env.trim()) {
		const trimmed = env.trim();
		if (trimmed === "~") return homedir();
		if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
		if (trimmed.startsWith("~")) return join(homedir(), trimmed.slice(1));
		return resolve(trimmed);
	}
	const baseAgentDir = agentDir ?? getAgentDir();
	return join(baseAgentDir, "mcp.json");
}

/**
 * Load MCP configuration from file
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export function loadMCPConfig(agentDir?: string): MCPConfig {
  const configPath = getMCPConfigPath(agentDir);
  const baseAgentDir = agentDir ?? getAgentDir();

  if (!existsSync(configPath)) {
    // Create default config
    const configDir = baseAgentDir;
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    writeFileSync(
      configPath,
      JSON.stringify(DEFAULT_MCP_CONFIG, null, 2),
      "utf-8",
    );
    return DEFAULT_MCP_CONFIG;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as MCPConfig;
    const existingServers = parsed.mcpServers ?? [];
    const existingIds = new Set(existingServers.map((server) => server.id));
    const missingDefaults = DEFAULT_MCP_CONFIG.mcpServers.filter(
      (server) => !existingIds.has(server.id),
    );

    if (missingDefaults.length === 0) {
      return parsed;
    }

    const mergedConfig: MCPConfig = {
      mcpServers: [...existingServers, ...missingDefaults],
    };
    saveMCPConfig(mergedConfig, agentDir);
    return mergedConfig;
  } catch (error) {
    console.error(`Failed to load MCP config: ${error}`);
    return DEFAULT_MCP_CONFIG;
  }
}

/**
 * Save MCP configuration to file
 * @param config MCP configuration to save
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export function saveMCPConfig(config: MCPConfig, agentDir?: string): void {
  const configPath = getMCPConfigPath(agentDir);
  const baseAgentDir = agentDir ?? getAgentDir();

  if (!existsSync(baseAgentDir)) {
    mkdirSync(baseAgentDir, { recursive: true });
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Add an MCP server configuration
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export function addMCPServer(server: MCPServerConfig, agentDir?: string): void {
  const config = loadMCPConfig(agentDir);

  // Remove existing server with same ID
  config.mcpServers = config.mcpServers.filter((s) => s.id !== server.id);

  // Add new server
  config.mcpServers.push(server);

  saveMCPConfig(config, agentDir);
}

/**
 * Remove an MCP server configuration
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export function removeMCPServer(serverId: string, agentDir?: string): void {
  const config = loadMCPConfig(agentDir);
  config.mcpServers = config.mcpServers.filter((s) => s.id !== serverId);
  saveMCPConfig(config, agentDir);
}

/**
 * Update an MCP server configuration
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export function updateMCPServer(
  serverId: string,
  updates: Partial<MCPServerConfig>,
  agentDir?: string,
): void {
  const config = loadMCPConfig(agentDir);
  const server = config.mcpServers.find((s) => s.id === serverId);

  if (server) {
    Object.assign(server, updates);
    saveMCPConfig(config, agentDir);
  }
}

/**
 * Enable/disable an MCP server
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export function setMCPServerEnabled(serverId: string, enabled: boolean, agentDir?: string): void {
  updateMCPServer(serverId, { enabled }, agentDir);
}

/**
 * Get an MCP server by ID
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export function getMCPServer(serverId: string, agentDir?: string): MCPServerConfig | undefined {
  const config = loadMCPConfig(agentDir);
  return config.mcpServers.find((s) => s.id === serverId);
}

/**
 * List all MCP servers
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export function listMCPServers(agentDir?: string): MCPServerConfig[] {
  const config = loadMCPConfig(agentDir);
  return config.mcpServers;
}

/**
 * List enabled MCP servers
 * @param agentDir Optional agent directory. If omitted, uses getAgentDir().
 */
export function listEnabledMCPServers(agentDir?: string): MCPServerConfig[] {
  const config = loadMCPConfig(agentDir);
  return config.mcpServers.filter((s) => s.enabled !== false);
}
