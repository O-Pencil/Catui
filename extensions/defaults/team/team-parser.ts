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
	| "dashboard"
	| "progress"
	| "psyche"
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
			// If just a name, treat as list filter (or could be status)
			return { command: "list" };

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

/**
 * Build help text for /team commands.
 */
export function buildTeamHelp(): string {
	return `
Team Commands (AgentTeam + Harness):
  /team                           - List all teammates
  /team:spawn <role> [--name <n>] [--harness] - Create a persistent teammate
  /team:preset <solo|duo|squad> <task> - Create teammates from a preset
  /team:send <name> <message>     - Send message to a teammate
  /team:status [<name>]           - Show team or teammate status
  /team:progress [<name>]         - Show harness progress
  /team:psyche [<name>]           - Show psyche weights
  /team:dashboard                 - Toggle team dashboard widget
  /team:stop <name>               - Stop teammate's current turn
  /team:terminate <name>          - Destroy a teammate
  /team:approve <request-id>      - Approve a permission request
  /team:mode <name> <mode>        - Switch teammate mode

Roles: researcher, reviewer, implementer, planner, verifier, generic
Modes: research, plan, execute, review

Examples:
  /team:spawn implementer --name alice --harness
  /team:preset solo "Implement login feature"
  /team:send alice "Implement login feature"
  /team:status alice
  /team:mode alice execute
  /team:terminate alice
`.trim();
}
