/**
 * [WHO]: SubAgent extension, registers /subagent commands and message renderer
 * [FROM]: Depends on @pencil-agent/tui, core/extensions/types, ./subagent-runner, ./subagent-parser, ./subagent-types
 * [TO]: Consumed by builtin-extensions.ts as default extension
 * [HERE]: extensions/defaults/subagent/index.ts - entry point for subagent extension
 */

import { Box, Container, Spacer, Text } from "@pencil-agent/tui";
import type { ExtensionAPI } from "../../../core/extensions/types.js";
import { SubAgentRunner } from "./subagent-runner.js";
import { buildSubAgentHelp, parseSubAgentCommand } from "./subagent-parser.js";
import type { SubAgentRunReport } from "./subagent-types.js";

const SUBAGENT_MESSAGE_TYPE = "subagent";
const SUBAGENT_ROOT_COMPLETIONS = [
	{ value: "run", label: "run", description: "Start a background helper task" },
	{ value: "stop", label: "stop", description: "Stop the current helper task" },
	{ value: "status", label: "status", description: "Show current helper task status" },
	{ value: "report", label: "report", description: "Show the latest helper report" },
	{ value: "apply", label: "apply", description: "Copy isolated changes into this workspace" },
	{ value: "help", label: "help", description: "Show helper commands" },
] as const;
const SUBAGENT_RUN_COMPLETIONS = [
	{ value: "--write", label: "--write", description: "Allow changes in an isolated workspace" },
] as const;

// Global runner instance
let runner: SubAgentRunner | null = null;
let lastReport: SubAgentRunReport | null = null;

function getRunner(): SubAgentRunner {
	if (!runner) {
		runner = new SubAgentRunner();
	}
	return runner;
}

