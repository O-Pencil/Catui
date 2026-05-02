/**
 * [WHO]: Team command parser - /team:* subcommands including harness/preset/dashboard/status helpers
 * [FROM]: No external deps
 * [TO]: Consumed by index.ts
 * [HERE]: extensions/defaults/team/team-parser.ts
 *
 * Parses /team series commands per Phase B spec:
 *   /team                      - List teammates
 *   /team:spawn <role> [--name <id>] [--harness] - Create teammate
 *   /team:send <name> <message>      - Send message to teammate
 *   /team:status [<name>]            - Show status
 *   /team:preset <solo|duo|squad> <task> - Create preset team
 *   /team:progress [<name>]          - Show harness progress
 *   /team:psyche [<name>]            - Show psyche weights
 *   /team:dashboard                  - Toggle dashboard widget
 *   /team:task <add|claim|done|block|cancel|list> ... - Manage shared task list
 *   /team:mail <from> <to> <message> - Route a teammate-to-teammate mailbox message
 *   /team:allow-path <name> <path>   - Grant teammate write access to a path prefix
 *   /team:stop <name>                - Stop teammate turn
 *   /team:terminate <name>           - Destroy teammate
 *   /team:approve <request-id>       - Approve permission request
 *   /team:mode <name> <plan|execute|review> - Switch mode
 */

import type { PresetName, TeammateMode, TeammateRole } from "./team-types.js";

export type TeamSubcommand =
	| "list"
	| "spawn"
	| "send"
	| "status"
	| "stop"
	| "terminate"
	| "approve"
	| "mode"
	| "preset"
	| "auto"
	| "dashboard"
	| "progress"
	| "psyche"
	| "task"
	| "mail"
	| "allow-path"
	| "help";

export interface ParsedTeamCommand {
	command: TeamSubcommand;
	/** For spawn: role name */
	role?: TeammateRole;
	/** For spawn: optional name override */
	name?: string;
	/** For send/status/stop/terminate/approve/mode: target teammate name or request id */
	target?: string;
	/** For send: message content */
	message?: string;
	/** For mode: target mode */
	mode?: TeammateMode;
	/** For approve: request id */
	requestId?: string;
	/** For spawn: enable harness protocol */
	harnessEnabled?: boolean;
	/** For preset: preset name */
	presetName?: PresetName;
	/** For preset: task description */
	taskDescription?: string;
	/** For task: task subcommand */
	taskAction?: "add" | "claim" | "done" | "block" | "cancel" | "list";
	/** For task: task id */
	taskId?: string;
	/** For task add: title */
	taskTitle?: string;
	/** For mail: source teammate */
	from?: string;
	/** For mail: target teammate */
	to?: string;
	/** For allow-path: path prefix */
	path?: string;
}

const VALID_ROLES: TeammateRole[] = ["researcher", "reviewer", "implementer", "planner", "verifier", "generic"];
const VALID_MODES: TeammateMode[] = ["research", "plan", "execute", "review"];
const VALID_PRESETS: PresetName[] = ["solo", "duo", "squad"];

/**
 * Parse a /team command invocation.
 */
