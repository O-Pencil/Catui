/**
 * [WHO]: parseSubAgentCommand, buildSubAgentHelp, SubAgentSubcommand, ParsedSubAgentCommand
 * [FROM]: No external dependencies
 * [TO]: Consumed by ./index.ts
 * [HERE]: extensions/builtin/subagent/subagent-parser.ts - command parser for /subagent
 */

export type SubAgentSubcommand = "run" | "stop" | "status" | "report" | "apply" | "help";

export interface ParsedSubAgentCommand {
	command: SubAgentSubcommand;
	task?: string;
	options?: {
		write?: boolean;
	};
}

/**
 * Parse a registered /subagent command invocation.
 * Primary syntax follows the phase-A plan:
 *   /subagent
 *   /subagent:run <task> [--write]
 *   /subagent:stop
 *   /subagent:status
 *   /subagent:report
 *
 * The root command still accepts legacy space-style args for compatibility.
 */
export function parseSubAgentCommand(commandName: string, args = ""): ParsedSubAgentCommand | null {
	const trimmedArgs = args.trim();

	switch (commandName) {
		case "subagent":
			if (!trimmedArgs || trimmedArgs === "help") {
				return { command: "help" };
			}
			if (trimmedArgs === "stop") {
				return { command: "stop" };
			}
			if (trimmedArgs === "status") {
				return { command: "status" };
			}
			if (trimmedArgs === "report") {
				return { command: "report" };
			}
			if (trimmedArgs === "apply") {
				return { command: "apply" };
			}
			if (trimmedArgs.startsWith("run ")) {
				return parseRunArgs(trimmedArgs.slice(4));
			}
			return null;
		case "subagent:run":
			return parseRunArgs(trimmedArgs);
		case "subagent:stop":
			return { command: "stop" };
		case "subagent:status":
			return { command: "status" };
		case "subagent:report":
			return { command: "report" };
		case "subagent:apply":
			return { command: "apply" };
		default:
			return null;
	}
}

function parseRunArgs(rawArgs: string): ParsedSubAgentCommand | null {
	let task = rawArgs.trim();
	if (!task) {
		return null;
	}

	const options: { write?: boolean } = {};
	if (task.includes("--write")) {
		options.write = true;
		task = task.replace(/--write/g, "").trim();
	}

	if (!task) {
		return null;
	}

	return { command: "run", task, options };
}

/**
 * Build help text for /subagent commands.
 */
export function buildSubAgentHelp(): string {
  return `
SubAgent Commands:
  /subagent                  - Show this help
  /subagent:run <task>       - Start a SubAgent run (read-only)
  /subagent:run <task> --write - Start with isolated write access
  /subagent:stop             - Stop current run
  /subagent:status           - Show current run status
  /subagent:report           - Show last run report
  /subagent:apply            - Apply the last isolated write run to the main workspace

Examples:
  /subagent:run Analyze the codebase structure
  /subagent:run Implement login feature --write
  /subagent:apply
`.trim();
}
