/**
 * [WHO]: tokenSaveExtension - default-on bash output filtering, savings tracking, and /tokensave command
 * [FROM]: Depends on core/extensions-host/types, ./filters, ./tracking, ./paths
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/builtin/token-save/index.ts - TokenSave extension entry point
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ToolResultEvent, ToolResultEventResult } from "../../../core/extensions-host/types.js";
import { executeBash, type BashResult } from "../../../core/platform/exec/bash-executor.js";
import { loadTokenSaveConfigFilters, type ConfiguredTokenSaveFilter } from "./config.js";
import { applyTokenSavePlan } from "./runner.js";
import { planCommand } from "./rewrite.js";
import { applyTomlStyleFilter } from "./toml-dsl.js";
import { TokenSaveTracker } from "./tracking.js";
import { resolveTokenSavePaths } from "./paths.js";

const TOKENSAVE_COMMAND_COMPLETIONS = [
	{ value: "summary", label: "summary", description: "Show total shell output savings" },
	{ value: "history", label: "history", description: "Show recent shortened commands" },
	{ value: "reload", label: "reload", description: "Reload project output-shortening rules" },
	{ value: "plan", label: "plan", description: "Preview how a command will be shortened" },
];

function getTextContent(event: ToolResultEvent): string | undefined {
	const parts = event.content.filter((part): part is { type: "text"; text: string } => part.type === "text");
	if (parts.length === 0) return undefined;
	return parts.map((part) => part.text).join("\n");
}

function getCommand(event: ToolResultEvent): string | undefined {
	const command = event.input.command;
	return typeof command === "string" ? command : undefined;
}

function recoveryPathFromDetails(event: ToolResultEvent): string | undefined {
	const details = event.details as { fullOutputPath?: unknown } | undefined;
	if (typeof details?.fullOutputPath === "string") return details.fullOutputPath;
	const text = getTextContent(event);
	const match = text?.match(/Full output:\s+([^\]\n]+)/);
	return match?.[1]?.trim();
}

export async function migrateLegacyTokenSave(projectPath: string, projectKey: string, dataDir: string): Promise<void> {
	const legacyDir = join(projectPath, ".catui", "token-save");
	const marker = join(dataDir, ".migrated");
	try {
		await mkdir(dataDir, { recursive: true });
		try {
			await writeFile(marker, "", { flag: "wx" });
		} catch {
			return; // already migrated or another process won the race
		}

		const legacyHistory = join(legacyDir, "history.jsonl");
		const legacyRaw = join(legacyDir, "raw");
		const newHistory = join(dataDir, "history.jsonl");
		const newRaw = join(dataDir, "raw");

		await mkdir(dirname(newHistory), { recursive: true });
		try {
			await rename(legacyHistory, newHistory);
		} catch {
			// missing legacy history is fine
		}
		try {
			await mkdir(newRaw, { recursive: true });
			const { readdir } = await import("node:fs/promises");
			const files = await readdir(legacyRaw).catch(() => []);
			for (const file of files) {
				try {
					await rename(join(legacyRaw, file), join(newRaw, file));
				} catch {
					// best-effort per file
				}
			}
		} catch {
			// best-effort
		}
		// projectKey is recorded only to make the migration observable; nothing reads it
		void projectKey;
	} catch {
		// Migration must never break the agent startup.
	}
}

export default async function tokenSaveExtension(api: ExtensionAPI): Promise<void> {
	const { projectKey, dataDir, historyFile } = await resolveTokenSavePaths(api.cwd);
	void migrateLegacyTokenSave(api.cwd, projectKey, dataDir);

	const tracker = new TokenSaveTracker(dataDir, historyFile);
	let configuredFilters: ConfiguredTokenSaveFilter[] = [];

	void loadTokenSaveConfigFilters(api.cwd).then((filters) => {
		configuredFilters = filters;
	});

	api.registerCommand("tokensave", {
		description: "Review shell output shortening. Usage: /tokensave [summary|history|reload|plan <cmd>]",
		getArgumentCompletions: (argumentPrefix, context) => {
			if (context && context.tokenIndex > 0) return null;
			const prefix = argumentPrefix.trim().toLowerCase();
			const values = TOKENSAVE_COMMAND_COMPLETIONS.filter((value) => value.value.startsWith(prefix));
			return values.length > 0 ? values : null;
		},
		async handler(args, ctx) {
			const trimmed = args.trim();
			if (trimmed === "reload") {
				configuredFilters = await loadTokenSaveConfigFilters(api.cwd);
				ctx.ui.notify(`TokenSave loaded ${configuredFilters.length} configured filter(s).`, "info");
				return;
			}
			if (trimmed.startsWith("plan ")) {
				const plan = planCommand(trimmed.slice(5));
				ctx.ui.notify(JSON.stringify(plan, null, 2), "info");
				return;
			}
			if (trimmed === "history") {
				ctx.ui.notify(tracker.formatHistory(), "info");
				return;
			}
			ctx.ui.notify(tracker.formatSummary(), "info");
		},
	});

	api.on("tool_call", (event) => {
		if (event.toolName !== "bash") return;
		const command = typeof event.input.command === "string" ? event.input.command : undefined;
		if (!command) return;
		const plan = planCommand(command);
		if (plan.mode === "passthrough") return;
		return { input: { ...event.input, command } };
	});

	api.on("user_bash", async (event) => {
		if (event.excludeFromContext) return;
		const plan = planCommand(event.command);
		if (plan.mode === "passthrough") return;

		const rawResult = await executeBash(event.command, { cwd: event.cwd });
		const filteredResult = await applyToBashResult(event.command, rawResult, dataDir, configuredFilters, tracker, Date.now(), api.cwd);
		return { result: filteredResult };
	});

	api.on("tool_result", async (event: ToolResultEvent): Promise<ToolResultEventResult | void> => {
		if (event.toolName !== "bash") return;

		const command = getCommand(event);
		const rawText = getTextContent(event);
		if (!command || !rawText) return;

		const started = Date.now();
		const result = await applyTokenSavePlan(command, rawText, dataDir);
		const configured = applyConfiguredFilter(command, rawText, configuredFilters);
		if (configured && configured.length < result.filteredText.length) {
			result.filteredText = configured;
			result.outputTokens = Math.ceil(configured.length / 4);
			result.savedTokens = Math.max(0, result.inputTokens - result.outputTokens);
			result.savingsPct = result.inputTokens > 0 ? Math.round((result.savedTokens / result.inputTokens) * 100) : 0;
			result.shouldReplace = result.savedTokens >= 32 && result.savingsPct >= 12;
		}

		tracker.add({
			projectPath: api.cwd,
			command,
			category: result.plan.category,
			mode: result.plan.mode === "passthrough" ? "passthrough" : "filtered",
			inputTokens: result.inputTokens,
			outputTokens: result.outputTokens,
			savedTokens: result.savedTokens,
			savingsPct: result.savingsPct,
			elapsedMs: Date.now() - started,
			isError: event.isError,
			rawRecoveryPath: result.rawRecoveryPath ?? recoveryPathFromDetails(event),
		});

		if (!result.shouldReplace) {
			return;
		}

		const recoveryPath = result.rawRecoveryPath ?? recoveryPathFromDetails(event);
		const footer = [
			"",
			`[TokenSave: ${result.inputTokens} -> ${result.outputTokens} estimated tokens, saved ${result.savedTokens} (${result.savingsPct}%), mode=${result.plan.mode}, category=${result.plan.category}]`,
			recoveryPath ? `[Raw recovery: ${recoveryPath}]` : undefined,
		]
			.filter(Boolean)
			.join("\n");

		return {
			content: [{ type: "text", text: `${result.filteredText}${footer}` }],
			details: event.details,
		};
	});
}

async function applyToBashResult(
	command: string,
	rawResult: BashResult,
	dataDir: string,
	configuredFilters: ConfiguredTokenSaveFilter[],
	tracker: TokenSaveTracker,
	started: number,
	projectPath: string,
): Promise<BashResult> {
	const result = await applyTokenSavePlan(command, rawResult.output, dataDir);
	const configured = applyConfiguredFilter(command, rawResult.output, configuredFilters);
	if (configured && configured.length < result.filteredText.length) {
		result.filteredText = configured;
		result.outputTokens = Math.ceil(configured.length / 4);
		result.savedTokens = Math.max(0, result.inputTokens - result.outputTokens);
		result.savingsPct = result.inputTokens > 0 ? Math.round((result.savedTokens / result.inputTokens) * 100) : 0;
		result.shouldReplace = result.savedTokens >= 32 && result.savingsPct >= 12;
	}

	tracker.add({
		projectPath,
		command,
		category: result.plan.category,
		mode: result.plan.mode === "passthrough" ? "passthrough" : "filtered",
		inputTokens: result.inputTokens,
		outputTokens: result.outputTokens,
		savedTokens: result.savedTokens,
		savingsPct: result.savingsPct,
		elapsedMs: Date.now() - started,
		isError: (rawResult.exitCode ?? 0) !== 0,
		rawRecoveryPath: result.rawRecoveryPath ?? rawResult.fullOutputPath,
	});

	if (!result.shouldReplace) return rawResult;
	const footer = [
		"",
		`[TokenSave: ${result.inputTokens} -> ${result.outputTokens} estimated tokens, saved ${result.savedTokens} (${result.savingsPct}%), mode=${result.plan.mode}, category=${result.plan.category}]`,
		result.rawRecoveryPath ? `[Raw recovery: ${result.rawRecoveryPath}]` : undefined,
	]
		.filter(Boolean)
		.join("\n");
	return {
		...rawResult,
		output: `${result.filteredText}${footer}`,
		truncated: rawResult.truncated,
		fullOutputPath: result.rawRecoveryPath ?? rawResult.fullOutputPath,
	};
}

function applyConfiguredFilter(command: string, rawText: string, filters: ConfiguredTokenSaveFilter[]): string | undefined {
	for (const filter of filters) {
		try {
			if (!new RegExp(filter.commandPattern).test(command)) continue;
			return applyTomlStyleFilter(filter.filter, rawText);
		} catch {
			continue;
		}
	}
	return undefined;
}
