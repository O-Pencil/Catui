/**
 * [WHO]: Main CLI handler, orchestrates SDK initialization and mode dispatch
 * [FROM]: Depends on cli/*, core/*, modes/*, packages/*, config.ts
 * [TO]: Consumed by cli.ts
 * [HERE]: CLI layer; parses args → CreateAgentSessionOptions → mode selection
 */

import { type ImageContent, modelsAreEqual, supportsXhigh } from "@pencil-agent/ai";
import chalk from "chalk";
import { join, resolve } from "path";
import { createInterface } from "readline";
import { type Args, parseArgs, printHelp } from "./cli/args.js";
import { selectConfig } from "./cli/config-selector.js";
import { processFileArguments } from "./cli/file-processor.js";
import { listModels } from "./cli/list-models.js";
import { selectSession } from "./cli/session-picker.js";
import { APP_NAME, getAgentDir, getModelsPath, VERSION } from "./config.js";
import { AuthStorage } from "./core/config/auth-storage.js";
import { DEFAULT_THINKING_LEVEL } from "./core/defaults.js";
import type { LoadExtensionsResult } from "./core/extensions/index.js";
import { KeybindingsManager } from "./core/keybindings.js";
import { ModelRegistry } from "./core/model-registry.js";
import { resolveCliModel, resolveModelScope, type ScopedModel } from "./core/model-resolver.js";
import { DefaultPackageManager } from "./core/package-manager.js";
import { DefaultResourceLoader } from "./core/config/resource-loader.js";
import { type CreateAgentSessionOptions, createAgentSession } from "./core/runtime/sdk.js";
import { SessionManager } from "./core/session/session-manager.js";
import { SettingsManager } from "./core/config/settings-manager.js";
import { time } from "./core/timings.js";
import { allTools } from "./core/tools/index.js";
import { runMigrations, showDeprecationWarnings } from "./migrations.js";
import { InteractiveMode, runPrintMode, runRpcMode } from "./modes/index.js";
import { initTheme, stopThemeWatcher } from "./modes/interactive/theme/theme.js";
import { exportFromFile } from "./core/export-html/index.js";
import { profileCheckpoint } from "./utils/startup-profiler.js";
import { isDevRuntime, reportDiagnostic } from "./utils/diagnostics.js";
import {
	CUSTOM_ANTHROPIC_PROVIDER,
	CUSTOM_OPENAI_PROVIDER,
} from "./core/custom-providers.js";
import {
	ensureNanopencilCodingPlanAuth,
	ensureNanopencilDefaultConfig,
	NANOPENCIL_ARK_CODING_PROVIDER,
	NANOPENCIL_DEFAULT_PROVIDER,
	NANOPENCIL_MINIMAX_CODING_PROVIDER,
	NANOPENCIL_QIANFAN_CODING_PROVIDER,
	NANOPENCIL_ZHIPU_CODING_PROVIDER,
	NANOPENCIL_ANTHROPIC_CUSTOM_PROVIDER,
	NANOPENCIL_OLLAMA_PROVIDER,
} from "./nanopencil-defaults.js";
import { getBuiltinExtensionPaths } from "./builtin-extensions.js";

// Check if running in development mode (not production)
const isDevelopment = process.env.NODE_ENV !== "production";

