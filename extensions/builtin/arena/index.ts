/**
 * [WHO]: Arena extension - parallel subagent racing for the same problem
 * [FROM]: Depends on @catui/tui, core/extensions-host/types, ./arena-runner, ./arena-types
 * [TO]: Consumed by builtin-extensions.ts as default extension
 * [HERE]: extensions/builtin/arena/index.ts - entry point for Arena mode
 */

import { Box, Container, Spacer, Text } from "@catui/tui";
import type { ExtensionAPI } from "../../../core/extensions-host/types.js";
import { ArenaRunner } from "./arena-runner.js";
import type { ArenaReport } from "./arena-types.js";

const ARENA_MESSAGE_TYPE = "arena";
const ARENA_ROOT_COMPLETIONS = [
	{ value: "run", label: "run", description: "Start an Arena race with strategies" },
	{ value: "stop", label: "stop", description: "Stop the current Arena race" },
	{ value: "status", label: "status", description: "Show current Arena status" },
	{ value: "results", label: "results", description: "Show latest Arena results" },
	{ value: "cleanup", label: "cleanup", description: "Clean up Arena worktrees" },
	{ value: "help", label: "help", description: "Show Arena commands" },
] as const;

let runner: ArenaRunner | null = null;
let lastReport: ArenaReport | null = null;

function getRunner(): ArenaRunner {
	if (!runner) {
		runner = new ArenaRunner();
	}
	return runner;
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}

function formatReport(report: ArenaReport): string {
	const lines: string[] = [];
	lines.push(`## Arena Results (${report.arenaId})`);
	lines.push("");
	lines.push(`**Problem:** ${report.problem.slice(0, 200)}${report.problem.length > 200 ? "..." : ""}`);
	lines.push("");

	const totalDuration = report.endTime ? report.endTime - report.startTime : Date.now() - report.startTime;
	lines.push(`**Duration:** ${formatDuration(totalDuration)}`);
	lines.push("");

	lines.push("### Contestants:");
	lines.push("");

	for (const contestant of report.contestants) {
		const isWinner = contestant.id === report.winnerId;
		const statusIcon =
			contestant.status === "completed" ? (isWinner ? "🏆" : "✓") :
			contestant.status === "failed" ? "✗" :
			contestant.status === "aborted" ? "⊘" : "⟳";

		const duration = contestant.endTime ? formatDuration(contestant.endTime - contestant.startTime) : "running...";
		const winnerTag = isWinner ? " **(winner)**" : "";

		lines.push(`- ${statusIcon} **${contestant.id}**${winnerTag} [${duration}]`);
		lines.push(`  Strategy: ${contestant.strategy.slice(0, 100)}${contestant.strategy.length > 100 ? "..." : ""}`);

		if (contestant.result?.response) {
			const responsePreview = contestant.result.response.slice(0, 300);
			lines.push(`  Result: ${responsePreview}${contestant.result.response.length > 300 ? "..." : ""}`);
		}
		if (contestant.error) {
			lines.push(`  Error: ${contestant.error}`);
		}
		lines.push("");
	}

	if (report.winnerId) {
		lines.push(`**Winner:** ${report.winnerId} (fastest successful completion)`);
	} else {
		lines.push("**No winner** (no successful completions)");
	}

	return lines.join("\n");
}

function buildArenaHelp(): string {
	return `## Arena Mode - Parallel Problem Solving

Arena spawns multiple subagents racing to solve the same problem, each with a different strategy/approach. Results are compared and the fastest successful solution wins.

### Commands:
- \`/arena:run <problem> --strategies "strategy1|strategy2|..."\` - Start a race
- \`/arena:stop\` - Stop the current race
- \`/arena:status\` - Show current race status
- \`/arena:results\` - Show latest results
- \`/arena:cleanup\` - Clean up worktrees from last race
- \`/arena:help\` - Show this help

### Example:
\`\`\`
/arena:run Implement a binary search tree --strategies "recursive approach|iterative with stack|functional style"
\`\`\`

### Notes:
- Maximum 4 contestants per race
- Each contestant gets an isolated git worktree
- Winner is the fastest successful completion
- Use \`/arena:cleanup\` to remove worktrees after reviewing results
`;
}

