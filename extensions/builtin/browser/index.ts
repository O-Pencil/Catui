/**
 * [WHO]: browserExtension - registers browser automation tools, /browser command, and browser skill resources
 * [FROM]: Depends on node:child_process, node:fs, node:path, node:url, @sinclair/typebox, core/extensions-host/types
 * [TO]: Loaded explicitly via extension config/CLI path; registered in builtin-extensions metadata as opt-in
 * [HERE]: extensions/builtin/browser/index.ts - Browser Harness integration entry point kept under builtin source pending Q2 physical/package decision
 */

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
	ToolDefinition,
} from "../../../core/extensions-host/types.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "../../../core/tools/truncate.js";
import { getBrowserWorkspaceDir } from "../../../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BROWSER_SKILL_PATH = join(__dirname, "browser.md");
const INSTALL_SKILL_PATH = join(__dirname, "install.md");
const HARNESS_SRC_PATH = join(__dirname, "src");
const INTERACTION_SKILLS_PATH = join(__dirname, "interaction-skills");
const WORKSPACE_TEMPLATE_PATH = join(__dirname, "agent-workspace");
const DEFAULT_TIMEOUT_SECONDS = 120;
const BROWSER_COMMAND_COMPLETIONS = [
	{ value: "install", label: "install", description: "Install Browser Harness Python dependencies" },
	{ value: "status", label: "status", description: "Run doctor diagnostics" },
	{ value: "setup", label: "setup", description: "Attach to the running browser" },
	{ value: "reload", label: "reload", description: "Restart the Browser Harness daemon" },
	{ value: "workspace", label: "workspace", description: "Show the helper workspace path" },
	{ value: "help", label: "help", description: "Show Browser Harness commands" },
];

const BrowserRunInputSchema = Type.Object(
	{
		code: Type.String({
			description:
				"Python code to execute with Browser Harness helpers pre-imported. Use new_tab(url), wait_for_load(), page_info(), capture_screenshot(), click_at_xy(), js(), cdp(), etc.",
		}),
		timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Defaults to 120." })),
		name: Type.Optional(Type.String({ description: "Optional BU_NAME for an isolated local or remote browser daemon." })),
	},
	{ additionalProperties: false },
);

const BrowserAdminInputSchema = Type.Object(
	{
		action: Type.Union([
			Type.Literal("install"),
			Type.Literal("doctor"),
			Type.Literal("setup"),
			Type.Literal("reload"),
			Type.Literal("version"),
		]),
		timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Defaults to 120." })),
		name: Type.Optional(Type.String({ description: "Optional BU_NAME for the daemon to inspect or reload." })),
	},
	{ additionalProperties: false },
);

type BrowserRunInput = Static<typeof BrowserRunInputSchema>;
type BrowserAdminInput = Static<typeof BrowserAdminInputSchema>;

interface ProcessResult {
	exitCode: number | null;
	output: string;
	truncated?: boolean;
}

function isMissingPythonRuntime(result: ProcessResult): boolean {
	if (!result.exitCode) return false;
	const output = result.output.toLowerCase();
	return (
		output.trim().length === 0 ||
		output.includes("no suitable python runtime") ||
		output.includes("python was not found") ||
		output.includes("microsoft store")
	);
}

function browserWorkspacePath(): string {
	return getBrowserWorkspaceDir();
}

function ensureBrowserWorkspace(): string {
	const target = browserWorkspacePath();
	if (!existsSync(target)) {
		mkdirSync(target, { recursive: true });
		cpSync(WORKSPACE_TEMPLATE_PATH, target, { recursive: true });
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

function buildHarnessEnv(ctx: ExtensionContext, name?: string): NodeJS.ProcessEnv {
	const workspace = ensureBrowserWorkspace();
	const pythonPath = process.env.PYTHONPATH ? `${HARNESS_SRC_PATH}${process.platform === "win32" ? ";" : ":"}${process.env.PYTHONPATH}` : HARNESS_SRC_PATH;
	return {
		...process.env,
		PYTHONIOENCODING: "utf-8",
		PYTHONPATH: pythonPath,
		BH_AGENT_WORKSPACE: workspace,
		...(name ? { BU_NAME: name } : {}),
	};
}

function pythonCandidates(): Array<{ command: string; argsPrefix: string[] }> {
	if (process.platform === "win32") {
		return [
			{ command: "py", argsPrefix: ["-3.11"] },
			{ command: "py", argsPrefix: ["-3"] },
			{ command: "python", argsPrefix: [] },
			{ command: "python3", argsPrefix: [] },
		];
	}
	return [
		{ command: "python3.11", argsPrefix: [] },
		{ command: "python3", argsPrefix: [] },
		{ command: "python", argsPrefix: [] },
	];
}

function runProcess(
	command: string,
	args: string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
		timeoutSeconds: number;
		signal?: AbortSignal;
		onUpdate?: (text: string) => void;
	},
): Promise<ProcessResult> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		let output = "";
		let settled = false;
		const timeout = setTimeout(() => {
			if (!settled) {
				child.kill();
				settled = true;
				reject(new Error(`browser process timed out after ${options.timeoutSeconds} seconds`));
			}
		}, options.timeoutSeconds * 1000);

		const onAbort = () => {
			if (!settled) {
				child.kill();
				settled = true;
				reject(new Error("browser process aborted"));
			}
		};

		if (options.signal) {
			if (options.signal.aborted) {
				onAbort();
			} else {
				options.signal.addEventListener("abort", onAbort, { once: true });
			}
		}

		const collect = (chunk: Buffer) => {
			output += chunk.toString("utf-8");
			options.onUpdate?.(truncateTail(output).content || "");
		};

		child.stdout?.on("data", collect);
		child.stderr?.on("data", collect);

		child.on("error", (error) => {
			clearTimeout(timeout);
			if (options.signal) options.signal.removeEventListener("abort", onAbort);
			if (!settled) {
				settled = true;
				reject(error);
			}
		});

		child.on("close", (exitCode) => {
			clearTimeout(timeout);
			if (options.signal) options.signal.removeEventListener("abort", onAbort);
			if (settled) return;
			settled = true;
			const truncation = truncateTail(output);
			resolvePromise({
				exitCode,
				output: truncation.content || "(no output)",
				truncated: truncation.truncated,
			});
		});
	});
}

