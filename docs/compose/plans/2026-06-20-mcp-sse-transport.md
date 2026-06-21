# MCP SSE Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement MCP SSE (Server-Sent Events) transport so SSE-configured MCP servers can receive tool calls and return results.

**Architecture:** Add an SSE connection manager to `MCPClient` that maintains a persistent GET connection for receiving server→client messages, tracks the POST endpoint URL, and routes tool call responses back to pending requests. SSE transport shares the same JSON-RPC protocol as HTTP but uses a different transport layer.

**Tech Stack:** Node.js native `fetch` for SSE streaming (ReadableStream), existing `MCPServerConfig` type with `transport: "sse"`.

---

## File Structure

| File | Change |
|------|--------|
| `core/mcp/mcp-client.ts` | Add `SSESession` interface, `initSSEConnection()`, update `callSSETool()`, update `startServer()` for SSE, update `stopServer()` for SSE cleanup |
| `core/mcp/mcp-types.ts` | Add `sseUrl` field to `MCPServerConfig` (optional, separate from `url` for HTTP transport) |

---

### Task 1: Add `sseUrl` to MCPServerConfig

**Covers:** MCP SSE config schema

**Files:**
- Modify: `core/mcp/mcp-types.ts:8-39`

- [ ] **Step 1: Add `sseUrl` field to MCPServerConfig**

```typescript
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
  /** SSE endpoint URL for SSE transport (separate from `url` which is for HTTP POST) */
  sseUrl?: string;
  /** Additional headers for HTTP/SSE MCP servers */
  headers?: Record<string, string>;
  // ... rest unchanged
}
```

- [ ] **Step 2: Verify type check**

Run: `npx tsc --noEmit`
Expected: PASS

---

### Task 2: Add SSESession interface and connection state

**Covers:** SSE session management

**Files:**
- Modify: `core/mcp/mcp-client.ts:86-106` (after existing interfaces)

- [ ] **Step 1: Add SSESession interface**

```typescript
interface SSESession {
  /** The POST endpoint URL received from the `endpoint` event */
  postEndpoint?: string;
  /** SSE connection abort controller */
  abortController: AbortController;
  /** Whether the SSE connection is active */
  connected: boolean;
  /** Pending requests waiting for responses on the SSE stream */
  pendingRequests: Map<number, PendingRequest>;
  /** Next request ID counter */
  nextRequestId: number;
  /** Reconnect attempt count */
  reconnectAttempts: number;
}
```

- [ ] **Step 2: Add `sseSessions` map to MCPClient class**

In the MCPClient class, add after `httpSessions`:

```typescript
private sseSessions = new Map<string, SSESession>();
```

- [ ] **Step 3: Verify type check**

Run: `npx tsc --noEmit`
Expected: PASS

---

### Task 3: Implement SSE connection initialization

**Covers:** SSE GET connection, endpoint event parsing

**Files:**
- Modify: `core/mcp/mcp-client.ts` (new method `initSSEConnection`)

- [ ] **Step 1: Implement `initSSEConnection` method**

