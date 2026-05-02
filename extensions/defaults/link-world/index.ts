/**
 * [WHO]: linkWorldExtension - registers link_world_admin/link_world_exec tools, /link-world command, runtime diagnostics, and internet-search skill resources
 * [FROM]: Depends on node:child_process, node:fs, node:path, node:url, @sinclair/typebox, @pencil-agent/tui, core/extensions/types
 * [TO]: Loaded by core/extensions/loader.ts as extension entry point
 * [HERE]: extensions/defaults/link-world/index.ts - built-in internet access bootstrap, execution bridge, and workspace discovery
 */

import { execFile, execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import { Box, Container, Spacer, Text } from "@pencil-agent/tui";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
	ToolDefinition,
} from "../../../core/extensions/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = join(__dirname, "linkworld.md");
const SKILL_PATH = join(__dirname, "internet-search", "internet-search.md");
const AGENT_SKILL_PATH = join(__dirname, "link-world-agent.md");
const NETWORK_ROUTING_SKILL_PATH = join(__dirname, "network-routing.md");
const WORKSPACE_TEMPLATE_PATH = join(__dirname, "agent-workspace");

const LINK_WORLD_CUSTOM_TYPE = "link-world-install";
const DEFAULT_TIMEOUT_SECONDS = 120;

const LinkWorldAdminInputSchema = Type.Object(
	{
		action: Type.Union([
			Type.Literal("status"),
			Type.Literal("doctor"),
			Type.Literal("version"),
			Type.Literal("install_help"),
		]),
		timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Defaults to 120." })),
	},
	{ additionalProperties: false },
);

const LinkWorldExecInputSchema = Type.Object(
	{
		args: Type.Array(Type.String(), {
			description:
				"Arguments passed to the external `agent-reach` CLI, for example [\"search\", \"OpenAI Responses API\"] or [\"doctor\"].",
		}),
		timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Defaults to 120." })),
	},
	{ additionalProperties: false },
);

const WebSearchInputSchema = Type.Object(
	{
		query: Type.String({ description: "Search query to send through link-world." }),
		provider: Type.Optional(Type.String({ description: "Optional provider or site hint, if the downstream runtime supports it." })),
		limit: Type.Optional(Type.Number({ description: "Optional result count hint, if the downstream runtime supports it." })),
		timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Defaults to 120." })),
	},
	{ additionalProperties: false },
);

const WebFetchInputSchema = Type.Object(
	{
		url: Type.String({ description: "URL to fetch through link-world." }),
		provider: Type.Optional(Type.String({ description: "Optional provider or site hint, if the downstream runtime supports it." })),
		timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Defaults to 120." })),
	},
	{ additionalProperties: false },
);

type LinkWorldAdminInput = Static<typeof LinkWorldAdminInputSchema>;
type LinkWorldExecInput = Static<typeof LinkWorldExecInputSchema>;
type WebSearchInput = Static<typeof WebSearchInputSchema>;
type WebFetchInput = Static<typeof WebFetchInputSchema>;

interface CliResult {
	exitCode: number | null;
	output: string;
}

function linkWorldWorkspacePath(cwd: string): string {
	return join(cwd, ".nanopencil", "link-world-workspace");
}

function ensureLinkWorldWorkspace(cwd: string): string {
	const target = linkWorldWorkspacePath(cwd);
	if (!existsSync(target)) {
		mkdirSync(dirname(target), { recursive: true });
		if (existsSync(WORKSPACE_TEMPLATE_PATH)) {
			cpSync(WORKSPACE_TEMPLATE_PATH, target, { recursive: true });
		} else {
			mkdirSync(target, { recursive: true });
		}
	}
	return target;
}

function collectMarkdownFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}

	const out: string[] = [];
	for (const entry of readdirSync(root)) {
		const fullPath = join(root, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			out.push(...collectMarkdownFiles(fullPath));
			continue;
		}
		if (entry.endsWith(".md")) {
			out.push(fullPath);
		}
	}
	return out.sort();
}

function getInstallDoc(): string {
	try {
		return readFileSync(DOC_PATH, "utf-8");
	} catch {
		return "";
	}
}