export default async function subagentExtension(api: ExtensionAPI): Promise<void> {
	api.registerMessageRenderer(SUBAGENT_MESSAGE_TYPE, (message, _options, theme) => {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("\n");

		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(theme.fg("customMessageText", text), 0, 0));

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	});

	const commandNames = ["subagent", "subagent:run", "subagent:stop", "subagent:status", "subagent:report", "subagent:apply"] as const;
	for (const commandName of commandNames) {
		api.registerCommand(commandName, {
			description: getCommandDescription(commandName),
			getArgumentCompletions: (argumentPrefix, context) => getArgumentCompletions(commandName, argumentPrefix, context),
			handler: async (args: string, ctx) => {
				const parsed = parseSubAgentCommand(commandName, args);

				if (!parsed) {
					ctx.ui.notify("Invalid /subagent command. Use /subagent for usage.", "error");
					return;
				}

				const subRunner = getRunner();

				switch (parsed.command) {
					case "help": {
						api.sendMessage({ customType: SUBAGENT_MESSAGE_TYPE, content: buildSubAgentHelp(), display: true });
						break;
					}

					case "run": {
						if (!parsed.task) {
							ctx.ui.notify("Usage: /subagent:run <task> [--write]", "error");
							return;
						}

						const model = ctx.model;

						api.sendMessage({
							customType: SUBAGENT_MESSAGE_TYPE,
							content: `Starting SubAgent run (${parsed.options?.write ? "isolated write workspace" : "read-only"})...\n\nTask: ${parsed.task}${model ? `\nModel: ${model.id ?? model.name ?? "unknown"}` : ""}`,
							display: true,
						});

						try {
							const report = await subRunner.run(parsed.task, {
								runRole: parsed.options?.write ? "implement" : "research",
								model,
								cwd: ctx.cwd,
							});
							lastReport = report;

							const lines = [
								report.success
									? `SubAgent run completed in ${Math.round(report.duration / 1000)}s.`
									: "SubAgent run failed.",
								"",
								report.summary || "(no summary)",
							];
							if (report.workspacePath) {
								lines.push("", `Workspace: ${report.workspacePath}`);
							}
							if (report.patchPath) {
								lines.push(`Patch: ${report.patchPath}`);
							}
							if (report.reportPath) {
								lines.push(`Report: ${report.reportPath}`);
							}
							if (report.patchPreview) {
								lines.push("", "Patch Preview:", report.patchPreview);
							}
							if (report.workspacePath && !report.appliedAt) {
								lines.push("Confirm write-back with /subagent:apply");
							}

							api.sendMessage({
								customType: SUBAGENT_MESSAGE_TYPE,
								content: lines.join("\n"),
								display: true,
								details: report,
							});
						} catch (error: unknown) {
							const message = error instanceof Error ? error.message : String(error);
							ctx.ui.notify(`Error: ${message}`, "error");
						}
						break;
					}

					case "stop": {
						await subRunner.stop();
						api.sendMessage({
							customType: SUBAGENT_MESSAGE_TYPE,
							content: "Stopping SubAgent run...",
							display: true,
						});
						break;
					}

					case "status": {
						api.sendMessage({
							customType: SUBAGENT_MESSAGE_TYPE,
							content: subRunner.getStatusText(),
							display: true,
						});
						break;
					}

					case "report": {
						if (!lastReport) {
							api.sendMessage({
								customType: SUBAGENT_MESSAGE_TYPE,
								content: "No SubAgent report available.",
								display: true,
							});
							break;
						}
						const lines = [
							"Last SubAgent Report:",
							"",
							`Run ID: ${lastReport.runId}`,
							`Duration: ${Math.round(lastReport.duration / 1000)}s`,
							`Success: ${lastReport.success ? "Yes" : "No"}`,
							...(lastReport.workspacePath ? [`Workspace: ${lastReport.workspacePath}`] : []),
							...(lastReport.patchPath ? [`Patch: ${lastReport.patchPath}`] : []),
							...(lastReport.reportPath ? [`Report: ${lastReport.reportPath}`] : []),
							...(lastReport.appliedAt ? [`Applied: ${new Date(lastReport.appliedAt).toISOString()}`] : []),
							"",
							"Summary:",
							lastReport.summary || "(no summary)",
							...(lastReport.patchPreview ? ["", "Patch Preview:", lastReport.patchPreview] : []),
						];
						api.sendMessage({
							customType: SUBAGENT_MESSAGE_TYPE,
							content: lines.join("\n"),
							display: true,
							details: lastReport,
						});
						break;
					}

					case "apply": {
						const report = await subRunner.applyLatest();
						lastReport = report;
						const lines = [
							"Applied isolated SubAgent changes to the main workspace.",
							"",
							...(report.changedFiles.length > 0 ? report.changedFiles.map((file) => `- ${file}`) : ["- (no changed files)"]),
							...(report.reportPath ? ["", `Report: ${report.reportPath}`] : []),
						];
						api.sendMessage({
							customType: SUBAGENT_MESSAGE_TYPE,
							content: lines.join("\n"),
							display: true,
							details: report,
						});
						break;
					}
				}
			},
		});
	}
}

function getArgumentCompletions(
	commandName: string,
	argumentPrefix: string,
	context?: { tokenIndex: number },
): Array<{ value: string; label: string; description?: string }> | null {
	if (commandName === "subagent:run" && context && context.tokenIndex > 0) return null;
	const prefix = argumentPrefix.trim().toLowerCase();
	const values =
		commandName === "subagent"
			? SUBAGENT_ROOT_COMPLETIONS
			: commandName === "subagent:run"
				? SUBAGENT_RUN_COMPLETIONS
				: [];
	const matches = values.filter((value) => value.value.startsWith(prefix));
	return matches.length > 0 ? matches.map((value) => ({ ...value })) : null;
}

function getCommandDescription(commandName: string): string {
	switch (commandName) {
		case "subagent:run":
			return "Start a background helper task (/subagent:run <task> [--write])";
		case "subagent:stop":
			return "Stop the active background helper task";
		case "subagent:status":
			return "Show current background helper status";
		case "subagent:report":
			return "Show the latest background helper report";
		case "subagent:apply":
			return "Apply the latest isolated write run to the main workspace";
		default:
			return "Run or inspect a background helper task";
	}
}
