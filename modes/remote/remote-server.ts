/**
 * [WHO]: Provides createRemoteServer(), RemoteServerOptions, RemoteServerHandle
 * [FROM]: Depends on node:http, node:crypto, node:fs, node:path, ws, mime-types, config.ts, modes/rpc/rpc-command-handler, modes/rpc/rpc-types
 * [TO]: Consumed by modes/remote/remote-mode.ts
 * [HERE]: modes/remote/remote-server.ts - HTTP static UI + CORS-open /healthz liveness/token probe + token-authenticated WebSocket transport for remote control
 */
import * as http from "node:http";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { lookup } from "mime-types";
import { VERSION, getRemotePublicDir } from "../../config.js";
import { RpcCommandHandler, type RpcServerMessage } from "../rpc/rpc-command-handler.js";
import type { RpcCommand, RpcExtensionUIResponse, RpcResponse } from "../rpc/rpc-types.js";
import type { AgentSession } from "../../core/runtime/agent-session.js";

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";
const TOKEN_FAILURE_LIMIT = 5;
const TOKEN_COOLDOWN_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export interface RemoteServerOptions {
	session: AgentSession;
	/** Pairing token (plaintext; generated per run by remote-mode). */
	token: string;
	/** Listen port. Default 8787. */
	port?: number;
	/** Bind address. Default 0.0.0.0. */
	host?: string;
	/** Invoked when an extension requests process shutdown via the RPC command surface. */
	onShutdownRequested?: () => void;
}

export interface RemoteServerHandle {
	/** Actual listening port (useful when port 0 was requested). */
	port: number;
	/** Actual bind host. */
	host: string;
	/** Number of connected clients. */
	readonly clientCount: number;
	/** Stop the server and disconnect all clients. Never throws. */
	close(): Promise<void>;
}

/** Constant-time token comparison: hash both sides to equal length, then timingSafeEqual. */
function safeTokenEqual(a: string, b: string): boolean {
	const ha = crypto.createHash("sha256").update(a, "utf8").digest();
	const hb = crypto.createHash("sha256").update(b, "utf8").digest();
	return crypto.timingSafeEqual(ha, hb);
}

interface ClientMeta {
	isAlive: boolean;
}

