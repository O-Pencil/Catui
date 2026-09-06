/**
 * [WHO]: Main CLI handler, orchestrates SDK initialization and mode dispatch
 * [FROM]: Depends on cli/*, core/*, modes/*, packages/*, config.ts
 * [TO]: Consumed by cli.ts
 * [HERE]: CLI layer; parses args → CreateAgentSessionOptions → mode selection
 */

import { supportsXhigh } from "@catui/ai/models";
import chalk from "chalk";
import { join, resolve } from "path";
import { homedir } from "node:os";
import { parseArgs, printHelp } from "./cli/args.js";
import { listModels } from "./cli/list-models.js";
import { handlePackageCommand } from "./cli/package-command.js";
import { buildSessionOptions } from "./cli/session-options.js";
import { selectSession } from "./cli/session-picker.js";
import { createSessionManager, prepareInitialMessage } from "./cli/session-start.js";
import { handleConfigCommand, handleMigrateCommand, reportSettingsErrors } from "./cli/subcommands.js";
import { APP_NAME, PACKAGE_NAME, resolveAgentDirContext, VERSION } from "./config.js";
import { ensureAgentMetadata } from "./core/agent-dir/agent-metadata.js";
import { MigrationManager } from "./core/agent-dir/migration-tool.js";
import { AuthStorage } from "./core/platform/config/auth-storage.js";
import type { LoadExtensionsResult } from "./core/extensions-host/index.js";
import { KeybindingsManager } from "./core/platform/keybindings.js";
import { ModelRegistry } from "./core/model-registry.js";
import { resolveModelScope, type ScopedModel } from "./core/model-resolver.js";
import { DefaultResourceLoader } from "./core/platform/config/resource-loader.js";
import { createAgentSession } from "./core/runtime/sdk.js";
import { SessionManager } from "./core/session/session-manager.js";
import { SettingsManager } from "./core/platform/config/settings-manager.js";

import { time } from "./core/platform/timings.js";
import { createBashTool } from "./core/tools/bash.js";
import { CliApprovalClient } from "./modes/interactive/components/approval-selector.js";
import { runMigrations, showDeprecationWarnings } from "./migrations.js";
// Mode runners (interactive/print/rpc) are dynamically imported at dispatch time (P6/EV02)
// so the CLI only pays for the selected mode — eager-importing the modes barrel here would
// load the interactive TUI (+ all controllers) even for --print/--rpc. ACP already did this.
// The barrel still exists for SDK consumers via root index.ts (public surface unchanged).
import { initTheme, stopThemeWatcher, theme } from "./modes/interactive/theme/theme.js";
import { exportFromFile } from "./core/export-html/index.js";
import { profileCheckpoint } from "./utils/startup-profiler.js";
import { installWarningGuard } from "./utils/warning-guard.js";
import {
	CUSTOM_ANTHROPIC_PROVIDER,
	CUSTOM_OPENAI_PROVIDER,
} from "./core/model/custom-providers.js";
import {
	ensureCatuiCodingPlanAuth,
	ensureCatuiDefaultConfig,
	CATUI_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER,
	CATUI_ALI_TOKEN_PLAN_OPENAI_PROVIDER,
	CATUI_ARK_CODING_PROVIDER,
	CATUI_DEFAULT_PROVIDER,
	CATUI_MINIMAX_CODING_PROVIDER,
	CATUI_QIANFAN_CODING_PROVIDER,
	CATUI_ZHIPU_CODING_PROVIDER,
	CATUI_ANTHROPIC_CUSTOM_PROVIDER,
	CATUI_OLLAMA_PROVIDER,
} from "./catui-defaults.js";
import { getBuiltinExtensionPaths } from "./builtin-extensions.js";

// Check if running in development mode (not production)
const isDevelopment = process.env.NODE_ENV !== "production";
const isCatuiProductApp = APP_NAME === "catui" || APP_NAME === "catui";

// Route Node warnings (listener leaks, deprecations) into the diagnostics bus
// without suppressing them — real issues stay visible on stderr.
// See utils/warning-guard.ts for design history.
installWarningGuard();

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

function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function resolveWorkingDirectory(parsedCwd?: string): string {
	const envCwd = process.env[`${APP_NAME.toUpperCase()}_CWD`];
	const requestedCwd = parsedCwd || envCwd;
	return requestedCwd ? resolve(requestedCwd) : process.cwd();
}

