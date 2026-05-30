/**
 * MCP Extension
 *
 * Provides MCP (Model Context Protocol) guidance resources.
 * Runtime MCP tool loading is handled by the AgentSession SDK.
 */
/**
 * [WHO]: Extension interface
 * [FROM]: Depends on node:fs, node:path, node:url, ../../../config.js, ../../../core/platform/config/auth-storage.js
 * [TO]: Loaded by core/extensions-host/loader.ts as extension entry point
 * [HERE]: extensions/builtin/mcp/index.ts -
 */


import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAuthPath } from "../../../config.js";
import { AuthStorage } from "../../../core/platform/config/auth-storage.js";
import {
	findImportableFigmaOAuthSession,
	refreshFigmaOAuthCredentials,
	type FigmaOAuthCredentials,
} from "../../../core/mcp/figma-auth.js";
import { getMCPServer, setMCPServerEnabled } from "../../../core/mcp/mcp-config.js";
import type { ExtensionAPI, ExtensionCommandContext } from "../../../core/extensions-host/types.js";
import type {
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
} from "../../../core/extensions-host/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SKILL_PATH = join(__dirname, "mcp-management.md");
const FIGMA_SKILL_PATH = join(__dirname, "figma-design.md");
const FIGMA_DESKTOP_URL = "http://127.0.0.1:3845/mcp";
const FIGMA_REMOTE_URL = "https://mcp.figma.com/mcp";
const FIGMA_COMMAND_COMPLETIONS = [
	{ value: "help", label: "help", description: "Show setup steps" },
	{ value: "auth", label: "auth", description: "Sign in to Figma" },
	{ value: "remote", label: "remote", description: "Enable the remote MCP path" },
	{ value: "setup", label: "setup", description: "Probe and enable the best Figma path" },
	{ value: "status", label: "status", description: "Inspect the current connection" },
	{ value: "logout", label: "logout", description: "Remove saved Figma credentials" },
	{ value: "enable", label: "enable", description: "Enable the desktop MCP preset" },
	{ value: "disable", label: "disable", description: "Disable the desktop MCP preset" },
] as const;

function getFigmaAuthStorage(): AuthStorage {
	return AuthStorage.create(getAuthPath());
}

function getFigmaArgumentCompletions(
	argumentPrefix: string,
	context?: { tokenIndex: number },
): Array<{ value: string; label: string; description?: string }> | null {
	if (context && context.tokenIndex > 0) return null;
	const prefix = argumentPrefix.trim().toLowerCase();
	const values = FIGMA_COMMAND_COMPLETIONS.filter((item) => item.value.startsWith(prefix));
	return values.length > 0 ? values.map((item) => ({ ...item })) : null;
}

async function getFigmaAccessToken(): Promise<string | undefined> {
	return getFigmaAuthStorage().getApiKey("figma");
}

async function refreshStoredFigmaCredentials(): Promise<string | undefined> {
	const storage = getFigmaAuthStorage();
	const current = storage.get("figma");
	if (!current || current.type !== "oauth") {
		return undefined;
	}

	const refreshed = await refreshFigmaOAuthCredentials(current as unknown as FigmaOAuthCredentials);
	storage.set("figma", { type: "oauth", ...refreshed });
	return refreshed.access;
}

