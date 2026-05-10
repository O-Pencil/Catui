/**
 * [WHO]: SlashCommandInfo, BuiltinSlashCommand, slashCommand definitions, getLocalizedCommands()
 * [FROM]: No external dependencies
 * [TO]: Consumed by modes/interactive/interactive-mode.ts, modes/acp/acp-mode.ts
 * [HERE]: core/slash-commands.ts - slash command types and registry
 */
export type SlashCommandSource = "extension" | "prompt" | "skill";

export type SlashCommandLocation = "user" | "project" | "path";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	location?: SlashCommandLocation;
	path?: string;
}

export interface BuiltinSlashCommand {
	name: string;
	descriptionKey: string; // i18n key instead of hardcoded string
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", descriptionKey: "slash.settings" },
	{ name: "model", descriptionKey: "slash.model" },
	{ name: "agent-loop", descriptionKey: "slash.agent-loop" },
	{ name: "scoped-models", descriptionKey: "slash.scoped-models" },
	{ name: "apikey", descriptionKey: "slash.apikey" },
	{ name: "mcp", descriptionKey: "slash.mcp" },
	{ name: "soul", descriptionKey: "slash.soul" },
	{ name: "persona", descriptionKey: "slash.persona" },
	{ name: "memory", descriptionKey: "slash.memory" },
	{ name: "dream", descriptionKey: "slash.dream" },
	{ name: "export", descriptionKey: "slash.export" },
	{ name: "share", descriptionKey: "slash.share" },
	{ name: "copy", descriptionKey: "slash.copy" },
	{ name: "name", descriptionKey: "slash.name" },
	{ name: "session", descriptionKey: "slash.session" },
	{ name: "status", descriptionKey: "slash.status" },
	{ name: "usage", descriptionKey: "slash.usage" },
	{ name: "changelog", descriptionKey: "slash.changelog" },
	{ name: "hotkeys", descriptionKey: "slash.hotkeys" },
	{ name: "fork", descriptionKey: "slash.fork" },
	{ name: "tree", descriptionKey: "slash.tree" },
	{ name: "login", descriptionKey: "slash.login" },
	{ name: "logout", descriptionKey: "slash.logout" },
	{ name: "new", descriptionKey: "slash.new" },
	{ name: "update", descriptionKey: "slash.update" },
		{ name: "reinstall", descriptionKey: "slash.reinstall" },
	{ name: "compact", descriptionKey: "slash.compact" },
	{ name: "resume", descriptionKey: "slash.resume" },
	{ name: "reload", descriptionKey: "slash.reload" },
	{ name: "link-world", descriptionKey: "slash.link-world" },
	{ name: "language", descriptionKey: "slash.language" },
	{ name: "quit", descriptionKey: "slash.quit" },
];

// Helper to get localized command descriptions
export interface LocalizedSlashCommand {
	name: string;
	description: string;
}

export function getLocalizedCommands(
	t: (key: string) => string,
): LocalizedSlashCommand[] {
	return BUILTIN_SLASH_COMMANDS.map((cmd) => ({
		name: cmd.name,
		description: t(cmd.descriptionKey),
	}));
}