```typescript
private async initSSEConnection(server: MCPServerConfig): Promise<void> {
  const sseUrl = server.sseUrl;
  if (!sseUrl) {
    throw new Error(`SSE server ${server.id} is missing sseUrl`);
  }

  const existing = this.sseSessions.get(server.id);
  if (existing?.connected) return;

  const abortController = new AbortController();
  const session: SSESession = {
    abortController,
    connected: false,
    pendingRequests: new Map(),
    nextRequestId: 1,
    reconnectAttempts: 0,
  };
  this.sseSessions.set(server.id, session);

  const headers = await this.buildSSEHeaders(server);

  // Start SSE connection in background
  this.runSSEStream(server, session, sseUrl, headers).catch((err) => {
    mcpLog(`[MCP:${server.id}] SSE stream ended: ${err}`);
  });

  // Wait for the `endpoint` event to arrive (with timeout)
  const endpointTimeout = server.initTimeout ?? 20_000;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SSE endpoint timeout for ${server.id} (${endpointTimeout}ms)`));
    }, endpointTimeout);

    const checkEndpoint = setInterval(() => {
      if (session.postEndpoint) {
        clearInterval(checkEndpoint);
        clearTimeout(timer);
        resolve();
      }
      if (!session.connected && !session.postEndpoint) {
        clearInterval(checkEndpoint);
        clearTimeout(timer);
        reject(new Error(`SSE connection failed for ${server.id}`));
      }
    }, 100);
  });
}
```

- [ ] **Step 2: Implement `buildSSEHeaders` helper**

```typescript
private async buildSSEHeaders(
  server: MCPServerConfig,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Cache-Control": "no-cache",
    "MCP-Protocol-Version": "2025-03-26",
    ...(server.headers ?? {}),
  };

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
```

- [ ] **Step 3: Implement `runSSEStream` method**

```typescript
private async runSSEStream(
  server: MCPServerConfig,
  session: SSESession,
  sseUrl: string,
  headers: Record<string, string>,
): Promise<void> {
  while (!session.abortController.signal.aborted) {
    try {
      const response = await fetch(sseUrl, {
        method: "GET",
        headers,
        signal: session.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      session.connected = true;
      session.reconnectAttempts = 0;

      const reader = response.body?.getReader();
      if (!reader) throw new Error("SSE response body is not readable");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          this.processSSELine(server.id, session, line);
        }
      }
    } catch (err) {
      if (session.abortController.signal.aborted) break;
      session.connected = false;
      session.reconnectAttempts++;

      const delay = Math.min(1000 * Math.pow(2, session.reconnectAttempts), 30_000);
      mcpLog(`[MCP:${server.id}] SSE reconnecting in ${delay}ms (attempt ${session.reconnectAttempts})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
```

- [ ] **Step 4: Implement `processSSELine` method**

```typescript
private processSSELine(
  serverId: string,
  session: SSESession,
  line: string,
): void {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return;

  const colonIdx = trimmed.indexOf(":");
  const field = colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx);
  const value = colonIdx === -1 ? "" : trimmed.slice(colonIdx + 1).trimStart();

  if (field === "event") {
    // Store event type for next data line
    (session as any)._currentEvent = value;
  } else if (field === "data") {
    const eventType = (session as any)._currentEvent ?? "message";
    (session as any)._currentEvent = undefined;

    if (eventType === "endpoint") {
      // Server tells us where to POST messages
      session.postEndpoint = value;
      mcpLog(`[MCP:${serverId}] SSE endpoint: ${value}`);
    } else if (eventType === "message") {
      // JSON-RPC message from server
      this.handleSSEMessage(serverId, session, value);
    }
    // Ignore other event types (ping, etc.)
  }
}
```

- [ ] **Step 5: Implement `handleSSEMessage` method**

```typescript
private handleSSEMessage(
  serverId: string,
  session: SSESession,
  raw: string,
): void {
  let msg: JsonRpcMessage;
  try {
    msg = JSON.parse(raw) as JsonRpcMessage;
  } catch {
    return;
  }

  if (msg.id === undefined) return; // Notification — ignore for now

  const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
  if (!Number.isFinite(id)) return;

  const pending = session.pendingRequests.get(id);
  if (!pending) return;

  clearTimeout(pending.timer);
  session.pendingRequests.delete(id);

  if (msg.error) {
    pending.reject(new Error(msg.error.message || `JSON-RPC error ${msg.error.code ?? "unknown"}`));
    return;
  }

  pending.resolve(msg.result);
}
```

- [ ] **Step 6: Verify type check**

Run: `npx tsc --noEmit`
Expected: PASS

---

### Task 4: Implement SSE POST for sending requests

**Covers:** SSE POST endpoint, request/response matching

**Files:**
- Modify: `core/mcp/mcp-client.ts` (new method `sendSSERequest`)

- [ ] **Step 1: Implement `sendSSERequest` method**

```typescript
private async sendSSERequest<T = unknown>(
  serverId: string,
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 20_000,
): Promise<T> {
  const session = this.sseSessions.get(serverId);
  if (!session?.connected || !session.postEndpoint) {
    throw new Error(`SSE server ${serverId} is not connected`);
  }

  const server = this.servers.get(serverId);
  if (!server) throw new Error(`Server ${serverId} not found`);

  const id = session.nextRequestId++;
  const body = {
    jsonrpc: "2.0",
    id,
    method,
    params: params ?? {},
  };

  const headers = {
    "Content-Type": "application/json",
    ...(server.headers ?? {}),
  };

  // POST the request to the endpoint
  const response = await fetch(session.postEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`SSE POST failed: ${response.status} ${response.statusText}`);
  }

  // For SSE, the response comes back on the SSE stream, not in the POST response.
  // But some servers may return the result directly in the POST response.
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const raw = await response.text();
    if (raw.trim()) {
      const msg = JSON.parse(raw) as JsonRpcMessage;
      if (msg.error) {
        throw new Error(msg.error.message || `JSON-RPC error ${msg.error.code ?? "unknown"}`);
      }
      return msg.result as T;
    }
  }

  // Wait for the response on the SSE stream
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pendingRequests.delete(id);
      reject(new Error(`SSE request timed out: ${serverId} ${method} (${timeoutMs}ms)`));
    }, timeoutMs);

    session.pendingRequests.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      timer,
    });
  });
}
```

- [ ] **Step 2: Verify type check**

Run: `npx tsc --noEmit`
Expected: PASS

---

### Task 5: Wire SSE into existing MCPClient methods

**Covers:** startServer SSE path, callSSETool, stopServer cleanup, sendRequest routing

**Files:**
- Modify: `core/mcp/mcp-client.ts` (update `startServer`, `callSSETool`, `stopServer`, `sendRequest`)

- [ ] **Step 1: Update `startServer` SSE branch**

Replace the existing SSE stub (lines 766-769):

```typescript
if (server.transport === "sse") {
  try {
    await this.initSSEConnection(server);
    await this.loadToolsForServer(serverId);
    return true;
  } catch (error) {
    logMcpStartupFailure("http", serverId, error);
    return false;
  }
}
```

- [ ] **Step 2: Update `callSSETool` with real implementation**

Replace the existing stub (lines 1040-1055):

```typescript
private async callSSETool(
  server: MCPServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<MCPToolResult> {
  try {
    const effectiveTimeout = server.toolTimeout ?? 20_000;
    const result = (await this.sendSSERequest<Record<string, unknown>>(
      server.id,
      "tools/call",
      { name: toolName, arguments: args },
      effectiveTimeout,
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
```

- [ ] **Step 3: Update `stopServer` to clean up SSE sessions**

Add SSE cleanup before the existing stdio cleanup:

```typescript
stopServer(serverId: string): void {
  const server = this.servers.get(serverId);

  // Clean up SSE session
  const sseSession = this.sseSessions.get(serverId);
  if (sseSession) {
    sseSession.abortController.abort();
    for (const pending of sseSession.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`MCP server ${serverId} stopped`));
    }
    sseSession.pendingRequests.clear();
    this.sseSessions.delete(serverId);
  }

  // Clean up HTTP session (existing)
  const httpSession = this.httpSessions.get(serverId);
  if (server?.transport === "http" && httpSession?.sessionId && server.url) {
    // ... existing HTTP cleanup
  }

  // Clean up stdio runtime (existing)
  this.httpSessions.delete(serverId);
  const runtime = this.serverRuntimes.get(serverId);
  if (runtime) {
    // ... existing stdio cleanup
  }
}
```

- [ ] **Step 4: Update `stopAllServers` to include SSE sessions**

```typescript
stopAllServers(): void {
  const serverIds = new Set<string>([
    ...this.serverRuntimes.keys(),
    ...this.httpSessions.keys(),
    ...this.sseSessions.keys(),
  ]);
  for (const serverId of serverIds) {
    this.stopServer(serverId);
  }
}
```

- [ ] **Step 5: Update `sendRequest` to route SSE transport**

In `sendRequest`, add SSE routing before the stdio path:

```typescript
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

  if (server.transport === "sse") {
    return this.sendSSERequest<T>(serverId, method, params, timeoutMs);
  }

  // For stdio transport, send JSON-RPC message
  const runtime = this.getRuntime(serverId);
  // ... rest unchanged
}
```

- [ ] **Step 6: Verify type check**

Run: `npx tsc --noEmit`
Expected: PASS

---

### Task 6: Verify build and run existing tests

**Covers:** Build verification, regression check

**Files:** None (verification only)

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: DIP verification**

Run: `npm run verify:dip`
Expected: PASS

- [ ] **Step 4: Quality verification**

Run: `npm run verify:quality`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/mcp/mcp-client.ts core/mcp/mcp-types.ts
git commit -m "feat(mcp): implement SSE transport for MCP servers

- Add SSESession interface and connection management
- Implement SSE GET connection with endpoint event parsing
- Implement POST to SSE endpoint for tool calls
- Add automatic reconnection with exponential backoff
- Wire SSE into startServer, callTool, stopServer, sendRequest
- SSE servers now work: initialize, load tools, call tools"
```
