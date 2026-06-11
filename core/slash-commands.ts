/**
 * [WHO]: SlashCommandInfo, BuiltinSlashCommand, slashCommand definitions, category helpers, getLocalizedCommands()
 * [FROM]: No external dependencies
 * [TO]: Consumed by modes/interactive/interactive-mode.ts, modes/acp/acp-mode.ts
 * [HERE]: core/slash-commands.ts - slash command types and registry
 */
export type SlashCommandSource = "extension" | "prompt" | "skill";

export type SlashCommandLocation = "user" | "project" | "path";

export type SlashCommandCategory = "core" | "model" | "memory" | "session" | "workflow" | "agents" | "tools" | "admin";

export type SlashCommandImplementation = "core" | "extension";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	category?: SlashCommandCategory;
	location?: SlashCommandLocation;
	path?: string;
}

export interface BuiltinSlashCommand {
	name: string;
	descriptionKey: string; // i18n key instead of hardcoded string
	category: SlashCommandCategory;
	implementation?: SlashCommandImplementation;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", descriptionKey: "slash.settings", category: "core" },
	{ name: "model", descriptionKey: "slash.model", category: "model" },
	{ name: "thinking", descriptionKey: "slash.thinking", category: "model" },
	{ name: "agent-loop", descriptionKey: "slash.agent-loop", category: "model" },
	{ name: "scoped-models", descriptionKey: "slash.scoped-models", category: "model" },
	{ name: "apikey", descriptionKey: "slash.apikey", category: "model" },
	{ name: "mcp", descriptionKey: "slash.mcp", category: "tools" },
	{ name: "soul", descriptionKey: "slash.soul", category: "memory" },
	{ name: "persona", descriptionKey: "slash.persona", category: "core" },
	{ name: "memory", descriptionKey: "slash.memory", category: "memory" },
	{ name: "dream", descriptionKey: "slash.dream", category: "memory", implementation: "extension" },
	{ name: "browser", descriptionKey: "slash.browser", category: "tools", implementation: "extension" },
	{ name: "export", descriptionKey: "slash.export", category: "tools" },
	{ name: "share", descriptionKey: "slash.share", category: "tools" },
	{ name: "copy", descriptionKey: "slash.copy", category: "core" },
	{ name: "name", descriptionKey: "slash.name", category: "session" },
	{ name: "session", descriptionKey: "slash.session", category: "session" },
	{ name: "status", descriptionKey: "slash.status", category: "core" },
	{ name: "usage", descriptionKey: "slash.usage", category: "core" },
	{ name: "changelog", descriptionKey: "slash.changelog", category: "core" },
	{ name: "hotkeys", descriptionKey: "slash.hotkeys", category: "core" },
	{ name: "resources", descriptionKey: "slash.resources", category: "core" },
	{ name: "fork", descriptionKey: "slash.fork", category: "session" },
	{ name: "tree", descriptionKey: "slash.tree", category: "session" },
	{ name: "login", descriptionKey: "slash.login", category: "model" },
	{ name: "logout", descriptionKey: "slash.logout", category: "model" },
	{ name: "new", descriptionKey: "slash.new", category: "session" },
	{ name: "update", descriptionKey: "slash.update", category: "admin" },
	{ name: "reinstall", descriptionKey: "slash.reinstall", category: "admin" },
	{ name: "compact", descriptionKey: "slash.compact", category: "session" },
	{ name: "resume", descriptionKey: "slash.resume", category: "session" },
	{ name: "reload", descriptionKey: "slash.reload", category: "admin" },
	{ name: "link-world", descriptionKey: "slash.link-world", category: "tools", implementation: "extension" },
	{ name: "language", descriptionKey: "slash.language", category: "core" },
	{ name: "quit", descriptionKey: "slash.quit", category: "core" },
];

export function getExtensionBackedBuiltinCommandNames(): Set<string> {
	return new Set(
		BUILTIN_SLASH_COMMANDS.filter((command) => command.implementation === "extension").map(
			(command) => command.name,
		),
	);
}

export function inferSlashCommandCategory(name: string, source?: SlashCommandSource): SlashCommandCategory {
	if (source === "prompt") return "workflow";
	if (source === "skill") return "tools";
	if (name === "dream" || name === "memory" || name.startsWith("mem-")) return "memory";
	if (name === "team" || name.startsWith("team:") || name === "subagent" || name.startsWith("subagent:")) return "agents";
	if (
		name === "grub" ||
		name === "loop" ||
		name === "plan" ||
		name.startsWith("plan:") ||
		name === "recap" ||
		name === "btw" ||
		name === "simplify"
	) {
		return "workflow";
	}
	if (name === "browser" || name === "figma" || name === "link-world" || name === "export") return "tools";
	if (
		name === "debug" ||
		name === "set-locale" ||
		name === "report-issue" ||
		name === "tokensave" ||
		name === "security" ||
		name.startsWith("security-") ||
		name.startsWith("sal:")
	) {
		return "admin";
	}
	return "tools";
}

export function getSlashCommandCategoryLabel(
	category: SlashCommandCategory,
	t: (key: string) => string,
): string {
	return t(`slash.categories.${category}`);
}

export function formatSlashCommandDescription(
	description: string | undefined,
	category: SlashCommandCategory | undefined,
	t: (key: string) => string,
): string | undefined {
	if (!description || !category) return description;
	const label = getSlashCommandCategoryLabel(category, t);
	return label && !label.startsWith("slash.") ? `${label} · ${description}` : description;
}

// Helper to get localized command descriptions
export interface LocalizedSlashCommand {
	name: string;
	description: string;
	category: SlashCommandCategory;
	categoryLabel: string;
}

export function getLocalizedCommands(
	t: (key: string) => string,
): LocalizedSlashCommand[] {
	return BUILTIN_SLASH_COMMANDS.map((cmd) => ({
		name: cmd.name,
		description: t(cmd.descriptionKey),
		category: cmd.category,
		categoryLabel: getSlashCommandCategoryLabel(cmd.category, t),
	}));
}