export async function main(args: string[]) {
	profileCheckpoint("main_entry");

	// Auto-migration check: ~/.catui/~/.catui -> ~/.catui
	const migrationManager = new MigrationManager();
	if (migrationManager.isMigrationNeeded()) {
		console.log(chalk.blue(`\n🚀 Initializing Catui ecosystem...`));
		const migrated = migrationManager.runSilent();
		if (migrated.length > 0) {
			console.log(chalk.green(`✅ Successfully migrated legacy data: ${migrated.join(", ")}`));
			console.log(chalk.dim(`New home: ${join(homedir(), ".catui/")}\n`));
		}
	}

	// Initial parse to get agent and basic flags
	const firstPass = parseArgs(args);
	const agentDirCtx = resolveAgentDirContext(firstPass.agent);
	const agentDir = agentDirCtx.path;
	ensureAgentMetadata(agentDirCtx);

	const offlineMode = args.includes("--offline") || isTruthyEnvFlag(process.env.CATUI_OFFLINE);
	if (offlineMode) {
		process.env.CATUI_OFFLINE = "1";
		process.env.CATUI_SKIP_VERSION_CHECK = "1";
	}

	if (await handleMigrateCommand(args)) {
		return;
	}

	if (await handlePackageCommand(args, agentDirCtx)) {
		return;
	}

	if (await handleConfigCommand(args, agentDirCtx)) {
		return;
	}


	// Run migrations (pass cwd for project-local migrations)
	const cwd = resolveWorkingDirectory(firstPass.cwd);
	const { migratedAuthProviders: migratedProviders, deprecationWarnings } = runMigrations(cwd, agentDirCtx);
	profileCheckpoint("after_migrations");

	// Early load extensions to discover their CLI flags
	profileCheckpoint("before_settings_manager");
	const settingsManager = SettingsManager.create(cwd, agentDirCtx);
	profileCheckpoint("settings_manager_ready");
	profileCheckpoint("auth_storage_created", "settings_manager_ready");
	reportSettingsErrors(settingsManager, "startup");

	const authStorage = AuthStorage.create(agentDirCtx);
	if (isCatuiProductApp) {
		ensureCatuiDefaultConfig(agentDir);
		// Let nanomem use catui's config directory to store memory
		if (!process.env.NANOMEM_MEMORY_DIR) {
			process.env.NANOMEM_MEMORY_DIR = join(agentDir, "memory");
		}
	}
	profileCheckpoint("catui_defaults_ensured", "auth_storage_created");

	const modelRegistry = new ModelRegistry(
		authStorage,
		join(agentDir, "models.json"),
		isCatuiProductApp
			? {
					useOnlyCustomModels: true,
					allowOptionalApiKeyForProvider: [
						CATUI_DEFAULT_PROVIDER,
						CATUI_QIANFAN_CODING_PROVIDER,
						CATUI_ARK_CODING_PROVIDER,
						CATUI_MINIMAX_CODING_PROVIDER,
						CATUI_ZHIPU_CODING_PROVIDER,
						CATUI_ALI_TOKEN_PLAN_OPENAI_PROVIDER,
						CATUI_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER,
						CATUI_ANTHROPIC_CUSTOM_PROVIDER,
						CATUI_OLLAMA_PROVIDER,
						"openrouter",
						CUSTOM_ANTHROPIC_PROVIDER,
						CUSTOM_OPENAI_PROVIDER,
					],
				}
			: {},
	);
	profileCheckpoint("model_registry_created");

	const defaultExtPaths = isCatuiProductApp ? getBuiltinExtensionPaths() : [];
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
	if (isCatuiProductApp) {
		const nanomemLoaded = extensionsResult.extensions.some((e) => e.path.includes("nano-mem"));
		const nanomemFailed = extensionsResult.errors.some((e) => e.path.includes("nano-mem"));
		// Only show NanoMem status in development mode (not production)
		if (isDevelopment) {
			if (!nanomemLoaded && (defaultExtPaths.length === 0 || nanomemFailed)) {
				console.error(
					chalk.dim(`NanoMem (persistent memory) not loaded. Reinstall: npm install -g ${PACKAGE_NAME}`),
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

	if (isCatuiProductApp) {
		await ensureCatuiCodingPlanAuth(authStorage, modelRegistry);
	}

	// Fire-and-forget: discover remote models from /models endpoints.
	// Non-blocking — results are cached and merged on next model list access.
	modelRegistry.refreshWithDiscovery().catch(() => {
		// Discovery failures are non-fatal; cached/stale data still works
	});

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
		await listModels(modelRegistry, searchPattern, { refresh: parsed.refreshModels });
		process.exit(0);
	}

	// Warn about serve-mode flags used without --serve (lenient: continue with normal mode selection)
	if (
		!parsed.serve &&
		(parsed.port !== undefined ||
			parsed.host !== undefined ||
			parsed.tunnel !== undefined ||
			parsed.serveToken !== undefined ||
			parsed.advertiseUrl !== undefined)
	) {
		console.error(chalk.yellow("Warning: --port/--host/--tunnel/--token/--advertise only take effect together with --serve."));
	}

	// Read piped stdin content (if any) - skip for RPC/ACP/serve modes which use stdin differently
	if (parsed.mode !== "rpc" && !parsed.acp && !parsed.serve) {
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
	// Catui default theme is warm; write to settings when unset for persistence
	if (isCatuiProductApp && settingsManager.getTheme() === undefined) {
		settingsManager.setTheme("warm");
	}
	initTheme(settingsManager.getTheme() ?? (isCatuiProductApp ? "warm" : undefined), isInteractive);

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
	let sessionManager = await createSessionManager(parsed, parsedCwd, agentDirCtx);

	// Handle --resume: show session picker
	if (parsed.resume) {
		// Initialize keybindings so session picker respects user config
		KeybindingsManager.create(agentDirCtx);

		const selectedPath = await selectSession(
			(onProgress) => SessionManager.list(parsedCwd, parsed.sessionDir, onProgress, agentDirCtx),
			(onProgress) => SessionManager.listAll(onProgress, agentDirCtx),
		);
		if (!selectedPath) {
			console.log(chalk.dim("No session selected"));
			stopThemeWatcher();
			process.exit(0);
		}
		sessionManager = SessionManager.open(selectedPath, undefined, agentDirCtx);
	}

	const { options: sessionOptions, cliThinkingFromModel } = buildSessionOptions(
		parsed,
		scopedModels,
		sessionManager,
		modelRegistry,
		settingsManager,
		agentDirCtx,
	);
	// Catui enables MCP by default; disabled in offline mode or with --no-mcp flag
	sessionOptions.agentDir = agentDir;
	sessionOptions.enableMCP = isCatuiProductApp && !offlineMode && !parsed.noMcp;
	// Interactive mode warms MCP in the background after the UI is ready so the
	// prompt is usable immediately instead of blocking on MCP server spawn (the
	// npx-based default servers measure ~20s). One-shot modes (print/acp/rpc)
	// keep synchronous MCP load so tools are present before their first turn.
	sessionOptions.deferMcpInit = isInteractive && !parsed.acp;
	sessionOptions.cwd = parsedCwd;
	sessionOptions.authStorage = authStorage;
	sessionOptions.modelRegistry = modelRegistry;
	sessionOptions.resourceLoader = resourceLoader;
	// Inject the theme so HTML export renders custom extension tools (the UI layer owns the
	// theme; core/runtime no longer imports it — U2 seam). `theme` is the lazy singleton proxy.
	sessionOptions.theme = theme;

	// Layer 2 (ADR bash-pre-execution-approval-decision): inject a pre-execution
	// approval client for bash tool. Interactive + catui product app only — print /
	// rpc modes use the fast-path (no client wired) so existing CLI behavior is
	// preserved. The CLI client here is the layer-2 *runtime* wire; the full TUI
	// selector (ApprovalSelectorComponent) is the polished layer-3 surface and
	// stays unmounted in this commit — see ADR §D6 "session persistence" + the
	// "out of scope" list in commit 93cd746.
	// Default: OFF. Users opt back in via settings.bashApproval = true.
	if (isInteractive && !parsed.serve && isCatuiProductApp && settingsManager.getBashApproval()) {
		sessionOptions.baseToolsOverride = {
			bash: createBashTool(parsedCwd, {
				commandPrefix: settingsManager.getShellCommandPrefix(),
				approval: new CliApprovalClient(),
			}),
		};
	}

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
		console.error(chalk.yellow(`\nOr create ${join(agentDir, "models.json")}`));
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
			const workspaceSettingsManager = SettingsManager.create(resolvedWorkspaceCwd, agentDirCtx);
			reportSettingsErrors(workspaceSettingsManager, "acp startup");

			const workspaceResourceLoader = new DefaultResourceLoader({
				cwd: resolvedWorkspaceCwd,
				agentDir,
				settingsManager: workspaceSettingsManager,
				agentCtx: agentDirCtx,
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
				? SessionManager.inMemory(resolvedWorkspaceCwd, agentDirCtx)
				: SessionManager.create(resolvedWorkspaceCwd, parsed.sessionDir, agentDirCtx);
			const { options: workspaceSessionOptions } = buildSessionOptions(
				parsed,
				workspaceScopedModels,
				workspaceSessionManager,
				modelRegistry,
				workspaceSettingsManager,
				agentDirCtx,
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
		const { runRpcMode } = await import("./modes/rpc/rpc-mode.js");
		await runRpcMode(session);
	} else if (parsed.serve) {
		const { runRemoteMode } = await import("./modes/remote/remote-mode.js");
		await runRemoteMode(session, {
			port: parsed.port,
			host: parsed.host,
			tunnel: parsed.tunnel === true,
			serveToken: parsed.serveToken,
			advertiseUrl: parsed.advertiseUrl,
		});
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

		const { InteractiveMode } = await import(
			"./modes/interactive/interactive-mode.js"
		);
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
		const { runPrintMode } = await import("./modes/print-mode.js");
		const printResult = await runPrintMode(session, {
			mode,
			messages: parsed.messages,
			initialMessage,
			initialImages,
			printLoopResult: parsed.printLoopResult,
			printTranscript: parsed.printTranscript,
			failOnAgentError: parsed.failOnAgentError,
			failOnToolDenial: parsed.failOnToolDenial,
		});
		stopThemeWatcher();
		if (process.stdout.writableLength > 0) {
			await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
		}
		process.exit(printResult.exitCode);
	}
}