export function parseTeamCommand(commandName: string, args = ""): ParsedTeamCommand | null {
	const trimmedArgs = args.trim();

	switch (commandName) {
		case "team":
			if (!trimmedArgs) {
				return { command: "list" };
			}
			if (trimmedArgs === "help") {
				return { command: "help" };
			}
			// Try to parse as subcommand with colon syntax fallback
			if (trimmedArgs.startsWith("spawn ")) {
				return parseSpawnArgs(trimmedArgs.slice(6));
			}
			if (trimmedArgs.startsWith("send ")) {
				return parseSendArgs(trimmedArgs.slice(5));
			}
			if (trimmedArgs.startsWith("status")) {
				return parseStatusArgs(trimmedArgs.slice(6).trim());
			}
			if (trimmedArgs.startsWith("stop ")) {
				return { command: "stop", target: trimmedArgs.slice(5).trim() };
			}
			if (trimmedArgs.startsWith("terminate ")) {
				return { command: "terminate", target: trimmedArgs.slice(10).trim() };
			}
			if (trimmedArgs === "approve") {
				return { command: "approve" };
			}
			if (trimmedArgs.startsWith("approve ")) {
				return { command: "approve", requestId: trimmedArgs.slice(8).trim() || undefined };
			}
			if (trimmedArgs.startsWith("mode ")) {
				return parseModeArgs(trimmedArgs.slice(5));
			}
			if (trimmedArgs.startsWith("preset ")) {
				return parsePresetArgs(trimmedArgs.slice(7));
			}
			if (trimmedArgs === "dashboard") {
				return { command: "dashboard" };
			}
			if (trimmedArgs.startsWith("progress")) {
				return parseTargetOnly("progress", trimmedArgs.slice(8).trim());
			}
			if (trimmedArgs.startsWith("psyche")) {
				return parseTargetOnly("psyche", trimmedArgs.slice(6).trim());
			}
			if (trimmedArgs.startsWith("task")) {
				return parseTaskArgs(trimmedArgs.slice(4).trim());
			}
			if (trimmedArgs.startsWith("mail ")) {
				return parseMailArgs(trimmedArgs.slice(5));
			}
			if (trimmedArgs.startsWith("allow-path ")) {
				return parseAllowPathArgs(trimmedArgs.slice(11));
			}
			return { command: "auto", taskDescription: trimmedArgs };

		case "team:spawn":
			return parseSpawnArgs(trimmedArgs);
		case "team:send":
			return parseSendArgs(trimmedArgs);
		case "team:status":
			return parseStatusArgs(trimmedArgs);
		case "team:stop":
			return trimmedArgs ? { command: "stop", target: trimmedArgs } : null;
		case "team:terminate":
			return trimmedArgs ? { command: "terminate", target: trimmedArgs } : null;
		case "team:approve":
			return trimmedArgs ? { command: "approve", requestId: trimmedArgs } : { command: "approve" };
		case "team:mode":
			return parseModeArgs(trimmedArgs);
		case "team:preset":
			return parsePresetArgs(trimmedArgs);
		case "team:dashboard":
			return { command: "dashboard" };
		case "team:progress":
			return parseTargetOnly("progress", trimmedArgs);
		case "team:psyche":
			return parseTargetOnly("psyche", trimmedArgs);
		case "team:task":
			return parseTaskArgs(trimmedArgs);
		case "team:mail":
			return parseMailArgs(trimmedArgs);
		case "team:allow-path":
			return parseAllowPathArgs(trimmedArgs);
		default:
			return null;
	}
}

function parseSpawnArgs(rawArgs: string): ParsedTeamCommand | null {
	const parts = rawArgs.trim().split(/\s+/);
	if (parts.length === 0) return null;

	const role = parts[0] as TeammateRole;
	if (!VALID_ROLES.includes(role)) {
		return null;
	}

	let name: string | undefined;
	let harnessEnabled = false;
	for (let i = 1; i < parts.length; i++) {
		if (parts[i] === "--name" && i + 1 < parts.length) {
			name = parts[i + 1];
			i++;
		} else if (parts[i] === "--harness") {
			harnessEnabled = true;
		}
	}

	return harnessEnabled ? { command: "spawn", role, name, harnessEnabled } : { command: "spawn", role, name };
}

function parseSendArgs(rawArgs: string): ParsedTeamCommand | null {
	const trimmed = rawArgs.trim();
	const spaceIdx = trimmed.indexOf(" ");
	if (spaceIdx === -1) {
		// No message provided
		return null;
	}

	const target = trimmed.slice(0, spaceIdx);
	const message = trimmed.slice(spaceIdx + 1).trim();
	if (!target || !message) return null;

	return { command: "send", target, message };
}

function parseStatusArgs(rawArgs: string): ParsedTeamCommand | null {
	const target = rawArgs.trim();
	return { command: "status", target: target || undefined };
}

function parseModeArgs(rawArgs: string): ParsedTeamCommand | null {
	const parts = rawArgs.trim().split(/\s+/);
	if (parts.length < 2) return null;

	const target = parts[0];
	const mode = parts[1] as TeammateMode;
	if (!VALID_MODES.includes(mode)) {
		return null;
	}

	return { command: "mode", target, mode };
}

