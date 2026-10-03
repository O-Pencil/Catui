/**
 * [WHO]: Pure parser that turns the raw `/goal` slash-command args string into a ParsedGoalCommand (one of help/show/set/clear/edit/pause/resume) plus buildGoalHelp
 * [FROM]: Depends only on ./goal-types
 * [TO]: Consumed by ./goal-command (handler) and the index module (autocomplete)
 * [HERE]: extensions/builtin/goal/goal-parser.ts - argument parsing; no I/O, no UI
 */

import type { AutocompleteItem } from "@catui/tui";

export type ParsedGoalCommand =
	| { type: "help" }
	| { type: "show" }
	| { type: "clear" }
	| { type: "edit" }
	| { type: "pause" }
	| { type: "resume" }
	| { type: "set"; objective: string };

const SUBCOMMANDS = new Set(["show", "clear", "edit", "pause", "resume", "help"]);

export function parseGoalCommand(input: string): ParsedGoalCommand {
	const trimmed = input.trim();
	if (trimmed === "") return { type: "help" };
	const lower = trimmed.toLowerCase();
	if (SUBCOMMANDS.has(lower)) {
		switch (lower) {
			case "show":
				return { type: "show" };
			case "clear":
				return { type: "clear" };
			case "edit":
				return { type: "edit" };
			case "pause":
				return { type: "pause" };
			case "resume":
				return { type: "resume" };
			case "help":
				return { type: "help" };
		}
	}
	return { type: "set", objective: trimmed };
}

export const GOAL_USAGE_TEXT = [
	"Usage:",
	"  /goal                  Show current goal summary",
	"  /goal <objective>      Set or replace the goal",
	"  /goal clear            Clear the goal",
	"  /goal edit             Edit the current objective",
	"  /goal pause            Pause auto-continuation",
	"  /goal resume           Resume auto-continuation",
	"  /goal help             Show this help",
].join("\n");

export function buildGoalHelp(): string {
	return GOAL_USAGE_TEXT;
}

export function getGoalArgumentCompletions(argumentPrefix: string): AutocompleteItem[] {
	const prefix = argumentPrefix.trim().toLowerCase();
	const candidates = [
		{ value: "show", label: "show", description: "Show the goal and budget" },
		{ value: "clear", label: "clear", description: "Clear the goal" },
		{ value: "edit", label: "edit", description: "Edit the current objective" },
		{ value: "pause", label: "pause", description: "Pause auto-continuation" },
		{ value: "resume", label: "resume", description: "Resume auto-continuation" },
		{ value: "help", label: "help", description: "Show usage" },
	];
	if (prefix === "") return candidates;
	return candidates.filter((c) => c.value.startsWith(prefix));
}