async function probeFigmaDesktopEndpoint(): Promise<{ reachable: boolean; detail?: string }> {
	try {
		const response = await fetch(FIGMA_DESKTOP_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
				"MCP-Protocol-Version": "2025-03-26",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "nano-pencil", version: "1.11.12" },
				},
			}),
			signal: AbortSignal.timeout(4000),
		});

		if (response.ok || response.status === 400 || response.status === 401 || response.status === 405) {
			return { reachable: true, detail: `${response.status} ${response.statusText}` };
		}

		return { reachable: false, detail: `${response.status} ${response.statusText}` };
	} catch (error) {
		return {
			reachable: false,
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

async function probeFigmaRemoteEndpoint(
	token?: string,
): Promise<{ reachable: boolean; authenticated: boolean; detail?: string }> {
	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			"MCP-Protocol-Version": "2025-03-26",
		};
		if (token) {
			headers.Authorization = `Bearer ${token}`;
		}

		const response = await fetch(FIGMA_REMOTE_URL, {
			method: "POST",
			headers,
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: { name: "nano-pencil", version: "1.11.12" },
				},
			}),
			signal: AbortSignal.timeout(5000),
		});

		if (response.ok) {
			return { reachable: true, authenticated: true, detail: `${response.status} ${response.statusText}` };
		}

		if (response.status === 401) {
			return {
				reachable: true,
				authenticated: false,
				detail: token ? "401 Unauthorized (token rejected or expired)" : "401 Unauthorized (authentication required)",
			};
		}

		return {
			reachable: response.status < 500,
			authenticated: false,
			detail: `${response.status} ${response.statusText}`,
		};
	} catch (error) {
		return {
			reachable: false,
			authenticated: false,
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

export default async function mcpExtension(api: ExtensionAPI) {
	api.registerCommand("figma", {
		description: "Connect NanoPencil to Figma for generative design",
		getArgumentCompletions: getFigmaArgumentCompletions,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const [rawAction, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const action = (rawAction || "help").toLowerCase();
			if (action === "help") {
				const importable = findImportableFigmaOAuthSession();
				api.sendMessage({
					customType: "text",
					content:
						`Figma setup:\n1. Run \`/figma auth\`. NanoPencil will try a standalone browser OAuth flow first.${importable ? ` If Figma refuses first-time client registration, it can fall back to the existing ${importable.source} session on this machine.` : ""}\n2. Run \`/figma remote\` to enable the built-in remote MCP preset and reload the session.\n3. If you prefer the local desktop route, open the Figma desktop app, enable its MCP server in Dev Mode, and run \`/figma setup\`.\n4. Then ask me to generate or edit a design in Figma.\n\nAdvanced: you can also set \`NANOPENCIL_FIGMA_CLIENT_ID\` and \`NANOPENCIL_FIGMA_CLIENT_SECRET\` before running NanoPencil.\n\nUse \`/figma status\` to inspect the current connection.`,
					display: true,
				});
				return;
			}

			if (action === "setup" || action === "connect") {
				let remoteToken = await getFigmaAccessToken();
				if (!remoteToken && findImportableFigmaOAuthSession()) {
					try {
						await getFigmaAuthStorage().login("figma", {
							onAuth: (info) => {
								api.sendMessage({
									customType: "text",
									content: `${info.instructions ?? "Figma authentication requires additional setup."}\n\n${info.url}`,
									display: true,
								});
							},
							onPrompt: async (prompt) => (await ctx.ui.input("Figma Auth", prompt.message, { initialValue: prompt.placeholder ?? "" })) ?? "",
							onProgress: (message) => {
								api.sendMessage({
									customType: "text",
									content: message,
									display: true,
								});
							},
						});
						remoteToken = await getFigmaAccessToken();
					} catch {
						// Ignore and continue to desktop fallback.
					}
				}
				if (remoteToken) {
					let remoteProbe = await probeFigmaRemoteEndpoint(remoteToken);
					if (!remoteProbe.authenticated) {
						const refreshedToken = await refreshStoredFigmaCredentials().catch(() => undefined);
						if (refreshedToken) {
							remoteToken = refreshedToken;
							remoteProbe = await probeFigmaRemoteEndpoint(remoteToken);
						}
					}
					if (remoteProbe.reachable && remoteProbe.authenticated) {
						setMCPServerEnabled("figma-remote", true);
						api.sendMessage({
							customType: "text",
							content:
								`The remote Figma MCP endpoint is reachable (${remoteProbe.detail ?? "ok"}). Enabled the built-in \`figma-remote\` preset and reloading now so NanoPencil can pick up the Figma tools.`,
							display: true,
						});
						await ctx.reload();
						return;
					}
				}

				const probe = await probeFigmaDesktopEndpoint();
				if (!probe.reachable) {
					const importHint = findImportableFigmaOAuthSession();
					api.sendMessage({
						customType: "text",
						content:
							`I could not reach the local Figma Desktop MCP endpoint at ${FIGMA_DESKTOP_URL}.\n\nNext steps:\n1. For the remote path, run \`/figma auth\`${importHint ? ` to try NanoPencil OAuth first and then fall back to the existing ${importHint.source} session if needed` : ""}.\n2. Then run \`/figma remote\`.\n3. Or open the Figma desktop app, turn on the Figma MCP server in Dev Mode, and run \`/figma setup\` again.\n\nProbe detail: ${probe.detail ?? "connection failed"}`,
						display: true,
					});
					return;
				}

				setMCPServerEnabled("figma-desktop", true);
				api.sendMessage({
					customType: "text",
					content:
						`The local Figma MCP endpoint is reachable (${probe.detail ?? "ok"}). Enabled the built-in \`figma-desktop\` MCP preset and reloading now so NanoPencil can pick up the Figma tools.`,
					display: true,
				});
				await ctx.reload();
				return;
			}

			if (action === "login" || action === "auth") {
				try {
					await getFigmaAuthStorage().login("figma", {
						onAuth: (info) => {
							api.sendMessage({
								customType: "text",
								content: `${info.instructions ?? "Figma authentication needs another official client session."}\n\n${info.url}`,
								display: true,
							});
						},
						onPrompt: async (prompt) => (await ctx.ui.input("Figma Auth", prompt.message, { initialValue: prompt.placeholder ?? "" })) ?? "",
						onProgress: (message) => {
							api.sendMessage({
								customType: "text",
								content: message,
								display: true,
							});
						},
					});
					api.sendMessage({
						customType: "text",
						content:
							"Saved Figma OAuth credentials in auth storage. Run `/figma remote` to enable the remote MCP preset and connect NanoPencil to Figma.",
						display: true,
					});
				} catch (error) {
					api.sendMessage({
						customType: "text",
						content: error instanceof Error ? error.message : String(error),
						display: true,
					});
				}
				return;
			}

			if (action === "logout") {
				getFigmaAuthStorage().logout("figma");
				api.sendMessage({
					customType: "text",
					content:
						"Removed the saved Figma OAuth credentials from auth storage. Run `/reload` if you want the current session to drop remote Figma access immediately.",
					display: true,
				});
				return;
			}

			if (action === "enable") {
				setMCPServerEnabled("figma-desktop", true);
				api.sendMessage({
					customType: "text",
					content:
						"Enabled the built-in `figma-desktop` MCP preset. Reloading now so NanoPencil can pick up the Figma tools.",
					display: true,
				});
				await ctx.reload();
				return;
			}

			if (action === "disable") {
				setMCPServerEnabled("figma-desktop", false);
				api.sendMessage({
					customType: "text",
					content:
						"Disabled the built-in `figma-desktop` MCP preset. Run `/reload` if you want the current session to drop the Figma tools immediately.",
					display: true,
				});
				return;
			}

			if (action === "remote") {
				const token = await getFigmaAccessToken();
				if (!token) {
					api.sendMessage({
						customType: "text",
						content:
							"No Figma OAuth session is configured yet. Run `/figma auth` first, then run `/figma remote` again.",
						display: true,
					});
					return;
				}

				let probe = await probeFigmaRemoteEndpoint(token);
				if (!probe.authenticated) {
					const refreshedToken = await refreshStoredFigmaCredentials().catch(() => undefined);
					if (refreshedToken) {
						probe = await probeFigmaRemoteEndpoint(refreshedToken);
					}
				}
				if (!probe.reachable || !probe.authenticated) {
					api.sendMessage({
						customType: "text",
						content:
							`I could reach the remote Figma MCP endpoint, but authentication is not working yet.\n\nDetail: ${probe.detail ?? "authentication failed"}\n\nRun \`/figma auth\` again and retry. If standalone registration is blocked by Figma, NanoPencil will fall back to any existing official local session it can import.`,
						display: true,
					});
					return;
				}

				setMCPServerEnabled("figma-remote", true);
				api.sendMessage({
					customType: "text",
					content:
						"Enabled the built-in `figma-remote` MCP preset. Reloading now so NanoPencil can pick up the authenticated remote Figma tools.",
					display: true,
				});
				await ctx.reload();
				return;
			}

			if (action === "status") {
				const desktop = getMCPServer("figma-desktop");
				const remote = getMCPServer("figma-remote");
				const probe = await probeFigmaDesktopEndpoint();
				let remoteToken = await getFigmaAccessToken();
				const importable = findImportableFigmaOAuthSession();
				let remoteProbe = await probeFigmaRemoteEndpoint(remoteToken);
				if (!remoteProbe.authenticated) {
					const refreshedToken = await refreshStoredFigmaCredentials().catch(() => undefined);
					if (refreshedToken) {
						remoteToken = refreshedToken;
						remoteProbe = await probeFigmaRemoteEndpoint(remoteToken);
					}
				}
				const figmaTools = api
					.getAllTools()
					.filter(
						(tool) =>
							tool.name.includes("figma") ||
							tool.description.toLowerCase().includes("figma"),
					);

				const lines = [
					"Figma MCP status",
					"",
					`figma-desktop: ${desktop?.enabled === false ? "disabled" : "enabled"}`,
					`desktop endpoint: ${probe.reachable ? "reachable" : "unreachable"}`,
					`desktop detail: ${probe.detail ?? "unknown"}`,
					`figma-remote: ${remote?.enabled === false ? "disabled" : "enabled"}`,
					`importable local OAuth session: ${importable ? `yes (${importable.source})` : "no"}`,
					`remote OAuth configured: ${remoteToken ? "yes" : "no"}`,
					`remote endpoint: ${remoteProbe.reachable ? "reachable" : "unreachable"}`,
					`remote auth: ${remoteProbe.authenticated ? "ok" : "not authenticated"}`,
					`remote detail: ${remoteProbe.detail ?? "unknown"}`,
					`registered figma tools in this session: ${figmaTools.length}`,
				];

				if (figmaTools.length === 0) {
					lines.push("");
					lines.push("If you want the remote path, run `/figma auth` and then `/figma remote`.");
					lines.push("If the desktop app is ready, run `/figma setup`.");
					lines.push("If either route is already enabled, run `/reload` and try again.");
				}

				api.sendMessage({
					customType: "text",
					content: lines.join("\n"),
					display: true,
				});
				return;
			}

			api.sendMessage({
				customType: "text",
				content: "Usage: /figma [help|setup|connect|login|auth|logout|enable|disable|status|remote]",
				display: true,
			});
		},
	});

	api.on("resources_discover", async (_event: ResourcesDiscoverEvent): Promise<ResourcesDiscoverResult> => {
		const skillPaths: string[] = [];
		if (existsSync(MCP_SKILL_PATH)) {
			skillPaths.push(MCP_SKILL_PATH);
		}
		if (existsSync(FIGMA_SKILL_PATH)) {
			skillPaths.push(FIGMA_SKILL_PATH);
		}

		if (skillPaths.length === 0) {
			return {};
		}

		return {
			skillPaths,
		};
	});
}