// Belt-and-suspenders warning silencing for user mode. Two channels cover
// every path Node uses to surface a warning:
//   (1) wrap process.emitWarning so we can short-circuit BEFORE the 'warning'
//       event ever fires. Catches the common path where Node internals call
//       process.emitWarning(...).
//   (2) replace Node's default 'warning' listener (the one that prints to
//       stderr) with our own. Catches paths that emit the event directly
//       without going through emitWarning, and makes sure no other library's
//       ad-hoc warning listener can re-print what we suppressed.
{
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const originalEmitWarning = process.emitWarning.bind(process) as any;

	type WarningOpts = { type?: string; name?: string; code?: string; detail?: string };
	const isMaxListenersWarning = (warning: Error & { code?: string }, message?: unknown, opts?: WarningOpts): boolean => {
		const name = warning?.name ?? opts?.name ?? "";
		if (name === "MaxListenersExceededWarning") return true;
		const text = String(warning?.message ?? message ?? "");
		return (
			text.startsWith("Possible EventTarget memory leak detected") ||
			text.startsWith("Possible EventEmitter memory leak detected")
		);
	};
	const isDep0190 = (opts?: WarningOpts): boolean =>
		(opts?.type ?? "") === "DeprecationWarning" && (opts?.code ?? "") === "DEP0190";

	// (1) emitWarning override
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(process as any).emitWarning = (message: any, options?: any) => {
		const opts: WarningOpts = typeof options === "object" && options !== null
			? options
			: { type: typeof options === "string" ? options : undefined };
		const warning = message instanceof Error ? message : null;

		if (!isDevelopment && isDep0190(opts)) return;

		if (isMaxListenersWarning(warning ?? (new Error() as any), message, opts)) {
			if (!isDevRuntime()) {
				const text = warning?.message ?? String(message ?? "");
				reportDiagnostic({
					source: "node.warning",
					severity: "warning",
					category: "fallback",
					message: text.slice(0, 240),
					detail: { code: opts.code, type: opts.type, name: opts.name },
					fingerprint: "node.warning:max-listeners-exceeded",
				});
				return;
			}
		}

		// eslint-disable-next-line @typescript-eslint/no-unsafe-call
		return originalEmitWarning(message, options);
	};

	// (2) replace 'warning' event listeners. Node attaches a default printer
	// on startup; if anything bypassed (1), this stops the printer from
	// running. We only do this in user mode — dev keeps default behaviour.
	if (!isDevRuntime()) {
		for (const listener of process.listeners("warning")) {
			process.off("warning", listener as (warning: Error) => void);
		}
		process.on("warning", (warning: Error & { code?: string }) => {
			if (isMaxListenersWarning(warning)) {
				reportDiagnostic({
					source: "node.warning",
					severity: "warning",
					category: "fallback",
					message: warning.message.slice(0, 240),
					detail: { code: warning.code, name: warning.name },
					fingerprint: "node.warning:max-listeners-exceeded",
				});
				return;
			}
			if (isDep0190({ type: "DeprecationWarning", code: warning.code })) return;
			// Print everything else exactly like Node's default would.
			process.stderr.write(`(node:${process.pid}) ${warning.stack ?? warning.message}\n`);
		});
	}
}

/**
 * Read all content from piped stdin.
 * Returns undefined if stdin is a TTY (interactive terminal).
 */
async function readPipedStdin(): Promise<string | undefined> {
	// If stdin is a TTY, we're running interactively - don't read stdin
	if (process.stdin.isTTY) {
		return undefined;
	}

	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => {
			resolve(data.trim() || undefined);
		});
		process.stdin.resume();
	});
}

function reportSettingsErrors(settingsManager: SettingsManager, context: string): void {
	const errors = settingsManager.drainErrors();
	for (const { scope, error } of errors) {
		console.error(chalk.yellow(`Warning (${context}, ${scope} settings): ${error.message}`));
		if (error.stack) {
			console.error(chalk.dim(error.stack));
		}
	}
}

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function resolveWorkingDirectory(parsedCwd?: string): string {
	const envCwd = process.env[`${APP_NAME.toUpperCase()}_CWD`];
	const requestedCwd = parsedCwd || envCwd;
	return requestedCwd ? resolve(requestedCwd) : process.cwd();
}

type PackageCommand = "install" | "remove" | "update" | "list";

interface PackageCommandOptions {
	command: PackageCommand;
	source?: string;
	local: boolean;
	help: boolean;
	invalidOption?: string;
}

function getPackageCommandUsage(command: PackageCommand): string {
	switch (command) {
		case "install":
			return `${APP_NAME} install <source> [-l]`;
		case "remove":
			return `${APP_NAME} remove <source> [-l]`;
		case "update":
			return `${APP_NAME} update [source]`;
		case "list":
			return `${APP_NAME} list`;
	}
}

function printPackageCommandHelp(command: PackageCommand): void {
	switch (command) {
		case "install":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("install")}

Install a package and add it to settings.

Options:
  -l, --local    Install project-locally (.nanopencil/settings.json)

Examples:
  ${APP_NAME} install npm:@foo/bar
  ${APP_NAME} install git:github.com/user/repo
  ${APP_NAME} install git:git@github.com:user/repo
  ${APP_NAME} install https://github.com/user/repo
  ${APP_NAME} install ssh://git@github.com/user/repo
  ${APP_NAME} install ./local/path
`);
			return;

		case "remove":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("remove")}

Remove a package and its source from settings.

Options:
  -l, --local    Remove from project settings (.nanopencil/settings.json)

Example:
  ${APP_NAME} remove npm:@foo/bar
`);
			return;

		case "update":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("update")}

