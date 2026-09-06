/**
 * [WHO]: Provides runRemoteMode(), RemoteModeOptions
 * [FROM]: Depends on node:crypto, node:os, chalk, modes/remote/remote-server, modes/remote/tunnel, modes/remote/connection-info, modes/interactive/theme/theme
 * [TO]: Consumed by main.ts (dynamic import when --serve is passed)
 * [HERE]: modes/remote/remote-mode.ts - serve mode entry: per-run token, server lifecycle, banner/QR, tunnel, signal cleanup
 */
import * as crypto from "node:crypto";
import { hostname as osHostname } from "node:os";
import chalk from "chalk";
import { stopThemeWatcher } from "../interactive/theme/theme.js";
import type { AgentSession } from "../../core/runtime/agent-session.js";
import { createRemoteServer } from "./remote-server.js";
import { startQuickTunnel, CloudflaredNotFoundError, type QuickTunnel } from "./tunnel.js";
import {
	getLanIPv4Addresses,
	buildConnectDeepLink,
	renderQr,
	formatConnectionBanner,
} from "./connection-info.js";

export interface RemoteModeOptions {
	/** Listen port (default 8787). */
	port?: number;
	/** Bind address (default 0.0.0.0). */
	host?: string;
	/** Spawn a cloudflared quick tunnel for external access. */
	tunnel?: boolean;
	/** Fixed pairing token (unattended setups, e.g. behind frp). Default: fresh random token per run. */
	serveToken?: string;
	/** Advertised WebSocket endpoint for the QR/deep link (e.g. ws://frp-host:8787/ws). */
	advertiseUrl?: string;
}

/**
 * Run remote serve mode: HTTP + WebSocket server for mobile/browser clients.
 * Uses the fixed pairing token from options.serveToken when provided (for
 * unattended setups behind frp), else generates a fresh 192-bit token per run
 * (never persisted). Prints connect URLs + QR, optionally exposes a public
 * tunnel, and cleans up on SIGINT/SIGTERM or extension-initiated shutdown.
 * Never returns.
 */
export async function runRemoteMode(session: AgentSession, options: RemoteModeOptions = {}): Promise<never> {
	const token = options.serveToken?.trim() || crypto.randomBytes(24).toString("base64url");
	if (options.serveToken?.trim()) {
		console.log(chalk.yellow("[remote] fixed pairing token (--token): survives restarts — keep it private."));
	}

	const server = await createRemoteServer({
		session,
		token,
		port: options.port,
		host: options.host,
		onShutdownRequested: () => {
			void shutdown("extension request");
		},
	});

	// Serve mode defers MCP init like interactive mode (deferMcpInit=true in
	// main.ts); warm up in the background so the server is up instantly.
	void session.warmupMcpTools();

	const hostName = osHostname();
	const addresses = getLanIPv4Addresses();

	let tunnel: QuickTunnel | undefined;
	if (options.tunnel) {
		console.log(chalk.dim("[remote] starting cloudflared quick tunnel..."));
		try {
			tunnel = await startQuickTunnel(server.port);
			console.log(chalk.green(`[remote] tunnel up: https://${tunnel.hostname}`));
		} catch (e) {
			if (e instanceof CloudflaredNotFoundError) {
				console.error(chalk.yellow("[remote] cloudflared not found — continuing LAN-only."));
				console.error(chalk.yellow("  Install it (e.g. winget install --id Cloudflare.cloudflared)"));
				console.error(chalk.yellow("  or set CLOUDFLARED_PATH, then restart with --tunnel."));
			} else {
				const message = e instanceof Error ? e.message : String(e);
				console.error(chalk.yellow(`[remote] tunnel failed: ${message} — continuing LAN-only.`));
			}
		}
	}

	console.log(
		formatConnectionBanner({
			hostname: hostName,
			port: server.port,
			token,
			addresses,
			tunnelHostname: tunnel?.hostname,
		}),
	);

	// QR carries the best single endpoint plus fallbacks: explicitly advertised
	// endpoint (unattended frp setups) > public tunnel > ordered LAN addresses
	// (physical ranges first, virtual switches like VMware/WSL last — the app
	// tries them in order).
	let qrEndpoint: string | undefined;
	let altEndpoints: string[] = [];
	const advertise = options.advertiseUrl?.trim();
	if (advertise) {
		qrEndpoint = /\/ws$/.test(advertise) ? advertise : advertise.endsWith("/") ? `${advertise}ws` : `${advertise}/ws`;
		altEndpoints = addresses.map((address) => `ws://${address}:${server.port}/ws`);
	} else if (tunnel) {
		qrEndpoint = `wss://${tunnel.hostname}/ws`;
	} else if (addresses.length > 0) {
		qrEndpoint = `ws://${addresses[0]}:${server.port}/ws`;
		altEndpoints = addresses.slice(1).map((address) => `ws://${address}:${server.port}/ws`);
	}
	if (qrEndpoint) {
		const deepLink = buildConnectDeepLink(qrEndpoint, token, hostName, altEndpoints);
		try {
			const qr = await renderQr(deepLink);
			console.log(qr);
			console.log(chalk.dim("Scan with the Catui mobile app to pair."));
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			console.error(chalk.yellow(`[remote] QR render failed (${message}); deep link: ${deepLink}`));
		}
	}

	async function shutdown(reason: string): Promise<void> {
		console.error(chalk.dim(`\n[remote] shutting down (${reason})...`));
		try {
			await server.close();
		} catch {
			/* already closed */
		}
		try {
			await tunnel?.stop();
		} catch {
			/* already stopped */
		}
		stopThemeWatcher();
		process.exit(0);
	}

	process.once("SIGINT", () => {
		void shutdown("SIGINT");
	});
	process.once("SIGTERM", () => {
		void shutdown("SIGTERM");
	});

	return new Promise(() => {});
}