/** Inline page served when the mobile web UI has not been built (missing public dir). */
function buildMissingUiPage(): string {
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Catui remote</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.6;background:#111;color:#eee}code{background:#222;padding:.1rem .4rem;border-radius:4px}</style>
</head><body>
<h1>Catui remote</h1>
<p>The mobile web UI is not bundled with this build.</p>
<p>To use the browser/mobile client, build it from a source checkout:</p>
<pre><code>cd apps/mobile &amp;&amp; npm install &amp;&amp; npm run build
cd ../..
npm run build:mobile-web
npm run build</code></pre>
<p>You can still pair a custom client over the WebSocket endpoint <code>/ws</code> using the RPC protocol.</p>
</body></html>`;
}

/**
 * Create the remote server: one node:http instance serving
 * - static mobile web UI (/, /assets/*) from the packaged public dir
 * - /healthz unauthenticated liveness probe
 * - /ws token-authenticated WebSocket carrying the RPC protocol
 *
 * A single shared RpcCommandHandler fans session events/extension UI out to all
 * clients; command replies are routed back to the requesting socket only.
 */
export async function createRemoteServer(options: RemoteServerOptions): Promise<RemoteServerHandle> {
	const { session, token } = options;
	const port = options.port ?? DEFAULT_PORT;
	const host = options.host ?? DEFAULT_HOST;

	const publicDir = getRemotePublicDir();
	const publicDirExists = fs.existsSync(publicDir);

	// --- Auth failure tracking (per IP) -------------------------------------
	const failures = new Map<string, { count: number; cooldownUntil: number }>();

	function recordFailure(ip: string): void {
		const state = failures.get(ip) ?? { count: 0, cooldownUntil: 0 };
		state.count += 1;
		if (state.count >= TOKEN_FAILURE_LIMIT) {
			state.cooldownUntil = Date.now() + TOKEN_COOLDOWN_MS;
			state.count = 0;
		}
		failures.set(ip, state);
	}

	// --- Shared RPC handler + broadcast sink --------------------------------
	const clients = new Map<WebSocket, ClientMeta>();

	function send(ws: WebSocket, message: RpcServerMessage): void {
		if (ws.readyState !== WebSocket.OPEN) return;
		// Backpressure guard: a phone locking its screen stops draining the socket.
		// Drop the connection instead of buffering unboundedly in memory.
		if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
			ws.terminate();
			return;
		}
		ws.send(JSON.stringify(message));
	}

	const broadcast = (message: RpcServerMessage): void => {
		for (const ws of clients.keys()) {
			send(ws, message);
		}
	};

	const handler = new RpcCommandHandler({ session, send: broadcast });
	await handler.bind();

	// --- HTTP routing --------------------------------------------------------
	const requestListener = (req: http.IncomingMessage, res: http.ServerResponse): void => {
		const method = req.method ?? "GET";
		if (method !== "GET" && method !== "HEAD") {
			res.writeHead(405, { "Content-Type": "text/plain" });
			res.end("Method not allowed");
			return;
		}

		const url = new URL(req.url ?? "/", "http://localhost");

		if (url.pathname === "/healthz") {
			// CORS-open liveness probe: the mobile APK (https://localhost origin)
			// fetches this to distinguish "network unreachable" from "bad token"
			// when pairing fails. Only liveness/version is exposed (no auth data).
			const headers = {
				"Content-Type": "application/json",
				"Access-Control-Allow-Origin": "*",
			};
			const probeToken = url.searchParams.get("token");
			res.writeHead(200, headers);
			res.end(
				JSON.stringify({
					ok: true,
					service: "catui-remote",
					version: VERSION,
					...(probeToken !== null ? { tokenValid: probeToken === token } : {}),
				}),
			);
			return;
		}

		// UI not built: serve the hint page for any path
		if (!publicDirExists) {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(buildMissingUiPage());
			return;
		}

		// Static assets with traversal protection
		let pathname: string;
		try {
			pathname = decodeURIComponent(url.pathname);
		} catch {
			res.writeHead(400);
			res.end("Bad request");
			return;
		}
		if (pathname === "/") pathname = "/index.html";
		const root = path.resolve(publicDir);
		const filePath = path.resolve(root, "." + pathname);
		if (filePath !== root && !filePath.startsWith(root + path.sep)) {
			res.writeHead(403);
			res.end("Forbidden");
			return;
		}

		fs.stat(filePath, (err, stat) => {
			if (err || !stat.isFile()) {
				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("Not found");
				return;
			}
			res.writeHead(200, {
				"Content-Type": (lookup(filePath) || "application/octet-stream").toString(),
				"Content-Length": stat.size,
			});
			if (method === "HEAD") {
				res.end();
				return;
			}
			fs.createReadStream(filePath).pipe(res);
		});
	};

	const httpServer = http.createServer(requestListener);

	// --- WebSocket upgrade (token auth) ---------------------------------------
	const wss = new WebSocketServer({ noServer: true });

	httpServer.on("upgrade", (req, socket, head) => {
		let url: URL;
		try {
			url = new URL(req.url ?? "/", "http://localhost");
		} catch {
			socket.destroy();
			return;
		}
		if (url.pathname !== "/ws") {
			socket.destroy();
			return;
		}

		const ip = req.socket.remoteAddress ?? "unknown";
		const state = failures.get(ip);
		if (state && Date.now() < state.cooldownUntil) {
			socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}

		const presented = url.searchParams.get("token") ?? "";
		if (!safeTokenEqual(presented, token)) {
			recordFailure(ip);
			socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		failures.delete(ip);

		wss.handleUpgrade(req, socket, head, (ws) => {
			wss.emit("connection", ws, req);
		});
	});

	wss.on("connection", (ws: WebSocket) => {
		const meta: ClientMeta = { isAlive: true };
		clients.set(ws, meta);

		ws.on("pong", () => {
			meta.isAlive = true;
		});

		ws.on("message", (data, isBinary) => {
			if (isBinary) return; // protocol is one JSON object per text frame
			void handleClientMessage(ws, data.toString("utf8"));
		});

		ws.on("close", () => {
			clients.delete(ws);
		});
		ws.on("error", () => {
			clients.delete(ws);
		});
	});

	async function handleClientMessage(ws: WebSocket, raw: string): Promise<void> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (e: any) {
			const response = {
				id: undefined,
				type: "response",
				command: "parse",
				success: false,
				error: `Failed to parse command: ${e.message}`,
			} as RpcResponse;
			send(ws, response);
			return;
		}

		const message = parsed as { type?: string };
		if (message?.type === "extension_ui_response") {
			handler.handleExtensionUIResponse(parsed as RpcExtensionUIResponse);
			return;
		}

		// Replies route back to the requesting client only
		const reply = (m: RpcServerMessage): void => send(ws, m);
		const response = await handler.handleCommand(parsed as RpcCommand, reply);
		send(ws, response);

		if (handler.shutdownRequested) {
			void (async () => {
				await handler.runShutdownHooks();
				options.onShutdownRequested?.();
			})();
		}
	}

	// --- Heartbeat -------------------------------------------------------------
	const heartbeat = setInterval(() => {
		for (const [ws, meta] of clients) {
			if (!meta.isAlive) {
				ws.terminate();
				clients.delete(ws);
				continue;
			}
			meta.isAlive = false;
			ws.ping();
		}
	}, HEARTBEAT_INTERVAL_MS);
	heartbeat.unref();

	// --- Listen -----------------------------------------------------------------
	await new Promise<void>((resolve, reject) => {
		httpServer.once("error", reject);
		httpServer.listen(port, host, () => {
			httpServer.off("error", reject);
			resolve();
		});
	});

	const address = httpServer.address();
	const actualPort = typeof address === "object" && address !== null ? address.port : port;

	let closed = false;
	return {
		port: actualPort,
		host,
		get clientCount(): number {
			return clients.size;
		},
		close: async (): Promise<void> => {
			if (closed) return;
			closed = true;
			clearInterval(heartbeat);
			for (const ws of clients.keys()) {
				ws.terminate();
			}
			clients.clear();
			await new Promise<void>((resolve) => wss.close(() => resolve()));
			await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		},
	};
}
