/**
 * [WHO]: MCPClient class, MCPServerConfig, MCPTool, MCPToolResult
 * [FROM]: Depends on child_process, node:fs, config, auth-storage, mcp-config
 * [TO]: Consumed by core/mcp/index.ts, core/mcp/mcp-manager.ts, core/mcp/mcp-adapter.ts, core/mcp/mcp-config.ts
 * [HERE]: core/mcp/mcp-client.ts - MCP client for JSON-RPC over stdio
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "../../config.js";
import { AuthStorage } from "../platform/config/auth-storage.js";
import { getMCPConfigPath } from "./mcp-config.js";

// Log level control: DEBUG shows all MCP messages, RELEASE only shows summary
// Check if running from installed location (production) vs development
const isProductionBuild = typeof import.meta.url === "string" && import.meta.url.includes("node_modules");
const isDebugMode = process.env.NODE_ENV === "development" || (process.env.NODE_ENV !== "production" && !isProductionBuild);

function mcpLog(...args: unknown[]): void {
  if (isDebugMode) {
    console.error(...args);
  }
}

function mcpWarn(...args: unknown[]): void {
  if (isDebugMode) {
    console.warn(...args);
  }
}

function mcpError(...args: unknown[]): void {
  // Errors are always shown
  console.error(...args);
}

/** Normalize thrown values for logs (avoids "undefined" when rejections are non-Error). */
function formatUnknownError(error: unknown): string {
  if (error == null) return "Unknown error";
  if (error instanceof Error) {
    const m = error.message?.trim();
    if (m.length > 0) return m;
    return error.name && error.name !== "Error" ? error.name : "Error (empty message)";
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Per-server startup failure: in production only emit debug-level detail (summary is in sdk.ts).
 * In non-production, print one line with a readable message.
 */
function logMcpStartupFailure(
  kind: "stdio" | "http",
  serverId: string,
  error: unknown,
): void {
  const detail = formatUnknownError(error);
  if (!isDebugMode) {
    mcpLog(
      kind === "http"
        ? `[MCP] HTTP init failed ${serverId}: ${detail}`
        : `[MCP] stdio start failed ${serverId}: ${detail}`,
    );
    return;
  }
  if (kind === "http") {
    console.error(`Failed to initialize HTTP MCP server ${serverId}: ${detail}`);
  } else {
    console.error(`Failed to start MCP server ${serverId}: ${detail}`);
  }
}

export interface MCPServerConfig {
  /** Unique identifier for this server */
  id: string;
  /** Display name */
  name: string;
  /** Command to start the server (e.g., "npx", "uvx") */
  command?: string;
  /** Arguments to pass to the command */
  args?: string[];
  /** Streamable HTTP endpoint for remote/local HTTP MCP servers */
  url?: string;
  /** Additional headers for HTTP MCP servers */
  headers?: Record<string, string>;
  /** Credential provider id stored in auth.json for HTTP MCP servers */
  authProvider?: string;
  /** Header name to use when authProvider resolves a token */
  authHeaderName?: string;
  /** Header auth scheme. "bearer" prefixes the token, "raw" passes it as-is */
  authScheme?: "bearer" | "raw";
  /** Environment variables to pass */
  env?: Record<string, string>;
  /** Transport type: "stdio", "sse", or "http" */
  transport?: "stdio" | "sse" | "http";
  /** Whether this server is enabled */
  enabled?: boolean;
  /** Tool call timeout in milliseconds (default: 20000) */
  toolTimeout?: number;
  /** Initialize request timeout in milliseconds (default: 20000) */
  initTimeout?: number;
  /** Working directory for the server process */
  cwd?: string;
}

export interface MCPTool {
  /** Tool name (server_id/tool_name format) */
  name: string;
  /** Display name */
  displayName?: string;
  /** Tool description */
  description: string;
  /** JSON Schema for input */
  inputSchema: Record<string, unknown>;
  /** Server ID */
  serverId: string;
}

export interface MCPToolResult {
  /** Tool result content */
  content: Array<{
    type: "text" | "image" | "resource";
    text?: string;
    data?: any;
  }>;
  /** Error message if call failed */
  error?: string;
  /** Whether result is partial (hasMore=true) */
  isPartial?: boolean;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

interface ServerRuntime {
  process: ChildProcessWithoutNullStreams;
  buffer: Buffer;
  nextRequestId: number;
  pendingRequests: Map<number, PendingRequest>;
}

interface SpawnSpec {
  command: string;
  args: string[];
}

interface HTTPSession {
  sessionId?: string;
  initialized: boolean;
}

interface ServerSentEventPayload {
  event?: string;
  data?: string;
}

/**
 * MCP Client class
 * Manages connections to MCP servers and tool calls
 */
export class MCPClient {
  private servers = new Map<string, MCPServerConfig>();
  private serverRuntimes = new Map<string, ServerRuntime>();
  private serverTools = new Map<string, MCPTool[]>();
  private httpSessions = new Map<string, HTTPSession>();
  private authStorage: AuthStorage;
  private agentDir?: string;

  /**
   * @param authStoragePath Optional path to auth.json. If omitted, uses getAgentDir()/auth.json.
   * @param agentDir Optional agent directory for config path resolution. If omitted, uses getAgentDir().
   */
  constructor(authStoragePath?: string, agentDir?: string) {
    this.agentDir = agentDir;
    const authPath = authStoragePath ?? join(agentDir ?? getAgentDir(), "auth.json");
    this.authStorage = AuthStorage.create(authPath);
    this.loadServersFromConfig();
  }

  /**
   * Load MCP server configurations from config file
   */
  private loadServersFromConfig(): void {
    const configPath = getMCPConfigPath(this.agentDir);

    if (!existsSync(configPath)) {
      return;
    }

    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const servers: MCPServerConfig[] = config.mcpServers || [];

      for (const server of servers) {
        if (server.enabled !== false) {
          this.servers.set(server.id, server);
        }
      }
    } catch (error) {
      mcpError(`Failed to load MCP config: ${error}`);
    }
  }

  /**
   * Get all configured servers
   */
  getServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * Get a specific server by ID
   */
  getServer(id: string): MCPServerConfig | undefined {
    return this.servers.get(id);
  }

  /**
   * Add or update a server configuration
   */
  addServer(server: MCPServerConfig): void {
    this.servers.set(server.id, server);
  }

  /**
   * Remove a server
   */
  removeServer(id: string): void {
    this.servers.delete(id);
    this.serverTools.delete(id);
    this.stopServer(id);
  }

  private getRuntime(serverId: string): ServerRuntime | undefined {
    return this.serverRuntimes.get(serverId);
  }

  private convertNpxArgsToNpmExecArgs(args: string[]): string[] | undefined {
    // Convert: npx -y <pkg> [rest...]
    // To:      npm exec --yes <pkg> -- [rest...]
    if (args.length === 0) return undefined;
    const normalized = [...args];
    if (normalized[0] === "-y" || normalized[0] === "--yes") {
      normalized.shift();
    }
    const pkg = normalized.shift();
    if (!pkg) return undefined;
    return ["exec", "--yes", pkg, ...(normalized.length > 0 ? ["--", ...normalized] : [])];
  }

  private getSpawnAttempts(server: MCPServerConfig): SpawnSpec[] {
    if (!server.command) return [];
    const attempts: SpawnSpec[] = [];
    const cmd = server.command.trim();
    const lower = cmd.toLowerCase();
    const commandArgs = server.args ?? [];

    if (process.platform === "win32" && lower === "npx") {
      attempts.push({ command: "npx.cmd", args: commandArgs });
      const npmExecArgs = this.convertNpxArgsToNpmExecArgs(commandArgs);
      if (npmExecArgs) {
        attempts.push({ command: "npm.cmd", args: npmExecArgs });
      }
      attempts.push({ command: "npx", args: commandArgs });
      return attempts;
    }

    attempts.push({ command: cmd, args: commandArgs });

    if (lower === "npx") {
      const npmExecArgs = this.convertNpxArgsToNpmExecArgs(commandArgs);
      if (npmExecArgs) {
        attempts.push({
          command: process.platform === "win32" ? "npm.cmd" : "npm",
          args: npmExecArgs,
        });
      }
    }

    return attempts;
  }

  private async spawnProcess(
    spec: SpawnSpec,
    env: NodeJS.ProcessEnv,
    cwd?: string,
  ): Promise<ChildProcessWithoutNullStreams> {
    return await new Promise((resolve, reject) => {
      // On Windows, use shell mode but pass command as a single string to avoid DEP0190 warning
      // On Unix, use non-shell mode for better security
      const useShell = process.platform === "win32";
      const child = useShell
        ? spawn([spec.command, ...spec.args].map(arg => arg.includes(" ") ? `"${arg}"` : arg).join(" "), {
            env,
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            shell: true,
          })
        : spawn(spec.command, spec.args, {
            env,
            cwd,
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            shell: false,
          });

      const onError = (err: Error) => {
        child.removeListener("spawn", onSpawn);
        reject(err);
      };
      const onSpawn = () => {
        child.removeListener("error", onError);
        resolve(child);
      };

      child.once("error", onError);
      child.once("spawn", onSpawn);
    });
  }

  private attachStdoutParser(serverId: string, runtime: ServerRuntime): void {
    const rejectPending = (reason: Error): void => {
      if (this.serverRuntimes.get(serverId) !== runtime) {
        return;
      }
      for (const pending of runtime.pendingRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(reason);
      }
      runtime.pendingRequests.clear();
      this.serverRuntimes.delete(serverId);
    };

    // Broken pipe when the child exits before we finish initialize — prevents unhandled "error" on stdin.
    runtime.process.stdin.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      const detail =
        code === "EPIPE"
          ? "process exited before MCP handshake (check command and npm package name)"
          : err instanceof Error
            ? err.message
            : String(err);
      mcpLog(`[MCP:${serverId}] stdin: ${detail}`);
      rejectPending(new Error(`MCP server ${serverId} stdin closed: ${detail}`));
    });

    runtime.process.stdout.on("data", (chunk: Buffer) => {
      runtime.buffer = Buffer.concat([runtime.buffer, chunk]);
      this.processStdoutBuffer(serverId, runtime);
    });

    runtime.process.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text.length > 0) {
        // Only show stderr errors in debug mode
        if (isDebugMode) {
          mcpError(`[MCP:${serverId}] ${text}`);
        }
      }
    });

    runtime.process.on("exit", (code, signal) => {
      if (this.serverRuntimes.get(serverId) !== runtime) {
        return;
      }
      const message = `[MCP:debug] Server exited: code=${code ?? "null"}, signal=${signal ?? "null"}`;
      mcpLog(message);
      rejectPending(new Error(message));
    });

    runtime.process.on("error", (err) => {
      const message = `MCP server ${serverId} process error: ${err instanceof Error ? err.message : String(err)}`;
      rejectPending(new Error(message));
    });
  }

  private processStdoutBuffer(serverId: string, runtime: ServerRuntime): void {
    // MCP SDK uses line-delimited JSON protocol (not Content-Length framing)
    // Format: {json}\n
    while (runtime.buffer.length > 0) {
      const lineEnd = runtime.buffer.indexOf("\n");
      if (lineEnd === -1) {
        // No complete line yet, wait for more data
        return;
      }
      const line = runtime.buffer.slice(0, lineEnd).toString("utf8").replace(/\r$/, "");
      runtime.buffer = runtime.buffer.slice(lineEnd + 1);
      if (line.length > 0) {
        mcpLog(`[MCP:${serverId}] Received: ${line.slice(0, 200)}`);
        this.handleJsonRpcMessage(serverId, line);
      }
    }
  }

  private handleJsonRpcMessage(serverId: string, raw: string): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(raw) as JsonRpcMessage;
    } catch {
      return;
    }

    if (msg.id === undefined) {
      // Notification/unsolicited message
      return;
    }

    const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
    if (!Number.isFinite(id)) {
      return;
    }

    const runtime = this.serverRuntimes.get(serverId);
    if (!runtime) return;

    const pending = runtime.pendingRequests.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    runtime.pendingRequests.delete(id);

    if (msg.error) {
      pending.reject(
        new Error(
          msg.error.message || `JSON-RPC error ${msg.error.code ?? "unknown"}`,
        ),
      );
      return;
    }

    pending.resolve(msg.result);
  }

  private writeFramedMessage(
    runtime: ServerRuntime,
    message: Record<string, unknown>,
  ): void {
    // MCP SDK uses line-delimited JSON protocol
    const body = JSON.stringify(message);
    const framed = body + "\n";
    runtime.process.stdin.write(framed);
  }

  private sendNotification(
    serverId: string,
    method: string,
    params?: Record<string, unknown>,
  ): void {
    const server = this.servers.get(serverId);
    if (server?.transport === "http") {
      void this.sendHttpRequest(server, method, params, 20_000, true);
      return;
    }

    const runtime = this.getRuntime(serverId);
    if (!runtime) return;
    this.writeFramedMessage(runtime, {
      jsonrpc: "2.0",
      method,
      params: params ?? {},
    });
  }

  private async sendRequest<T = unknown>(
    serverId: string,
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 20_000,
  ): Promise<T> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    if (server.transport === "http") {
      return (await this.sendHttpRequest(
        server,
        method,
        params,
        timeoutMs,
      )) as T;
    }

    const runtime = this.getRuntime(serverId);
    if (!runtime) {
      throw new Error(`Server ${serverId} is not running`);
    }

    const id = runtime.nextRequestId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? {},
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        runtime.pendingRequests.delete(id);
        reject(
          new Error(
            `MCP request timed out: ${serverId} ${method} (${timeoutMs}ms)`,
          ),
        );
      }, timeoutMs);

      runtime.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.writeFramedMessage(runtime, payload);
    });
  }

  private getHttpSession(serverId: string): HTTPSession {
    const existing = this.httpSessions.get(serverId);
    if (existing) return existing;
    const created: HTTPSession = { initialized: false };
    this.httpSessions.set(serverId, created);
    return created;
  }

  private async buildHttpHeaders(
    server: MCPServerConfig,
    sessionId?: string,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-03-26",
      ...(server.headers ?? {}),
    };

    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }

    if (server.authProvider) {
      const token = await this.authStorage.getApiKey(server.authProvider);
      if (token) {
        const headerName = server.authHeaderName?.trim() || "Authorization";
        const scheme = server.authScheme ?? "bearer";
        headers[headerName] = scheme === "raw" ? token : `Bearer ${token}`;
      }
    }

    return headers;
  }

  private async ensureHttpInitialized(server: MCPServerConfig): Promise<void> {
    const session = this.getHttpSession(server.id);
    if (session.initialized) {
      return;
    }

    const initPayload = {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "nano-pencil", version: "1.11.12" },
    };
    await this.sendHttpRequest(server, "initialize", initPayload, server.initTimeout ?? 20_000);
    session.initialized = true;
    await this.sendHttpRequest(server, "notifications/initialized", {}, server.initTimeout ?? 20_000, true);
  }

  private async sendHttpRequest(
    server: MCPServerConfig,
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
    isNotification = false,
    allowRetry = true,
  ): Promise<unknown> {
    if (!server.url) {
      throw new Error(`HTTP MCP server ${server.id} is missing a url`);
    }

    const session = this.getHttpSession(server.id);
    if (method !== "initialize" && !session.initialized) {
      await this.ensureHttpInitialized(server);
    }

    const requestId = isNotification ? undefined : Date.now() + Math.floor(Math.random() * 1000);
    const body = isNotification
      ? {
          jsonrpc: "2.0",
          method,
          params: params ?? {},
        }
      : {
          jsonrpc: "2.0",
          id: requestId,
          method,
          params: params ?? {},
        };

    const response = await fetch(server.url, {
      method: "POST",
      headers: await this.buildHttpHeaders(
        server,
        method === "initialize" ? undefined : session.sessionId,
      ),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status === 404 && session.sessionId && allowRetry && method !== "initialize") {
      this.httpSessions.set(server.id, { initialized: false });
      return this.sendHttpRequest(server, method, params, timeoutMs, isNotification, false);
    }

    if (!response.ok) {
      if (response.status === 401 && server.authProvider) {
        throw new Error(
          `HTTP MCP request failed (401 Unauthorized). The ${server.id} server requires valid credentials for "${server.authProvider}". Re-authenticate and try again.`,
        );
      }
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `HTTP MCP request failed (${response.status} ${response.statusText})${errorText ? `: ${errorText}` : ""}`,
      );
    }

    const nextSessionId = response.headers.get("Mcp-Session-Id");
    if (nextSessionId) {
      session.sessionId = nextSessionId;
    }

    if (isNotification) {
      return undefined;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    if (!raw.trim()) {
      return undefined;
    }

    let message: JsonRpcMessage;
    if (contentType.includes("text/event-stream")) {
      message = this.parseEventStreamResponse(raw);
    } else {
      if (!contentType.includes("application/json") && !raw.trim().startsWith("{")) {
        throw new Error(`Unsupported HTTP MCP response content type: ${contentType || "unknown"}`);
      }
      message = JSON.parse(raw) as JsonRpcMessage;
    }

    if (message.error) {
      throw new Error(message.error.message || `JSON-RPC error ${message.error.code ?? "unknown"}`);
    }
    return message.result;
  }

  private parseEventStreamResponse(raw: string): JsonRpcMessage {
    const events: ServerSentEventPayload[] = [];
    let current: ServerSentEventPayload = {};

    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) {
        if (current.data !== undefined || current.event !== undefined) {
          events.push(current);
          current = {};
        }
        continue;
      }

      if (line.startsWith(":")) {
        continue;
      }

      const separatorIndex = line.indexOf(":");
      const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      const value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).trimStart();

      if (field === "event") {
        current.event = value;
      } else if (field === "data") {
        current.data = current.data ? `${current.data}\n${value}` : value;
      }
    }

    if (current.data !== undefined || current.event !== undefined) {
      events.push(current);
    }

    const payload = [...events]
      .reverse()
      .find((event) => typeof event.data === "string" && event.data.trim().length > 0)?.data;

    if (!payload) {
      throw new Error("HTTP MCP event-stream response did not include a JSON payload");
    }

    return JSON.parse(payload) as JsonRpcMessage;
  }

  private async initializeServer(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    const isNpx = server?.command?.toLowerCase().includes("npx") ?? false;
    const isWindows = process.platform === "win32";

    // Give server a moment to initialize
    const baseDelay = isWindows && isNpx ? 1500 : 500;
    await new Promise((resolve) => setTimeout(resolve, baseDelay));

    const initTimeout = server?.initTimeout ?? 20_000;

    // Primary protocol version + fallback for older servers
    const initPayload = {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "nano-pencil", version: "1.7.0" },
    };
    const fallbackPayload = {
      protocolVersion: "2024-10-07",
      capabilities: {},
      clientInfo: { name: "nano-pencil", version: "1.7.0" },
    };

    try {
      await this.sendRequest(serverId, "initialize", initPayload, initTimeout);
    } catch {
      await this.sendRequest(serverId, "initialize", fallbackPayload, initTimeout);
    }

    this.sendNotification(serverId, "notifications/initialized");
  }

  private normalizeToolRecord(serverId: string, tool: unknown): MCPTool | null {
    if (!tool || typeof tool !== "object") return null;
    const obj = tool as Record<string, unknown>;
    const name = obj.name;
    const description = obj.description;
    if (typeof name !== "string" || typeof description !== "string") {
      return null;
    }
    const inputSchema =
      obj.inputSchema && typeof obj.inputSchema === "object"
        ? (obj.inputSchema as Record<string, unknown>)
        : { type: "object", properties: {}, additionalProperties: true };

    return {
      name: `${serverId}/${name}`,
      displayName:
        typeof obj.title === "string"
          ? obj.title
          : typeof obj.displayName === "string"
            ? obj.displayName
            : undefined,
      description,
      inputSchema,
      serverId,
    };
  }

  private async loadToolsForServer(serverId: string): Promise<MCPTool[]> {
    const tools: MCPTool[] = [];
    let cursor: string | undefined;

    while (true) {
      const result = (await this.sendRequest<Record<string, unknown>>(
        serverId,
        "tools/list",
        cursor ? { cursor } : {},
        20_000,
      )) as Record<string, unknown>;

      const pageTools = Array.isArray(result.tools) ? result.tools : [];
      for (const t of pageTools) {
        const normalized = this.normalizeToolRecord(serverId, t);
        if (normalized) tools.push(normalized);
      }

      const nextCursor =
        typeof result.nextCursor === "string"
          ? result.nextCursor
          : typeof result.cursor === "string"
            ? result.cursor
            : undefined;

      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }

    this.serverTools.set(serverId, tools);
    return tools;
  }

  /**
   * Start an MCP server (for stdio transport)
   */
  async startServer(serverId: string): Promise<boolean> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    if (server.transport === "http") {
      try {
        await this.ensureHttpInitialized(server);
        await this.loadToolsForServer(serverId);
        return true;
      } catch (error) {
        logMcpStartupFailure("http", serverId, error);
        return false;
      }
    }

    if (server.transport === "sse") {
      // Legacy SSE-only remote servers are not fully supported yet.
      return true;
    }

    // Check if already running
    if (this.serverRuntimes.has(serverId)) {
      return true;
    }

    const attempts = this.getSpawnAttempts(server);
    let lastError: unknown;

    for (const attempt of attempts) {
      try {
        // Default to current working directory if not specified
        const workDir = server.cwd || process.cwd();
        const serverProcess = await this.spawnProcess(attempt, {
          ...process.env,
          ...server.env,
        }, workDir);

        const runtime: ServerRuntime = {
          process: serverProcess,
          buffer: Buffer.alloc(0),
          nextRequestId: 1,
          pendingRequests: new Map(),
        };
        this.serverRuntimes.set(serverId, runtime);
        this.attachStdoutParser(serverId, runtime);

        await this.initializeServer(serverId);
        await this.loadToolsForServer(serverId);
        return true;
      } catch (error) {
        lastError = error;
        this.stopServer(serverId);
      }
    }

    logMcpStartupFailure("stdio", serverId, lastError);
    return false;
  }

  /**
   * Stop an MCP server
   */
  stopServer(serverId: string): void {
    const server = this.servers.get(serverId);
    const httpSession = this.httpSessions.get(serverId);
    if (server?.transport === "http" && httpSession?.sessionId && server.url) {
      void this.buildHttpHeaders(server, httpSession.sessionId)
        .then((headers) =>
          fetch(server.url!, {
            method: "DELETE",
            headers,
          }),
        )
        .catch(() => {
        // Ignore termination failures from HTTP MCP servers.
        });
    }

    this.httpSessions.delete(serverId);
    const runtime = this.serverRuntimes.get(serverId);
    if (runtime) {
      for (const pending of runtime.pendingRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`MCP server ${serverId} stopped`));
      }
      runtime.pendingRequests.clear();
      runtime.process.kill();
      this.serverRuntimes.delete(serverId);
    }
  }

  /**
   * Stop all running servers
   */
  stopAllServers(): void {
    const serverIds = new Set<string>([
      ...this.serverRuntimes.keys(),
      ...this.httpSessions.keys(),
    ]);
    for (const serverId of serverIds) {
      this.stopServer(serverId);
    }
  }

  /**
   * List available tools from all servers
   */
  async listTools(serverId?: string): Promise<MCPTool[]> {
    const tools: MCPTool[] = [];

    if (serverId) {
      if (!this.serverTools.has(serverId)) {
        try {
          await this.loadToolsForServer(serverId);
        } catch {
          // keep cache miss as empty list
        }
      }
      const serverTools = this.serverTools.get(serverId) || [];
      tools.push(...serverTools);
    } else {
      for (const [id] of this.servers.entries()) {
        if (!this.serverTools.has(id)) {
          try {
            await this.loadToolsForServer(id);
          } catch {
            // skip unavailable servers
          }
        }
        tools.push(...(this.serverTools.get(id) || []));
      }
    }

    return tools;
  }

  /**
   * Call an MCP tool
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<MCPToolResult> {
    // Parse tool name: server_id/tool_name
    const [serverId, ...nameParts] = toolName.split("/");
    const toolNameOnly = nameParts.join("/");

    const server = this.servers.get(serverId);
    if (!server) {
      return {
        content: [{ type: "text", text: `Server ${serverId} not found` }],
        error: `Server ${serverId} not found`,
      };
    }

    // Use configured timeout or provided timeout, default to 60s
    const effectiveTimeout = timeoutMs ?? server.toolTimeout ?? 20_000;

    // For SSE transport, make HTTP request (not implemented in current defaults)
    if (server.transport === "sse") {
      return this.callSSETool(server, toolNameOnly, args);
    }

    if (server.transport === "http") {
      return this.callHttpTool(server, toolNameOnly, args, effectiveTimeout);
    }

    // For stdio transport, send JSON-RPC message
    return this.callStdioTool(server, toolNameOnly, args, effectiveTimeout);
  }

  private async callHttpTool(
    server: MCPServerConfig,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number = 20_000,
  ): Promise<MCPToolResult> {
    try {
      const result = (await this.sendRequest<Record<string, unknown>>(
        server.id,
        "tools/call",
        { name: toolName, arguments: args },
        timeoutMs,
      )) as Record<string, unknown>;

      const isError = result.isError === true;
      const content = Array.isArray(result.content)
        ? (result.content as Array<Record<string, unknown>>).map((item) => {
            const type =
              item.type === "image" || item.type === "resource"
                ? item.type
                : "text";
            return {
              type: type as "text" | "image" | "resource",
              text:
                typeof item.text === "string"
                  ? item.text
                  : typeof item.message === "string"
                    ? item.message
                    : undefined,
              data: item,
            };
          })
        : [{ type: "text" as const, text: JSON.stringify(result) }];

      return {
        content,
        error:
          isError
            ? content
                .map((c) => c.text)
                .filter((t): t is string => !!t)
                .join("\n") || `MCP tool ${toolName} failed`
            : undefined,
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to call tool: ${error}` }],
        error: String(error),
      };
    }
  }

  /**
   * Call tool via stdio (JSON-RPC)
   */
  private async callStdioTool(
    server: MCPServerConfig,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number = 20_000,
  ): Promise<MCPToolResult> {
    if (!this.serverRuntimes.has(server.id)) {
      return {
        content: [{ type: "text", text: `Server ${server.id} is not running` }],
        error: `Server ${server.id} is not running`,
      };
    }

    try {
      const result = (await this.sendRequest<Record<string, unknown>>(
        server.id,
        "tools/call",
        { name: toolName, arguments: args },
        timeoutMs,
      )) as Record<string, unknown>;

      const isError = result.isError === true;
      const content = Array.isArray(result.content)
        ? (result.content as Array<Record<string, unknown>>).map((item) => {
            const type =
              item.type === "image" || item.type === "resource"
                ? item.type
                : "text";
            return {
              type: type as "text" | "image" | "resource",
              text:
                typeof item.text === "string"
                  ? item.text
                  : typeof item.message === "string"
                    ? item.message
                    : undefined,
              data: item,
            };
          })
        : [{ type: "text" as const, text: JSON.stringify(result) }];

      return {
        content,
        error:
          isError
            ? content
                .map((c) => c.text)
                .filter((t): t is string => !!t)
                .join("\n") || `MCP tool ${toolName} failed`
            : undefined,
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to call tool: ${error}` }],
        error: String(error),
      };
    }
  }

  /**
   * Call tool via SSE (HTTP)
   */
  private async callSSETool(
    server: MCPServerConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    // TODO: Implement SSE tool calls
    return {
      content: [
        {
          type: "text",
          text: `SSE transport is not implemented yet for ${server.id}/${toolName}`,
        },
      ],
      error: "SSE transport not yet supported",
    };
  }

  /**
   * Check if a tool exists
   */
  hasTool(toolName: string): boolean {
    const [serverId] = toolName.split("/");
    return this.servers.has(serverId);
  }
}
