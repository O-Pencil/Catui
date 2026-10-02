/**
 * [WHO]: startBridgeServer provides bounded authenticated loopback transport
 * [FROM]: Node HTTP/crypto, controller dispatch and owner-only descriptor publication
 * [TO]: Explicitly activated session-bridge command and integration tests
 * [HERE]: extensions/optional/session-bridge/server.ts - no shell or Agent creation
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { BridgeError, MAX_BODY_BYTES, type BridgeDescriptor } from "./contracts.js";
import type { BridgeController } from "./controller.js";
import { publishDescriptor, registryDirectory } from "./registry.js";

function respond(res: ServerResponse, code: number, value: object): void {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new BridgeError(413, "Request too large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new BridgeError(400, "Invalid JSON"); }
}
export async function startBridgeServer(controller: BridgeController, cwd: string, directory = registryDirectory(), onContact?: () => void) {
  const token = randomBytes(32).toString("hex");
  const bridgeId = randomUUID();
  const server = createServer((req, res) => { void handle(req, res); });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.timeout = 10000;
  server.maxConnections = 16;
  let closing = false;
  let lastContactAt: string | undefined;
  const contacted = () => {
    lastContactAt = new Date().toISOString();
    onContact?.();
  };
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (closing) throw new BridgeError(410, "Bridge closed");
      if (req.headers.origin !== undefined) throw new BridgeError(403, "Browser origins are not allowed");
      const auth = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) throw new BridgeError(401, "Unauthorized");
      if (req.method === "GET" && req.url === "/status") {
        const status = controller.status();
        contacted();
        respond(res, 200, { bridgeId, ...status });
      } else if (req.method === "POST" && req.url === "/command") {
        if (!req.headers["content-type"]?.startsWith("application/json")) throw new BridgeError(415, "Expected application/json");
        if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) throw new BridgeError(413, "Request too large");
        const result = controller.dispatch(await body(req));
        contacted();
        respond(res, 200, result);
      } else throw new BridgeError(404, "Not found");
    } catch (error) {
      if (!res.destroyed) respond(res, error instanceof BridgeError ? error.status : 500,
        { error: error instanceof BridgeError ? error.message : "Bridge operation failed" });
    }
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No bridge listener address");
  const descriptor: BridgeDescriptor = { version: 1, bridgeId, sessionId: controller.sessionId, cwd,
    pid: process.pid, port: address.port, token, startedAt: new Date().toISOString() };
  let remove: () => Promise<void>;
  try { remove = await publishDescriptor(directory, descriptor); }
  catch (error) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); throw error; }
  return {
    bridgeId,
    get lastContactAt() { return lastContactAt; },
    async close(): Promise<void> {
      if (closing) return;
      closing = true;
      controller.revoke();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await remove();
    },
  };
}