function isAgentReachInstalled(): boolean {
	try {
		execSync("agent-reach --version", { encoding: "utf-8", stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

function execAgentReach(args: string[], timeoutSeconds: number, signal?: AbortSignal): Promise<CliResult> {
	return new Promise((resolve, reject) => {
		execFile(
			"agent-reach",
			args,
			{
				timeout: timeoutSeconds * 1000,
				windowsHide: true,
				signal,
				maxBuffer: 1024 * 1024,
				encoding: "utf-8",
			},
			(error, stdout, stderr) => {
				const output = [stdout, stderr].filter(Boolean).join("").trim() || "(no output)";
				if (error) {
					const anyError = error as NodeJS.ErrnoException & { code?: string | number };
					if (anyError.code === "ENOENT") {
						reject(new Error("agent-reach is not installed"));
						return;
					}
					resolve({
						exitCode: typeof anyError.code === "number" ? anyError.code : 1,
						output,
					});
					return;
				}

				resolve({
					exitCode: 0,
					output,
				});
			},
		);
	});
}

function installHelpText(): string {
	const doc = getInstallDoc();
	if (doc) {
		return [
			"link-world is not bundled yet, so installation still targets the external `agent-reach` runtime.",
			"",
			"Use this document as the source of truth:",
			"",
			doc,
		].join("\n");
	}

	return [
		"link-world is not bundled yet, and the local install guide is missing.",
		"Use the official install document:",
		"https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md",
	].join("\n");
}

function getStatusText(): string {
	const installed = isAgentReachInstalled();
	const lines = [
		"Link-world status",
		"",
		`agent-reach installed: ${installed ? "yes" : "no"}`,
		`internet-search skill bundled: ${existsSync(SKILL_PATH) ? "yes" : "no"}`,
		`agent guidance bundled: ${existsSync(AGENT_SKILL_PATH) ? "yes" : "no"}`,
	];

	if (!installed) {
		lines.push("");
		lines.push("Run `/link-world install` to view the installation guide.");
		lines.push("After installation, run `/link-world doctor` to validate the setup.");
	}

	return lines.join("\n");
}

function createLinkWorldAdminTool(): ToolDefinition<typeof LinkWorldAdminInputSchema> {
	return {
		name: "link_world_admin",
		label: "link-world admin",
		description:
			"Inspect or troubleshoot the built-in link-world integration. Use for install guidance, version checks, and agent-reach doctor/status commands.",
		parameters: LinkWorldAdminInputSchema,
		guidance:
			"Use this before attempting internet tasks if you are unsure whether agent-reach is installed. Prefer action=status or action=doctor for diagnostics.",
		execute: async (_toolCallId, input: LinkWorldAdminInput, signal) => {
			if (input.action === "install_help") {
				return {
					content: [{ type: "text", text: installHelpText() }],
					details: null,
				};
			}

			if (input.action === "status") {
				return {
					content: [{ type: "text", text: getStatusText() }],
					details: null,
				};
			}

			if (!isAgentReachInstalled()) {
				throw new Error(`${getStatusText()}\n\n${installHelpText()}`);
			}

			const cliArgs = input.action === "doctor" ? ["doctor"] : ["--version"];
			const result = await execAgentReach(cliArgs, input.timeout ?? DEFAULT_TIMEOUT_SECONDS, signal);
			if (result.exitCode && result.exitCode !== 0) {
				throw new Error(result.output);
			}

			return {
				content: [{ type: "text", text: result.output }],
				details: { exitCode: result.exitCode },
			};
		},
	};
}

function createLinkWorldExecTool(): ToolDefinition<typeof LinkWorldExecInputSchema> {
	return {
		name: "link_world_exec",
		label: "link-world exec",
		description:
			"Execute the external `agent-reach` CLI through NanoPencil. Use this for actual internet tasks once link-world is installed, instead of going through the bash tool.",
		parameters: LinkWorldExecInputSchema,
		guidance:
			"Use `link_world_admin` first if you are unsure whether agent-reach is installed. Pass explicit CLI arguments, not a shell string. Prefer site or domain skills before inventing new agent-reach commands.",
		execute: async (_toolCallId, input: LinkWorldExecInput, signal) => {
			if (!isAgentReachInstalled()) {
				throw new Error(`${getStatusText()}\n\n${installHelpText()}`);
			}

			if (input.args.length === 0) {
				throw new Error("link_world_exec requires at least one CLI argument");
			}

			const result = await execAgentReach(input.args, input.timeout ?? DEFAULT_TIMEOUT_SECONDS, signal);
			if (result.exitCode && result.exitCode !== 0) {
				throw new Error(result.output);
			}

			return {
				content: [{ type: "text", text: result.output }],
				details: { exitCode: result.exitCode, args: input.args },
			};
		},
	};
}

function createWebSearchTool(): ToolDefinition<typeof WebSearchInputSchema> {
	return {
		name: "web_search",
		label: "web search",
		description:
			"High-level internet search through link-world. Prefer this for normal search tasks instead of constructing raw agent-reach argv yourself.",
		parameters: WebSearchInputSchema,
		guidance:
			"Use this for ordinary web search and lightweight research tasks. Use link_world_exec only when you need a lower-level agent-reach command that this tool does not model.",
		execute: async (_toolCallId, input: WebSearchInput, signal) => {
			if (!isAgentReachInstalled()) {
				throw new Error(`${getStatusText()}\n\n${installHelpText()}`);
			}

			const args = ["search", input.query];
			if (input.provider) {
				args.push("--provider", input.provider);
			}
			if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
				args.push("--limit", String(input.limit));
			}

			const result = await execAgentReach(args, input.timeout ?? DEFAULT_TIMEOUT_SECONDS, signal);
			if (result.exitCode && result.exitCode !== 0) {
				throw new Error(result.output);
			}

			return {
				content: [{ type: "text", text: result.output }],
				details: { exitCode: result.exitCode, args },
			};
		},
	};
}

function createWebFetchTool(): ToolDefinition<typeof WebFetchInputSchema> {
	return {
		name: "web_fetch",
		label: "web fetch",
		description:
			"High-level URL fetch through link-world. Prefer this when the user already has a target page or endpoint and needs its content.",
		parameters: WebFetchInputSchema,
		guidance:
			"Use this when the user provides a URL or when a prior search result should be fetched directly. If the task requires page interaction, use the browser tool family instead.",
		execute: async (_toolCallId, input: WebFetchInput, signal) => {
			if (!isAgentReachInstalled()) {
				throw new Error(`${getStatusText()}\n\n${installHelpText()}`);
			}

			const args = ["fetch", input.url];
			if (input.provider) {
				args.push("--provider", input.provider);
			}

			const result = await execAgentReach(args, input.timeout ?? DEFAULT_TIMEOUT_SECONDS, signal);
			if (result.exitCode && result.exitCode !== 0) {
				throw new Error(result.output);
			}

			return {
				content: [{ type: "text", text: result.output }],
				details: { exitCode: result.exitCode, args },
			};
		},
	};
}

export default function linkWorldExtension(api: ExtensionAPI) {
	api.registerMessageRenderer(LINK_WORLD_CUSTOM_TYPE, (message, _options, theme) => {
		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		const label = theme.fg("customMessageLabel", "\x1b[1m[link-world]\x1b[22m ");
		const text = theme.fg("customMessageText", String(message.content ?? ""));
		box.addChild(new Text(label + text, 0, 0));
		box.addChild(new Spacer(1));
		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	});

	api.registerTool(createLinkWorldAdminTool());
	api.registerTool(createLinkWorldExecTool());
	api.registerTool(createWebSearchTool());
	api.registerTool(createWebFetchTool());

	api.on("session_start", (_event, ctx) => {
		ensureLinkWorldWorkspace(ctx.cwd);
	});

	api.registerCommand("link-world", {
		description: "Inspect, install, or troubleshoot the built-in internet access integration",
		getArgumentCompletions: (argumentPrefix) => {
			const prefix = argumentPrefix.trim();
			const values = ["status", "doctor", "version", "install", "workspace", "help"]
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ value, label: value }));
			return values.length > 0 ? values : null;
		},
		handler: async (args: string, _ctx: ExtensionCommandContext) => {
			const action = (args.trim().split(/\s+/)[0] || "help").toLowerCase();

			if (action === "help") {
				api.sendMessage({
					customType: LINK_WORLD_CUSTOM_TYPE,
					content: [
						"Link-world is NanoPencil's built-in internet access integration point.",
						"",
						"Commands:",
						"/link-world status  - show whether agent-reach is installed and whether skills are bundled",
						"/link-world doctor  - run `agent-reach doctor`",
						"/link-world version - print the installed agent-reach version",
						"/link-world install - show the bundled installation guide",
						"/link-world workspace - show the project-local link-world workspace",
						"",
						"Tools: `link_world_admin`, `link_world_exec`, `web_search`, `web_fetch`",
					].join("\n"),
					display: true,
				});
				return;
			}

			if (action === "workspace") {
				api.sendMessage({
					customType: LINK_WORLD_CUSTOM_TYPE,
					content: `Link-world workspace: ${resolve(ensureLinkWorldWorkspace(api.cwd))}`,
					display: true,
				});
				return;
			}

			if (action === "install") {
				api.sendMessage({
					customType: LINK_WORLD_CUSTOM_TYPE,
					content: installHelpText(),
					display: true,
				});
				return;
			}

			if (action === "status") {
				api.sendMessage({
					customType: LINK_WORLD_CUSTOM_TYPE,
					content: getStatusText(),
					display: true,
				});
				return;
			}

			if (action === "doctor" || action === "version") {
				if (!isAgentReachInstalled()) {
					api.sendMessage({
						customType: LINK_WORLD_CUSTOM_TYPE,
						content: `${getStatusText()}\n\n${installHelpText()}`,
						display: true,
					});
					return;
				}

				const result = await execAgentReach(action === "doctor" ? ["doctor"] : ["--version"], DEFAULT_TIMEOUT_SECONDS);
				api.sendMessage({
					customType: LINK_WORLD_CUSTOM_TYPE,
					content: result.output,
					display: true,
				});
				return;
			}

			api.sendMessage({
				customType: LINK_WORLD_CUSTOM_TYPE,
				content: "Usage: /link-world [help|status|doctor|version|install|workspace]",
				display: true,
			});
		},
	});

	api.on("resources_discover", async (_event: ResourcesDiscoverEvent): Promise<ResourcesDiscoverResult> => {
		const workspace = ensureLinkWorldWorkspace(api.cwd);
		const skillPaths = [
			...new Set([
				NETWORK_ROUTING_SKILL_PATH,
				AGENT_SKILL_PATH,
				SKILL_PATH,
				DOC_PATH,
				...collectMarkdownFiles(join(workspace, "domain-skills")),
			].filter((path) => existsSync(path))),
		];
		return skillPaths.length ? { skillPaths } : {};
	});
}