export default async function arenaExtension(api: ExtensionAPI): Promise<void> {
	api.registerMessageRenderer(ARENA_MESSAGE_TYPE, (message, _options, theme) => {
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

	const commandNames = ["arena", "arena:run", "arena:stop", "arena:status", "arena:results", "arena:cleanup", "arena:help"] as const;
	for (const commandName of commandNames) {
		api.registerCommand(commandName, {
			description: getCommandDescription(commandName),
			getArgumentCompletions: (argumentPrefix, _context) => getArgumentCompletions(commandName, argumentPrefix),
			handler: async (args: string, ctx) => {
				const arenaRunner = getRunner();

				switch (commandName) {
					case "arena:help":
					case "arena": {
						api.sendMessage({ customType: ARENA_MESSAGE_TYPE, content: buildArenaHelp(), display: true });
						break;
					}

					case "arena:run": {
						if (arenaRunner.isRunning()) {
							ctx.ui.notify("An Arena race is already in progress. Use /arena:stop to cancel it.", "error");
							return;
						}

						const parsed = parseArenaRun(args);
						if (!parsed) {
							ctx.ui.notify('Usage: /arena:run <problem> --strategies "strategy1|strategy2|..."', "error");
							return;
						}

						ctx.ui.notify(`Arena: starting race with ${parsed.strategies.length} contestants...`, "info");

						try {
							const report = await arenaRunner.run({
								problem: parsed.problem,
								strategies: parsed.strategies,
								cwd: ctx.cwd,
								model: ctx.model,
							});
							lastReport = report;
							api.sendMessage({ customType: ARENA_MESSAGE_TYPE, content: formatReport(report), display: true });
						} catch (error) {
							ctx.ui.notify(`Arena failed: ${error instanceof Error ? error.message : String(error)}`, "error");
						}
						break;
					}

					case "arena:stop": {
						if (!arenaRunner.isRunning()) {
							ctx.ui.notify("No Arena race is running.", "info");
							return;
						}
						await arenaRunner.abort();
						ctx.ui.notify("Arena race stopped.", "info");
						break;
					}

					case "arena:status": {
						const report = arenaRunner.getReport();
						if (!report) {
							ctx.ui.notify("No Arena race has been run yet.", "info");
							return;
						}
						if (arenaRunner.isRunning()) {
							const running = report.contestants.filter((c) => c.status === "running").length;
							const completed = report.contestants.filter((c) => c.status === "completed").length;
							const failed = report.contestants.filter((c) => c.status === "failed").length;
							ctx.ui.notify(`Arena ${report.arenaId} in progress: ${running} running, ${completed} completed, ${failed} failed`, "info");
						} else {
							api.sendMessage({ customType: ARENA_MESSAGE_TYPE, content: formatReport(report), display: true });
						}
						break;
					}

					case "arena:results": {
						const report = lastReport ?? arenaRunner.getReport();
						if (!report) {
							ctx.ui.notify("No Arena results available.", "info");
							return;
						}
						api.sendMessage({ customType: ARENA_MESSAGE_TYPE, content: formatReport(report), display: true });
						break;
					}

					case "arena:cleanup": {
						await arenaRunner.cleanupWorktrees();
						ctx.ui.notify("Arena worktrees cleaned up.", "info");
						break;
					}
				}
			},
		});
	}
}

function getCommandDescription(commandName: string): string {
	switch (commandName) {
		case "arena":
		case "arena:help":
			return "Show Arena mode help";
		case "arena:run":
			return "Start an Arena race with parallel contestants";
		case "arena:stop":
			return "Stop the current Arena race";
		case "arena:status":
			return "Show current Arena race status";
		case "arena:results":
			return "Show latest Arena results";
		case "arena:cleanup":
			return "Clean up Arena worktrees";
		default:
			return "";
	}
}

function getArgumentCompletions(commandName: string, argumentPrefix: string): Array<{ value: string; label: string; description?: string }> | null {
	if (commandName === "arena" || commandName === "arena:help") return null;

	const prefix = argumentPrefix.trim().toLowerCase();

	if (commandName === "arena:run") {
		if (!prefix || prefix.startsWith("--")) {
			return [{ value: '--strategies "', label: "--strategies", description: "Pipe-separated strategies" }];
		}
		return null;
	}

	const matches = ARENA_ROOT_COMPLETIONS.filter((completion) => completion.value.startsWith(prefix));
	if (matches.length === 0) return null;
	return matches.map((completion) => ({ value: completion.value, label: completion.value, description: completion.description }));
}

function parseArenaRun(args: string): { problem: string; strategies: string[] } | null {
	const strategiesMatch = args.match(/--strategies\s+"([^"]+)"/);
	if (!strategiesMatch) return null;

	const problem = args.replace(/--strategies\s+"[^"]+"/, "").trim();
	if (!problem) return null;

	const strategies = strategiesMatch[1]!.split("|").map((s) => s.trim()).filter(Boolean);
	if (strategies.length === 0) return null;

	return { problem, strategies };
}