Update installed packages.
If <source> is provided, only that package is updated.
`);
			return;

		case "list":
			console.log(`${chalk.bold("Usage:")}
  ${getPackageCommandUsage("list")}

List installed packages from user and project settings.
`);
			return;
	}
}

function parsePackageCommand(args: string[]): PackageCommandOptions | undefined {
	const [command, ...rest] = args;
	if (command !== "install" && command !== "remove" && command !== "update" && command !== "list") {
		return undefined;
	}

	let local = false;
	let help = false;
	let invalidOption: string | undefined;
	let source: string | undefined;

	for (const arg of rest) {
		if (arg === "-h" || arg === "--help") {
			help = true;
			continue;
		}

		if (arg === "-l" || arg === "--local") {
			if (command === "install" || command === "remove") {
				local = true;
			} else {
				invalidOption = invalidOption ?? arg;
			}
			continue;
		}

		if (arg.startsWith("-")) {
			invalidOption = invalidOption ?? arg;
			continue;
		}

		if (!source) {
			source = arg;
		}
	}

	return { command, source, local, help, invalidOption };
}

async function handlePackageCommand(args: string[]): Promise<boolean> {
	const options = parsePackageCommand(args);
	if (!options) {
		return false;
	}

	if (options.help) {
		printPackageCommandHelp(options.command);
		return true;
	}

	if (options.invalidOption) {
		console.error(chalk.red(`Unknown option ${options.invalidOption} for "${options.command}".`));
		console.error(chalk.dim(`Use "${APP_NAME} --help" or "${getPackageCommandUsage(options.command)}".`));
		process.exitCode = 1;
		return true;
	}

	const source = options.source;
	if ((options.command === "install" || options.command === "remove") && !source) {
		console.error(chalk.red(`Missing ${options.command} source.`));
		console.error(chalk.dim(`Usage: ${getPackageCommandUsage(options.command)}`));
		process.exitCode = 1;
		return true;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	reportSettingsErrors(settingsManager, "package command");
	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });

	packageManager.setProgressCallback((event) => {
		if (event.type === "start") {
			process.stdout.write(chalk.dim(`${event.message}\n`));
		}
	});

	try {
		switch (options.command) {
			case "install":
				await packageManager.install(source!, { local: options.local });
				packageManager.addSourceToSettings(source!, { local: options.local });
				console.log(chalk.green(`Installed ${source}`));
				return true;

			case "remove": {
				await packageManager.remove(source!, { local: options.local });
				const removed = packageManager.removeSourceFromSettings(source!, { local: options.local });
				if (!removed) {
					console.error(chalk.red(`No matching package found for ${source}`));
					process.exitCode = 1;
					return true;
				}
				console.log(chalk.green(`Removed ${source}`));
				return true;
			}

			case "list": {
				const globalSettings = settingsManager.getGlobalSettings();
				const projectSettings = settingsManager.getProjectSettings();
				const globalPackages = globalSettings.packages ?? [];
				const projectPackages = projectSettings.packages ?? [];

				if (globalPackages.length === 0 && projectPackages.length === 0) {
					console.log(chalk.dim("No packages installed."));
					return true;
				}

				const formatPackage = (pkg: (typeof globalPackages)[number], scope: "user" | "project") => {
					const source = typeof pkg === "string" ? pkg : pkg.source;
					const filtered = typeof pkg === "object";
					const display = filtered ? `${source} (filtered)` : source;
					console.log(`  ${display}`);
					const path = packageManager.getInstalledPath(source, scope);
					if (path) {
						console.log(chalk.dim(`    ${path}`));
					}
				};

				if (globalPackages.length > 0) {
					console.log(chalk.bold("User packages:"));
					for (const pkg of globalPackages) {
						formatPackage(pkg, "user");
					}
				}

				if (projectPackages.length > 0) {
					if (globalPackages.length > 0) console.log();
					console.log(chalk.bold("Project packages:"));
					for (const pkg of projectPackages) {
						formatPackage(pkg, "project");
					}
				}

				return true;
			}

			case "update":
				await packageManager.update(source);
				if (source) {
					console.log(chalk.green(`Updated ${source}`));
				} else {
					console.log(chalk.green("Updated packages"));
				}
				return true;
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown package command error";
		console.error(chalk.red(`Error: ${message}`));
		process.exitCode = 1;
		return true;
	}
}

async function prepareInitialMessage(
	parsed: Args,
	autoResizeImages: boolean,
): Promise<{
	initialMessage?: string;
	initialImages?: ImageContent[];
}> {
	if (parsed.fileArgs.length === 0) {
		return {};
	}

	const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages });

	let initialMessage: string;
	if (parsed.messages.length > 0) {
		initialMessage = text + parsed.messages[0];
		parsed.messages.shift();
	} else {
		initialMessage = text;
	}

	return {
		initialMessage,
		initialImages: images.length > 0 ? images : undefined,
	};
}

/** Result from resolving a session argument */
type ResolvedSession =
	| { type: "path"; path: string } // Direct file path
	| { type: "local"; path: string } // Found in current project
	| { type: "global"; path: string; cwd: string } // Found in different project
	| { type: "not_found"; arg: string }; // Not found anywhere

/**
 * Resolve a session argument to a file path.
 * If it looks like a path, use as-is. Otherwise try to match as session ID prefix.
 */
async function resolveSessionPath(sessionArg: string, cwd: string, sessionDir?: string): Promise<ResolvedSession> {
	// If it looks like a file path, use as-is
	if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
		return { type: "path", path: sessionArg };
	}

	// Try to match as session ID in current project first
	const localSessions = await SessionManager.list(cwd, sessionDir);
	const localMatches = localSessions.filter((s) => s.id.startsWith(sessionArg));

	if (localMatches.length >= 1) {
		return { type: "local", path: localMatches[0].path };
	}

	// Try global search across all projects
	const allSessions = await SessionManager.listAll();
	const globalMatches = allSessions.filter((s) => s.id.startsWith(sessionArg));

	if (globalMatches.length >= 1) {
		const match = globalMatches[0];
		return { type: "global", path: match.path, cwd: match.cwd };
	}

	// Not found anywhere
	return { type: "not_found", arg: sessionArg };
}

/** Prompt user for yes/no confirmation */
async function promptConfirm(message: string): Promise<boolean> {
	return new Promise((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(`${message} [y/N] `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
		});
	});
}

async function createSessionManager(parsed: Args, cwd: string): Promise<SessionManager | undefined> {
	if (parsed.noSession) {
		return SessionManager.inMemory();
	}
	if (parsed.session) {
		const resolved = await resolveSessionPath(parsed.session, cwd, parsed.sessionDir);

		switch (resolved.type) {
			case "path":
			case "local":
				return SessionManager.open(resolved.path, parsed.sessionDir);

			case "global": {
				// Session found in different project - ask user if they want to fork
				console.log(chalk.yellow(`Session found in different project: ${resolved.cwd}`));
				const shouldFork = await promptConfirm("Fork this session into current directory?");
				if (!shouldFork) {
					console.log(chalk.dim("Aborted."));
					process.exit(0);
				}
				return SessionManager.forkFrom(resolved.path, cwd, parsed.sessionDir);
			}

			case "not_found":
				console.error(chalk.red(`No session found matching '${resolved.arg}'`));
				process.exit(1);
		}
	}
	if (parsed.continue) {
		return SessionManager.continueRecent(cwd, parsed.sessionDir);
	}
	// --resume is handled separately (needs picker UI)
	// If --session-dir provided without --continue/--resume, create new session there
	if (parsed.sessionDir) {
		return SessionManager.create(cwd, parsed.sessionDir);
	}
	// Default case (new session) returns undefined, SDK will create one
	return undefined;
}

function buildSessionOptions(
	parsed: Args,
	scopedModels: ScopedModel[],
	sessionManager: SessionManager | undefined,
	modelRegistry: ModelRegistry,
	settingsManager: SettingsManager,
): { options: CreateAgentSessionOptions; cliThinkingFromModel: boolean } {
	const options: CreateAgentSessionOptions = {};
	let cliThinkingFromModel = false;

	if (sessionManager) {
		options.sessionManager = sessionManager;
	}

	// Model from CLI
	// - supports --provider <name> --model <pattern>
	// - supports --model <provider>/<pattern>
	if (parsed.model) {
		const resolved = resolveCliModel({
			cliProvider: parsed.provider,
			cliModel: parsed.model,
			modelRegistry,
		});
		if (resolved.warning) {
			console.warn(chalk.yellow(`Warning: ${resolved.warning}`));
		}
		if (resolved.error) {
			console.error(chalk.red(resolved.error));
			process.exit(1);
		}
		if (resolved.model) {
			options.model = resolved.model;
			// Allow "--model <pattern>:<thinking>" as a shorthand.
			// Explicit --thinking still takes precedence (applied later).
			if (!parsed.thinking && resolved.thinkingLevel) {
				options.thinkingLevel = resolved.thinkingLevel;
				cliThinkingFromModel = true;
			}
		}
	}

	if (!options.model && scopedModels.length > 0 && !parsed.continue && !parsed.resume) {
		// Check if saved default is in scoped models - use it if so, otherwise first scoped model
		const savedProvider = settingsManager.getDefaultProvider();
		const savedModelId = settingsManager.getDefaultModel();
		const savedModel = savedProvider && savedModelId ? modelRegistry.find(savedProvider, savedModelId) : undefined;
		const savedInScope = savedModel ? scopedModels.find((sm) => modelsAreEqual(sm.model, savedModel)) : undefined;

		if (savedInScope) {
			options.model = savedInScope.model;
			// Use thinking level from scoped model config if explicitly set
			if (!parsed.thinking && savedInScope.thinkingLevel) {
				options.thinkingLevel = savedInScope.thinkingLevel;
			}
		} else {
			options.model = scopedModels[0].model;
			// Use thinking level from first scoped model if explicitly set
			if (!parsed.thinking && scopedModels[0].thinkingLevel) {
				options.thinkingLevel = scopedModels[0].thinkingLevel;
			}
		}
	}

	// Thinking level from CLI (takes precedence over scoped model thinking levels set above)
	if (parsed.thinking) {
		options.thinkingLevel = parsed.thinking;
	}

	// Scoped models for Ctrl+P cycling - fill in default thinking level for models without explicit level
	if (scopedModels.length > 0) {
		const defaultThinkingLevel = settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
		options.scopedModels = scopedModels.map((sm) => ({
			model: sm.model,
			thinkingLevel: sm.thinkingLevel ?? defaultThinkingLevel,
		}));
	}

	// Tools
	if (parsed.noTools) {
		// --no-tools: start with no built-in tools
		// --tools can still add specific ones back
		if (parsed.tools && parsed.tools.length > 0) {
			options.tools = parsed.tools.map((name) => allTools[name]);
		} else {
			options.tools = [];
		}
	} else if (parsed.tools) {
		options.tools = parsed.tools.map((name) => allTools[name]);
	}

	// Soul (AI personality evolution) - enabled by default, disable with --disable-soul
	options.enableSoul = parsed.disableSoul !== true;

	return { options, cliThinkingFromModel };
}

async function handleConfigCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "config") {
		return false;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	reportSettingsErrors(settingsManager, "config command");
	const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });

	const resolvedPaths = await packageManager.resolve();

	await selectConfig({
		resolvedPaths,
		settingsManager,
		cwd,
		agentDir,
	});

	process.exit(0);
}

export async function main(args: string[]) {
	profileCheckpoint("main_entry");
	const offlineMode = args.includes("--offline") || isTruthyEnvFlag(process.env.NANOPENCIL_OFFLINE);
	if (offlineMode) {
		process.env.NANOPENCIL_OFFLINE = "1";
		process.env.NANOPENCIL_SKIP_VERSION_CHECK = "1";
	}

	if (await handlePackageCommand(args)) {
		return;
	}

	if (await handleConfigCommand(args)) {
		return;
	}

	// Run migrations (pass cwd for project-local migrations)
	const firstPass = parseArgs(args);
	const cwd = resolveWorkingDirectory(firstPass.cwd);
	const { migratedAuthProviders: migratedProviders, deprecationWarnings } = runMigrations(cwd);
	profileCheckpoint("after_migrations");

	// Early load extensions to discover their CLI flags
	const agentDir = getAgentDir();
	profileCheckpoint("before_settings_manager");
	const settingsManager = SettingsManager.create(cwd, agentDir);
	profileCheckpoint("settings_manager_ready");
	profileCheckpoint("auth_storage_created", "settings_manager_ready");
	reportSettingsErrors(settingsManager, "startup");

	const authStorage = AuthStorage.create();
	if (APP_NAME === "nanopencil") {
		ensureNanopencilDefaultConfig();
		// Let nanomem use nanopencil's config directory to store memory
		if (!process.env.NANOMEM_MEMORY_DIR) {
			process.env.NANOMEM_MEMORY_DIR = join(getAgentDir(), "memory");
		}
	}
	profileCheckpoint("nanopencil_defaults_ensured", "auth_storage_created");

	const modelRegistry = new ModelRegistry(
		authStorage,
		getModelsPath(),
		APP_NAME === "nanopencil"
			? {
					useOnlyCustomModels: true,
					allowOptionalApiKeyForProvider: [
						NANOPENCIL_DEFAULT_PROVIDER,
						NANOPENCIL_QIANFAN_CODING_PROVIDER,
						NANOPENCIL_ARK_CODING_PROVIDER,
						NANOPENCIL_MINIMAX_CODING_PROVIDER,
						NANOPENCIL_ZHIPU_CODING_PROVIDER,
						NANOPENCIL_ANTHROPIC_CUSTOM_PROVIDER,
						NANOPENCIL_OLLAMA_PROVIDER,
						"openrouter",
						CUSTOM_ANTHROPIC_PROVIDER,
						CUSTOM_OPENAI_PROVIDER,
					],
				}
			: {},
	);
	profileCheckpoint("model_registry_created");

	const defaultExtPaths = APP_NAME === "nanopencil" ? getBuiltinExtensionPaths() : [];
	profileCheckpoint("before_resource_loader_create");
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		additionalExtensionPaths: [...defaultExtPaths, ...(firstPass.extensions ?? [])],
		additionalSkillPaths: firstPass.skills,
		additionalPromptTemplatePaths: firstPass.promptTemplates,
		additionalThemePaths: firstPass.themes,
		noExtensions: firstPass.noExtensions,
		noSkills: firstPass.noSkills,
		noPromptTemplates: firstPass.noPromptTemplates,
		noThemes: firstPass.noThemes,
		systemPrompt: firstPass.systemPrompt,
		appendSystemPrompt: firstPass.appendSystemPrompt,
	});
	await resourceLoader.reload();
	time("resourceLoader.reload");
	profileCheckpoint("resource_loader_reload", "settings_manager_ready");

	const extensionsResult: LoadExtensionsResult = resourceLoader.getExtensions();
	profileCheckpoint("extensions_loaded", "resource_loader_reload");
	for (const { path, error } of extensionsResult.errors) {
		console.error(chalk.red(`Failed to load extension "${path}": ${error}`));
	}
	if (APP_NAME === "nanopencil") {
		const nanomemLoaded = extensionsResult.extensions.some((e) => e.path.includes("nano-mem"));
		const nanomemFailed = extensionsResult.errors.some((e) => e.path.includes("nano-mem"));
		// Only show NanoMem status in development mode (not production)
		if (isDevelopment) {
			if (!nanomemLoaded && (defaultExtPaths.length === 0 || nanomemFailed)) {
				console.error(
					chalk.dim("NanoMem (persistent memory) not loaded. Reinstall: npm install -g @pencil-agent/nano-pencil"),
				);
			} else if (nanomemLoaded) {
				const nanomemExt = extensionsResult.extensions.find((e) => e.path.includes("nano-mem"));
				console.error(chalk.dim(`NanoMem extension loaded: ${nanomemExt?.path ?? "nano-mem"}`));
			}
		}
	}

	// Apply pending provider registrations from extensions immediately
	// so they're available for model resolution before AgentSession is created
	for (const { name, config } of extensionsResult.runtime.pendingProviderRegistrations) {
		modelRegistry.registerProvider(name, config);
	}
	extensionsResult.runtime.pendingProviderRegistrations = [];

	if (APP_NAME === "nanopencil") {
		await ensureNanopencilCodingPlanAuth(authStorage, modelRegistry);
	}

	const extensionFlags = new Map<string, { type: "boolean" | "string" }>();
	for (const ext of extensionsResult.extensions) {
		for (const [name, flag] of ext.flags) {
			extensionFlags.set(name, { type: flag.type });
		}
	}

	// Second pass: parse args with extension flags
	profileCheckpoint("before_args_parse_2");
	const parsed = parseArgs(args, extensionFlags);
	profileCheckpoint("args_parsed_2");
	const parsedCwd = resolveWorkingDirectory(parsed.cwd);
	profileCheckpoint("cwd_resolved", "args_parsed_2");

	// Pass flag values to extensions via runtime
	for (const [name, value] of parsed.unknownFlags) {
		extensionsResult.runtime.flagValues.set(name, value);
	}

	if (parsed.version) {
		console.log(VERSION);
		process.exit(0);
	}

	if (parsed.help) {
		printHelp();
		process.exit(0);
	}

	if (parsed.listModels !== undefined) {
		const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
		await listModels(modelRegistry, searchPattern);
		process.exit(0);
	}

	// Read piped stdin content (if any) - skip for RPC/ACP mode which uses stdin for JSON-RPC
	if (parsed.mode !== "rpc" && !parsed.acp) {
		const stdinContent = await readPipedStdin();
		if (stdinContent !== undefined) {
			// Force print mode since interactive mode requires a TTY for keyboard input
			parsed.print = true;
			// Prepend stdin content to messages
			parsed.messages.unshift(stdinContent);
		}
	}

	if (parsed.export) {
		let result: string;
		try {
			const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
			result = await exportFromFile(parsed.export, outputPath);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to export session";
			console.error(chalk.red(`Error: ${message}`));
			process.exit(1);
		}
		console.log(`Exported to: ${result}`);
		process.exit(0);
	}

	if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
		console.error(chalk.red("Error: @file arguments are not supported in RPC mode"));
		process.exit(1);
	}

	const { initialMessage, initialImages } = await prepareInitialMessage(parsed, settingsManager.getImageAutoResize());
	const isInteractive = !parsed.print && parsed.mode === undefined;
	const mode = parsed.mode || "text";
	// NanoPencil default theme is warm; write to settings when unset for persistence
	if (APP_NAME === "nanopencil" && settingsManager.getTheme() === undefined) {
		settingsManager.setTheme("warm");
	}
	initTheme(settingsManager.getTheme() ?? (APP_NAME === "nanopencil" ? "warm" : undefined), isInteractive);

	// Show deprecation warnings in interactive mode
	if (isInteractive && deprecationWarnings.length > 0) {
		await showDeprecationWarnings(deprecationWarnings);
	}

	let scopedModels: ScopedModel[] = [];
	const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
	if (modelPatterns && modelPatterns.length > 0) {
		scopedModels = await resolveModelScope(modelPatterns, modelRegistry);
	}

	// Create session manager based on CLI flags
	let sessionManager = await createSessionManager(parsed, parsedCwd);

	// Handle --resume: show session picker
	if (parsed.resume) {
		// Initialize keybindings so session picker respects user config
		KeybindingsManager.create();

		const selectedPath = await selectSession(
			(onProgress) => SessionManager.list(parsedCwd, parsed.sessionDir, onProgress),
			SessionManager.listAll,
		);
		if (!selectedPath) {
			console.log(chalk.dim("No session selected"));
			stopThemeWatcher();
			process.exit(0);
		}
		sessionManager = SessionManager.open(selectedPath);
	}

	const { options: sessionOptions, cliThinkingFromModel } = buildSessionOptions(
		parsed,
		scopedModels,
		sessionManager,
		modelRegistry,
		settingsManager,
	);
	// NanoPencil enables MCP by default; disabled in offline mode or with --no-mcp flag
	sessionOptions.enableMCP = APP_NAME === "nanopencil" && !offlineMode && !parsed.noMcp;
	sessionOptions.cwd = parsedCwd;
	sessionOptions.authStorage = authStorage;
	sessionOptions.modelRegistry = modelRegistry;
	sessionOptions.resourceLoader = resourceLoader;

	// Handle CLI --api-key as runtime override (not persisted)
	if (parsed.apiKey) {
		if (!sessionOptions.model) {
			console.error(
				chalk.red("--api-key requires a model to be specified via --model, --provider/--model, or --models"),
			);
			process.exit(1);
		}
		authStorage.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
	}

	profileCheckpoint("before_create_agent_session");
	const { session, modelFallbackMessage } = await createAgentSession(sessionOptions);
	profileCheckpoint("agent_session_created");

	if (!isInteractive && !session.model) {
		console.error(chalk.red("No models available."));
		console.error(chalk.yellow("\nSet an API key environment variable:"));
		console.error("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, etc.");
		console.error(chalk.yellow(`\nOr create ${getModelsPath()}`));
		process.exit(1);
	}

	// Clamp thinking level to model capabilities for CLI-provided thinking levels.
	// This covers both --thinking <level> and --model <pattern>:<thinking>.
	const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel;
	if (session.model && cliThinkingOverride) {
		let effectiveThinking = session.thinkingLevel;
		if (!session.model.reasoning) {
			effectiveThinking = "off";
		} else if (effectiveThinking === "xhigh" && !supportsXhigh(session.model)) {
			effectiveThinking = "high";
		}
		if (effectiveThinking !== session.thinkingLevel) {
			session.setThinkingLevel(effectiveThinking);
		}
	}

	if (parsed.acp) {
		const { runAcpMode } = await import("./modes/acp/acp-mode.js");
		const createAcpSessionForCwd = async (workspaceCwd: string) => {
			const resolvedWorkspaceCwd = resolveWorkingDirectory(workspaceCwd);
			const workspaceSettingsManager = SettingsManager.create(resolvedWorkspaceCwd, agentDir);
			reportSettingsErrors(workspaceSettingsManager, "acp startup");

			const workspaceResourceLoader = new DefaultResourceLoader({
				cwd: resolvedWorkspaceCwd,
				agentDir,
				settingsManager: workspaceSettingsManager,
				additionalExtensionPaths: [...defaultExtPaths, ...(parsed.extensions ?? [])],
				additionalSkillPaths: parsed.skills,
				additionalPromptTemplatePaths: parsed.promptTemplates,
				additionalThemePaths: parsed.themes,
				noExtensions: parsed.noExtensions,
				noSkills: parsed.noSkills,
				noPromptTemplates: parsed.noPromptTemplates,
				noThemes: parsed.noThemes,
				systemPrompt: parsed.systemPrompt,
				appendSystemPrompt: parsed.appendSystemPrompt,
			});
			await workspaceResourceLoader.reload();

			const workspaceExtensionsResult = workspaceResourceLoader.getExtensions();
			for (const { path, error } of workspaceExtensionsResult.errors) {
				console.error(chalk.red(`Failed to load extension "${path}": ${error}`));
			}
			for (const { name, config } of workspaceExtensionsResult.runtime.pendingProviderRegistrations) {
				modelRegistry.registerProvider(name, config);
			}
			workspaceExtensionsResult.runtime.pendingProviderRegistrations = [];

			let workspaceScopedModels: ScopedModel[] = [];
			if (modelPatterns && modelPatterns.length > 0) {
				workspaceScopedModels = await resolveModelScope(modelPatterns, modelRegistry);
			}

			const workspaceSessionManager = parsed.noSession
				? SessionManager.inMemory(resolvedWorkspaceCwd)
				: SessionManager.create(resolvedWorkspaceCwd, parsed.sessionDir);
			const { options: workspaceSessionOptions } = buildSessionOptions(
				parsed,
				workspaceScopedModels,
				workspaceSessionManager,
				modelRegistry,
				workspaceSettingsManager,
			);
			workspaceSessionOptions.cwd = resolvedWorkspaceCwd;
			workspaceSessionOptions.authStorage = authStorage;
			workspaceSessionOptions.modelRegistry = modelRegistry;
			workspaceSessionOptions.resourceLoader = workspaceResourceLoader;
			workspaceSessionOptions.settingsManager = workspaceSettingsManager;
			workspaceSessionOptions.enableMCP = sessionOptions.enableMCP;
			workspaceSessionOptions.enableSoul = sessionOptions.enableSoul;

			const { session: workspaceSession } = await createAgentSession(workspaceSessionOptions);
			return workspaceSession;
		};

		await runAcpMode(session, { createSessionForCwd: createAcpSessionForCwd });
	} else if (mode === "rpc") {
		await runRpcMode(session);
	} else if (isInteractive) {
		if (scopedModels.length > 0 && (parsed.verbose || !settingsManager.getQuietStartup())) {
			const modelList = scopedModels
				.map((sm) => {
					const thinkingStr = sm.thinkingLevel ? `:${sm.thinkingLevel}` : "";
					return `${sm.model.id}${thinkingStr}`;
				})
				.join(", ");
			console.log(chalk.dim(`Model scope: ${modelList} ${chalk.gray("(Ctrl+P to cycle)")}`));
		}

		const mode = new InteractiveMode(session, {
			migratedProviders,
			modelFallbackMessage,
			initialMessage,
			initialImages,
			initialMessages: parsed.messages,
			verbose: parsed.verbose,
		});
		await mode.run();
	} else {
		await runPrintMode(session, {
			mode,
			messages: parsed.messages,
			initialMessage,
			initialImages,
		});
		stopThemeWatcher();
		if (process.stdout.writableLength > 0) {
			await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
		}
		process.exit(0);
	}
}
