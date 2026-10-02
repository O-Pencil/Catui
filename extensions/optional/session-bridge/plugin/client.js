/**
 * [WHO]: Private registry discovery and authenticated bridge requests for MCP tools
 * [FROM]: Node fs, HTTP, OS and path; no Catui runtime or third-party dependencies
 * [TO]: Companion server.js and bridge integration tests
 * [HERE]: extensions/optional/session-bridge/plugin/client.js - transport client
 */
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function registryDirectory() { return process.env.CATUI_BRIDGE_DIR || join(homedir(), ".catui", "bridges"); }
async function checkDirectory(directory) {
  const stat = await lstat(directory);
  if (process.platform === "win32" || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077)) {
    throw new Error("Bridge registry is not an owner-only POSIX directory");
  }
}
export async function readDescriptor(bridgeId, directory = registryDirectory()) {
  if (typeof bridgeId !== "string" || !uuid.test(bridgeId)) throw new Error("Invalid bridge_id");
  await checkDirectory(directory);
  const file = await open(join(directory, `${bridgeId}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > 8192) throw new Error("Unsafe bridge descriptor");
    // Bounded read also protects against a concurrently growing descriptor.
    const buffer = Buffer.alloc(8193);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 8192) throw new Error("Bridge descriptor too large");
    let d;
    // SyntaxError messages may quote descriptor contents, including the token.
    try { d = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")); }
    catch { throw new Error("Invalid bridge descriptor JSON"); }
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("Invalid bridge descriptor");
    if (d.version !== 1 || d.bridgeId !== bridgeId || typeof d.sessionId !== "string" || !d.sessionId ||
        typeof d.cwd !== "string" || typeof d.token !== "string" || !/^[0-9a-f]{64}$/.test(d.token) ||
        !Number.isInteger(d.port) || d.port < 1 || d.port > 65535) throw new Error("Invalid bridge descriptor");
    return d;
  } finally { await file.close(); }
}
export function callBridge(descriptor, command) {
  const payload = command ? JSON.stringify(command) : undefined;
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: descriptor.port, path: command ? "/command" : "/status",
      method: command ? "POST" : "GET", headers: { Authorization: `Bearer ${descriptor.token}`,
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}) } }, res => {
      const chunks = []; let size = 0;
      res.on("data", chunk => {
        size += chunk.length;
        // Leave room for escaped/multibyte text in the bounded progress window.
        if (size > 1048576) { res.destroy(); reject(new Error("Bridge response too large")); }
        else chunks.push(chunk);
      });
      res.on("error", () => reject(new Error("Bridge response interrupted")));
      res.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (res.statusCode !== 200) throw new Error(`Bridge rejected request (${res.statusCode}): ${String(result.error ?? "Unknown error").slice(0, 200)}`);
          if (!command && (result.bridgeId !== descriptor.bridgeId || result.sessionId !== descriptor.sessionId)) throw new Error("Bridge identity mismatch");
          resolve(result);
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
    req.on("error", () => reject(new Error("Bridge unavailable or timed out; refresh sessions. Retry uncertain messages only with the SAME request_id.")));
    req.end(payload);
  });
}
export async function listSessions(directory = registryDirectory()) {
  try { await checkDirectory(directory); }
  catch (error) { if (error.code === "ENOENT") return { sessions: [], unavailable: 0 }; throw error; }
  const files = (await readdir(directory)).filter(f => uuid.test(f.replace(/\.json$/, "")) && f.endsWith(".json"));
  const sessions = []; let unavailable = 0;
  // Bound concurrency and registry work; stale entries never become live sessions.
  for (let offset = 0; offset < Math.min(files.length, 64); offset += 8) {
    await Promise.all(files.slice(offset, Math.min(offset + 8, 64)).map(async name => {
      try {
        const d = await readDescriptor(name.slice(0, -5), directory);
        const status = await callBridge(d);
        sessions.push({ bridge_id: d.bridgeId, session_id: d.sessionId, cwd: d.cwd, pid: d.pid,
          started_at: d.startedAt, idle: status.idle, pending_messages: status.pendingMessages });
      } catch { unavailable++; }
    }));
  }
  return { sessions, unavailable, truncated: files.length > 64 };
}
export async function invokeTool(name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Expected tool arguments object");
  if (name === "list_sessions") return listSessions();
  if (!["get_progress", "send_message", "cancel_run"].includes(name)) throw new Error("Unknown tool");
  const descriptor = await readDescriptor(args.bridge_id);
  if (name === "get_progress") return callBridge(descriptor);
  if (args.session_id !== descriptor.sessionId) throw new Error("Session mismatch; use the exact IDs from list_sessions");
  if (name === "send_message") return callBridge(descriptor, { action: "send", sessionId: args.session_id,
    requestId: args.request_id, message: args.message, mode: args.mode ?? "followUp" });
  return callBridge(descriptor, { action: "cancel", sessionId: args.session_id, runId: args.run_id });
}