function parsePresetArgs(rawArgs: string): ParsedTeamCommand | null {
	const trimmed = rawArgs.trim();
	const spaceIdx = trimmed.indexOf(" ");
	const preset = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)) as PresetName;
	if (!VALID_PRESETS.includes(preset)) return null;

	const taskDescription = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
	if (!taskDescription) return null;

	return { command: "preset", presetName: preset, taskDescription };
}

function parseTargetOnly(command: "progress" | "psyche", rawArgs: string): ParsedTeamCommand {
	const target = rawArgs.trim();
	return { command, target: target || undefined };
}

function parseTaskArgs(rawArgs: string): ParsedTeamCommand | null {
	const trimmed = rawArgs.trim();
	if (!trimmed || trimmed === "list") return { command: "task", taskAction: "list" };

	const spaceIdx = trimmed.indexOf(" ");
	const action = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)) as ParsedTeamCommand["taskAction"];
	const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

	if (action === "add") {
		return rest ? { command: "task", taskAction: "add", taskTitle: rest } : null;
	}
	if (action === "claim") {
		const parts = rest.split(/\s+/);
		return parts[0] && parts[1] ? { command: "task", taskAction: "claim", taskId: parts[0], target: parts[1] } : null;
	}
	if (action === "done" || action === "block" || action === "cancel") {
		return rest ? { command: "task", taskAction: action, taskId: rest.split(/\s+/)[0] } : null;
	}
	return null;
}

function parseMailArgs(rawArgs: string): ParsedTeamCommand | null {
	const trimmed = rawArgs.trim();
	const firstSpace = trimmed.indexOf(" ");
	if (firstSpace === -1) return null;
	const secondSpace = trimmed.indexOf(" ", firstSpace + 1);
	if (secondSpace === -1) return null;
	const from = trimmed.slice(0, firstSpace);
	const to = trimmed.slice(firstSpace + 1, secondSpace);
	const message = trimmed.slice(secondSpace + 1).trim();
	if (!from || !to || !message) return null;
	return { command: "mail", from, to, message };
}

function parseAllowPathArgs(rawArgs: string): ParsedTeamCommand | null {
	const trimmed = rawArgs.trim();
	const spaceIdx = trimmed.indexOf(" ");
	if (spaceIdx === -1) return null;
	const target = trimmed.slice(0, spaceIdx);
	const path = trimmed.slice(spaceIdx + 1).trim();
	if (!target || !path) return null;
	return { command: "allow-path", target, path };
}

/**
 * Build help text for /team commands.
 */
export function buildTeamHelp(): string {
	return `
Team Commands (AgentTeam + Harness):
  /team                           - List all teammates
  /team <task>                    - Auto-select a team and start the task
  /team:spawn <role> [--name <n>] [--harness] - Create a persistent teammate
  /team:preset <solo|duo|squad> <task> - Create teammates from a preset
  /team:send <name> <message>     - Send message to a teammate
  /team:status [<name>]           - Show team or teammate status
  /team:progress [<name>]         - Show harness progress
  /team:psyche [<name>]           - Show psyche weights
  /team:dashboard                 - Toggle team dashboard widget
  /team:task list                 - Show shared team tasks
  /team:task add <title>          - Add a shared task
  /team:task claim <id> <name>    - Assign/claim task for teammate
  /team:task done <id>            - Mark task done
  /team:task block <id>           - Mark task blocked
  /team:mail <from> <to> <msg>    - Send teammate-to-teammate mailbox message
  /team:allow-path <name> <path>  - Grant teammate write access to a path prefix
  /team:stop <name>               - Stop teammate's current turn
  /team:terminate <name>          - Destroy a teammate
  /team:approve <request-id>      - Approve a permission request
  /team:mode <name> <mode>        - Switch teammate mode

Roles: researcher, reviewer, implementer, planner, verifier, generic
Modes: research, plan, execute, review

Examples:
  /team Implement login with tests
  /team:spawn implementer --name alice --harness
  /team:preset solo "Implement login feature"
  /team:send alice "Implement login feature"
  /team:task add Implement login tests
  /team:task claim T-1 alice
  /team:mail alice verifier "Please review T-1 when ready"
  /team:status alice
  /team:mode alice execute
  /team:terminate alice
`.trim();
}
