/**
 * [WHO]: Provides startQuickTunnel(), QuickTunnel, CloudflaredNotFoundError
 * [FROM]: Depends on node:child_process
 * [TO]: Consumed by modes/remote/remote-mode.ts
 * [HERE]: modes/remote/tunnel.ts - cloudflared quick tunnel lifecycle (spawn/parse/cleanup)
 */
import { spawn, type ChildProcess } from "node:child_process";

/** A running cloudflared quick tunnel exposing the local server publicly. */
export interface QuickTunnel {
	/** Public hostname without scheme, e.g. "abc-def-xyz.trycloudflare.com". */
	hostname: string;
	/** Stop the tunnel process (best effort, never throws). */
	stop(): Promise<void>;
}

/** Thrown when cloudflared is not installed / not on PATH. Never fatal: LAN keeps serving. */
export class CloudflaredNotFoundError extends Error {
	constructor() {
		super("cloudflared binary not found");
		this.name = "CloudflaredNotFoundError";
	}
}

const TUNNEL_URL_PATTERN = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
const TUNNEL_START_TIMEOUT_MS = 15_000;

/** Resolve the cloudflared binary: CLOUDFLARED_PATH env override, else PATH probe. */
async function resolveBinary(): Promise<string | undefined> {
	const envPath = process.env.CLOUDFLARED_PATH;
	if (envPath) return envPath;
	if (process.platform === "win32") {
		// Windows: shell spawn so PATHEXT resolution applies (.exe, .cmd shims, ...)
		return (await probeCommand("cloudflared", true)) ? "cloudflared" : undefined;
	}
	return (await probeCommand("cloudflared", false)) ? "cloudflared" : undefined;
}

async function probeCommand(command: string, shell: boolean): Promise<boolean> {
	try {
		const probe = spawn(command, ["--version"], { stdio: "ignore", shell });
		const code = await new Promise<number | null>((resolve) => {
			probe.on("error", () => resolve(null));
			probe.on("close", (exitCode) => resolve(exitCode));
		});
		return code === 0;
	} catch {
		return false;
	}
}

function stopChild(child: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolve();
			return;
		}
		const pid = child.pid;
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(killTimer);
			resolve();
		};

		child.on("exit", finish);
		// Windows: child.kill() only terminates the wrapper; taskkill /T kills the process tree
		if (process.platform === "win32" && pid) {
			spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
				.on("exit", finish)
				.on("error", finish);
		} else {
			child.kill("SIGTERM");
		}
		// Hard fallback so stop() never hangs
		const killTimer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				/* already gone */
			}
			finish();
		}, 5_000);
		killTimer.unref?.();
	});
}

/**
 * Start a cloudflared quick tunnel pointing at the local HTTP server.
 * Resolves once the public trycloudflare.com URL has been parsed from stderr.
 * Rejects with CloudflaredNotFoundError (binary missing) or Error (exited/timeout).
 */
export async function startQuickTunnel(port: number): Promise<QuickTunnel> {
	const binary = await resolveBinary();
	if (!binary) {
		throw new CloudflaredNotFoundError();
	}

	const child = spawn(
		binary,
		["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
		{ stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
	);

	let stderrTail = "";
	let hostname: string | undefined;

	await new Promise<void>((resolve, reject) => {
		const started = Date.now();

		const poll = setInterval(() => {
			const match = TUNNEL_URL_PATTERN.exec(stderrTail);
			if (match) {
				hostname = match[0].slice("https://".length);
				cleanup();
				resolve();
				return;
			}
			if (child.exitCode !== null || child.signalCode !== null) {
				cleanup();
				reject(new Error(`cloudflared exited early (code ${child.exitCode ?? child.signalCode}): ${stderrTail.slice(-400)}`));
				return;
			}
			if (Date.now() - started > TUNNEL_START_TIMEOUT_MS) {
				cleanup();
				reject(new Error(`Timed out after ${TUNNEL_START_TIMEOUT_MS / 1000}s waiting for the tunnel URL`));
			}
		}, 100);

		const onStderr = (chunk: Buffer) => {
			stderrTail = (stderrTail + chunk.toString("utf8")).slice(-8_000);
		};
		const onError = (err: Error) => {
			cleanup();
			reject(err);
		};

		const cleanup = () => {
			clearInterval(poll);
			child.stderr?.off("data", onStderr);
			child.off("error", onError);
		};

		child.stderr?.on("data", onStderr);
		child.on("error", onError);
	});

	// Track the child so stop() can kill it even after we resolved
	let stopped = false;
	return {
		hostname: hostname as string,
		stop: async () => {
			if (stopped) return;
			stopped = true;
			await stopChild(child);
		},
	};
}