async function runPythonModule(
	moduleArgs: string[],
	ctx: ExtensionContext,
	options: {
		timeoutSeconds: number;
		name?: string;
		signal?: AbortSignal;
		onUpdate?: (text: string) => void;
	},
): Promise<ProcessResult> {
	const env = buildHarnessEnv(ctx, options.name);
	const errors: string[] = [];
	for (const candidate of pythonCandidates()) {
		try {
			const result = await runProcess(candidate.command, [...candidate.argsPrefix, "-m", "browser_harness.run", ...moduleArgs], {
				cwd: ctx.cwd,
				env,
				timeoutSeconds: options.timeoutSeconds,
				signal: options.signal,
				onUpdate: options.onUpdate,
			});
			if (isMissingPythonRuntime(result)) {
				errors.push(`${candidate.command}: ${result.output || "no usable runtime"}`);
				continue;
			}
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!message.includes("ENOENT")) {
				throw error;
			}
			errors.push(`${candidate.command}: ${message}`);
		}
	}
	throw new Error(`Python 3.11+ was not found. Tried: ${errors.join("; ")}`);
}

async function installPythonDependencies(
	ctx: ExtensionContext,
	options: { timeoutSeconds: number; signal?: AbortSignal; onUpdate?: (text: string) => void },
): Promise<ProcessResult> {
	const errors: string[] = [];
	const packages = [
		"cdp-use==1.4.5",
		"fetch-use==0.4.0",
		"pillow==12.2.0",
		"websockets==15.0.1",
	];
	for (const candidate of pythonCandidates()) {
		try {
			const result = await runProcess(
				candidate.command,
				[
					...candidate.argsPrefix,
					"-m",
					"pip",
					"install",
					"--disable-pip-version-check",
					...packages,
				],
				{
					cwd: ctx.cwd,
					env: {
						...process.env,
						PYTHONIOENCODING: "utf-8",
					},
					timeoutSeconds: options.timeoutSeconds,
					signal: options.signal,
					onUpdate: options.onUpdate,
				},
			);
			if (isMissingPythonRuntime(result)) {
				errors.push(`${candidate.command}: ${result.output || "no usable runtime"}`);
				continue;
			}
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!message.includes("ENOENT")) {
				throw error;
			}
			errors.push(`${candidate.command}: ${message}`);
		}
	}
	throw new Error(`Python 3.11+ was not found. Tried: ${errors.join("; ")}`);
}

function formatToolResult(result: ProcessResult): string {
	let text = result.output;
	if (result.truncated) {
		text += `\n\n[Output truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.]`;
	}
	if (result.exitCode && result.exitCode !== 0) {
		text += `\n\nCommand exited with code ${result.exitCode}`;
	}
	return text;
}

function missingDependencyHint(output: string): string | undefined {
	if (!/ModuleNotFoundError|No module named/.test(output)) return undefined;
	return [
		"Browser Harness Python dependencies are missing.",
		"Install them once with:",
		"python -m pip install cdp-use==1.4.5 fetch-use==0.4.0 pillow==12.2.0 websockets==15.0.1",
	].join("\n");
}

