/**
 * [WHO]: MCPManager class
 * [FROM]: Depends on mcp/mcp-client, mcp/mcp-adapter, mcp/mcp-config, extensions
 * [TO]: Consumed by core/index.ts, core/runtime/sdk.ts
 * [HERE]: core/mcp/mcp-manager.ts - MCP client lifecycle and tool integration
 */
import { MCPClient, type MCPServerConfig } from "./mcp-client.js";
import { loadMCPTools } from "./mcp-adapter.js";
import { listEnabledMCPServers } from "./mcp-config.js";
import type { ToolDefinition } from "../extensions-host/index.js";

export class MCPManager {
  private client: MCPClient;
  private tools: ToolDefinition[] = [];
  private enabledServerIds: string[] = [];
  private startedServerIds: string[] = [];
  private failedServerIds: string[] = [];
  private workingDir: string;

  constructor() {
    this.client = new MCPClient();
    this.workingDir = process.cwd();
  }

  /**
   * Set the working directory for MCP servers (e.g., user's project dir)
   */
  setWorkingDir(dir: string): void {
    this.workingDir = dir;
  }

  /**
   * Initialize MCP manager and load tools
   */
  async initialize(): Promise<void> {
    // Load enabled servers
    let enabledServers = listEnabledMCPServers();
    this.enabledServerIds = enabledServers.map((s) => s.id);
    this.startedServerIds = [];
    this.failedServerIds = [];

    // Resolve dynamic placeholders in server configs
    enabledServers = enabledServers.map((server) => this.resolveServerConfig(server));

    for (const serverConfig of enabledServers) {
      this.client.addServer(serverConfig);

      // Start stdio-based servers
      if (serverConfig.transport !== "sse") {
        const ok = await this.client.startServer(serverConfig.id);
        if (ok) {
          this.startedServerIds.push(serverConfig.id);
        } else {
          this.failedServerIds.push(serverConfig.id);
        }
      } else {
        this.startedServerIds.push(serverConfig.id);
      }
    }

    // Load tools from all servers
    this.tools = await loadMCPTools(this.client);
  }

  /**
   * Resolve dynamic placeholders in server configuration
   */
  private resolveServerConfig(server: MCPServerConfig): MCPServerConfig {
    const resolved = { ...server };

    // Replace {cwd} placeholder with actual working directory
    if (resolved.args) {
      resolved.args = resolved.args.map((arg) =>
        arg.replace(/\{cwd\}/g, this.workingDir),
      );
    }

    // Set cwd if not specified
    if (!resolved.cwd) {
      resolved.cwd = this.workingDir;
    }

    return resolved;
  }

  /**
   * Get all MCP tools as NanoPencil ToolDefinitions
   */
  getTools(): ToolDefinition[] {
    return this.tools;
  }

  /**
   * Get the MCP client instance
   */
  getClient(): MCPClient {
    return this.client;
  }

  getStatus(): {
    enabledServers: string[];
    startedServers: string[];
    failedServers: string[];
    toolCount: number;
  } {
    return {
      enabledServers: [...this.enabledServerIds],
      startedServers: [...this.startedServerIds],
      failedServers: [...this.failedServerIds],
      toolCount: this.tools.length,
    };
  }

  /**
   * Cleanup: stop all servers
   */
  dispose(): void {
    this.client.stopAllServers();
  }
}
