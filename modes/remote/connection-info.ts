/**
 * [WHO]: Provides getLanIPv4Addresses(), buildConnectDeepLink(), renderQr(), formatConnectionBanner()
 * [FROM]: Depends on node:os, node:url, chalk, qrcode
 * [TO]: Consumed by modes/remote/remote-mode.ts
 * [HERE]: modes/remote/connection-info.ts - LAN discovery + ordering, multi-endpoint deep link building, QR + banner rendering
 */
import * as os from "node:os";
import chalk from "chalk";
import QRCode from "qrcode";

/**
 * Enumerate LAN IPv4 addresses suitable for pairing display.
 * Skips internal/loopback (127.*) and unconfigured link-local (169.254.*) interfaces.
 * Tailscale (100.64/10) and VPN addresses are kept — they are valid direct-connect targets.
 */
export function getLanIPv4Addresses(): string[] {
	const out: { address: string; mac: string }[] = [];
	for (const interfaces of Object.values(os.networkInterfaces())) {
		for (const iface of interfaces ?? []) {
			if (iface.family !== "IPv4" || iface.internal) continue;
			if (iface.address.startsWith("127.") || iface.address.startsWith("169.254.")) continue;
			out.push({ address: iface.address, mac: iface.mac });
		}
	}
	return orderLanAddresses(out);
}

/**
 * Order candidate addresses best-first for QR pairing.
 * Primary signal: MAC OUI of well-known virtual switches (VMware VMnet,
 * Hyper-V/WSL vEthernet, VirtualBox Host-Only) — phones never live there.
 * Secondary signal: physical-LAN ranges (192.168/16, 10/8) over 172.16/12
 * (WSL NAT, Docker). The deep link carries the rest as fallbacks, so
 * ordering only decides what the app tries first.
 */
function orderLanAddresses(entries: { address: string; mac: string }[]): string[] {
	const VIRTUAL_MAC_PREFIXES = ["00:50:56", "00:0c:29", "00:15:5d", "08:00:27", "0a:00:27"];
	const score = ({ address, mac }: { address: string; mac: string }): number => {
		if (VIRTUAL_MAC_PREFIXES.some((prefix) => mac.toLowerCase().startsWith(prefix))) return 3;
		if (address.startsWith("192.168.") || address.startsWith("10.")) return 0;
		if (address.startsWith("172.")) return 2;
		return 1; // Tailscale 100.64/10, VPN and anything else
	};
	return entries
		.map((entry) => ({ entry, score: score(entry) }))
		.sort((a, b) => a.score - b.score)
		.map(({ entry }) => entry.address);
}

/**
 * Build the `catui://connect` deep link consumed by the mobile app (scan-to-pair).
 * `altEndpoints` carries the remaining LAN addresses; the app tries the primary
 * first and falls back through the alternates when the host has multiple NICs
 * (physical LAN + VMware/WSL virtual switches).
 */
export function buildConnectDeepLink(
	wsEndpoint: string,
	token: string,
	hostname: string,
	altEndpoints: string[] = [],
): string {
	const params = new URLSearchParams({ endpoint: wsEndpoint, token, name: hostname });
	if (altEndpoints.length > 0) {
		params.set("alt", altEndpoints.join(","));
	}
	return `catui://connect?${params.toString()}`;
}

/** Render a terminal QR code for the given payload. */
export async function renderQr(payload: string): Promise<string> {
	return QRCode.toString(payload, { type: "terminal", small: true });
}

export interface ConnectionBannerInput {
	hostname: string;
	port: number;
	token: string;
	/** LAN (or Tailscale/VPN) IPv4 addresses to advertise. */
	addresses: string[];
	/** cloudflared quick tunnel hostname (e.g. "abc-def.trycloudflare.com") when enabled. */
	tunnelHostname?: string;
}

/** Format the serve-mode startup banner (URLs + token + QR + security hints). */
export function formatConnectionBanner(input: ConnectionBannerInput): string {
	const lines: string[] = [];
	const rule = chalk.dim("─".repeat(58));

	lines.push(rule);
	lines.push(chalk.bold("Catui remote — agent serving on this machine"));
	lines.push("");
	lines.push(`${chalk.bold("Host:")} ${input.hostname}   ${chalk.bold("Port:")} ${input.port}`);
	lines.push("");

	if (input.addresses.length > 0) {
		lines.push(chalk.bold("Open in a browser (LAN / VPN):"));
		for (const address of input.addresses) {
			lines.push(`  ${chalk.cyan(`http://${address}:${input.port}/?token=${input.token}`)}`);
		}
		lines.push("");
	}

	if (input.tunnelHostname) {
		lines.push(chalk.bold("External network (cloudflared quick tunnel):"));
		lines.push(`  ${chalk.cyan(`https://${input.tunnelHostname}/?token=${input.token}`)}`);
		lines.push(chalk.yellow("  Note: public URL — anyone with it can reach the login page (token still required)."));
		lines.push("");
	}

	if (input.addresses.length === 0 && !input.tunnelHostname) {
		lines.push(chalk.yellow("No non-internal IPv4 addresses found."));
		lines.push(chalk.yellow("Use --host to bind a specific interface, or --tunnel for external access."));
		lines.push("");
	}

	lines.push(`${chalk.bold("Token:")} ${input.token}`);
	lines.push(chalk.dim("  Treat the token as a password — it grants full agent control (incl. bash)."));
	lines.push("");
	lines.push(chalk.bold("Stop the server:") + " Ctrl+C");
	lines.push(rule);

	return lines.join("\n");
}