function createBrowserRunTool(): ToolDefinition<typeof BrowserRunInputSchema> {
	return {
		name: "browser",
		label: "browser",
		description:
			"Control the user's real Chrome/Edge browser through the vendored Browser Harness CDP bridge. Use for browser automation, scraping, screenshots, web app testing, downloads, uploads, tabs, cookies, dialogs, iframes, and remote Browser Use cloud browsers.",
		parameters: BrowserRunInputSchema,
		guidance:
			"Use new_tab(url) for first navigation so you do not clobber the user's active tab. After each meaningful visible action, use capture_screenshot() or page_info() to verify. Search .nanopencil/browser-workspace/domain-skills before inventing site-specific logic.",
		execute: async (_toolCallId, input: BrowserRunInput, signal, onUpdate, ctx) => {
			const result = await runPythonModule(["-c", input.code], ctx, {
				timeoutSeconds: input.timeout ?? DEFAULT_TIMEOUT_SECONDS,
				name: input.name,
				signal,
				onUpdate: (text) => onUpdate?.({ content: [{ type: "text", text }], details: null }),
			});
			const text = formatToolResult(result);
			const hint = missingDependencyHint(text);
			if (result.exitCode && result.exitCode !== 0) {
				throw new Error(hint ? `${text}\n\n${hint}` : text);
			}
			return {
				content: [{ type: "text", text: hint ? `${text}\n\n${hint}` : text }],
				details: { exitCode: result.exitCode, truncated: result.truncated },
			};
		},
	};
}

function createBrowserAdminTool(): ToolDefinition<typeof BrowserAdminInputSchema> {
	return {
		name: "browser_admin",
		label: "browser admin",
		description:
			"Run Browser Harness dependency install, setup, doctor, reload, or version checks against the vendored browser harness.",
		parameters: BrowserAdminInputSchema,
		execute: async (_toolCallId, input: BrowserAdminInput, signal, onUpdate, ctx) => {
			let result: ProcessResult;
			if (input.action === "install") {
				result = await installPythonDependencies(ctx, {
					timeoutSeconds: input.timeout ?? DEFAULT_TIMEOUT_SECONDS,
					signal,
					onUpdate: (text) => onUpdate?.({ content: [{ type: "text", text }], details: null }),
				});
			} else {
				const args =
					input.action === "doctor"
						? ["--doctor"]
						: input.action === "setup"
							? ["--setup"]
							: input.action === "reload"
								? ["--reload"]
								: ["--version"];
				result = await runPythonModule(args, ctx, {
					timeoutSeconds: input.timeout ?? DEFAULT_TIMEOUT_SECONDS,
					name: input.name,
					signal,
					onUpdate: (text) => onUpdate?.({ content: [{ type: "text", text }], details: null }),
				});
			}
			const text = formatToolResult(result);
			const hint = missingDependencyHint(text);
			if (result.exitCode && result.exitCode !== 0) {
				throw new Error(hint ? `${text}\n\n${hint}` : text);
			}
			return {
				content: [{ type: "text", text: hint ? `${text}\n\n${hint}` : text }],
				details: { exitCode: result.exitCode, truncated: result.truncated },
			};
		},
	};
}

export default function browserExtension(api: ExtensionAPI) {
	api.registerTool(createBrowserRunTool());
	api.registerTool(createBrowserAdminTool());

	api.on("session_start", (_event, ctx) => {
		ensureBrowserWorkspace();
	});

	api.registerCommand("browser", {
		description: "Set up or inspect browser automation tools",
		getArgumentCompletions: (argumentPrefix, context) => {
			if (context && context.tokenIndex > 0) return null;
			const prefix = argumentPrefix.trim().toLowerCase();
			const values = BROWSER_COMMAND_COMPLETIONS.filter((item) => item.value.startsWith(prefix));
			return values.length > 0 ? values : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const action = (args.trim().split(/\s+/)[0] || "help").toLowerCase();
			if (action === "workspace") {
				api.sendMessage({
					customType: "text",
					content: `Browser workspace: ${resolve(ensureBrowserWorkspace())}`,
					display: true,
				});
				return;
			}
			if (action === "install" || action === "setup" || action === "status" || action === "reload") {
				let result: ProcessResult;
				if (action === "install") {
					result = await installPythonDependencies(ctx, { timeoutSeconds: DEFAULT_TIMEOUT_SECONDS });
				} else {
					result = await runPythonModule([action === "status" ? "--doctor" : `--${action}`], ctx, {
						timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
					});
				}
				api.sendMessage({
					customType: "text",
					content: formatToolResult(result),
					display: true,
				});
				return;
			}
			api.sendMessage({
				customType: "text",
				content: [
					"Browser Harness is built into NanoPencil.",
					"",
					"Commands:",
					"/browser install - install the Python dependencies used by the vendored harness",
					"/browser status - run doctor diagnostics",
					"/browser setup - attach to the running browser",
					"/browser reload - stop the daemon so the next browser call restarts it",
					"/browser workspace - show the editable helper/domain-skill workspace",
					"",
					"Agent tools: browser, browser_admin",
				].join("\n"),
				display: true,
			});
		},
	});

	api.on("resources_discover", async (_event: ResourcesDiscoverEvent): Promise<ResourcesDiscoverResult> => {
		const workspace = ensureBrowserWorkspace();
		const skillPaths = [
			...new Set([
				...collectMarkdownFiles(INTERACTION_SKILLS_PATH),
				...collectMarkdownFiles(join(workspace, "domain-skills")),
				BROWSER_SKILL_PATH,
				INSTALL_SKILL_PATH,
			].filter((path) => existsSync(path))),
		];
		return skillPaths.length ? { skillPaths } : {};
	});
}
