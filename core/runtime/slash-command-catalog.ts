/**
 * [WHO]: Provides buildSessionSlashCommands(), buildExtensionSlashCommands(), SessionSlashCommandDescriptor
 * [FROM]: Depends on ExtensionRunner, ResourceLoader, prompt templates, slash command metadata, i18n translator
 * [TO]: Consumed by AgentSession and extension core bindings when exposing command catalogs
 * [HERE]: core/runtime/slash-command-catalog.ts - shared slash command catalog assembly for runtime adapters
 */
import type { ResourceLoader } from "../platform/config/resource-loader.js";
import type { ExtensionRunner } from "../extensions-host/index.js";
import type { PromptTemplate } from "../prompt/prompt-templates.js";
import {
	BUILTIN_SLASH_COMMANDS,
	getLocalizedCommands,
	inferSlashCommandCategory,
	type SlashCommandInfo,
	type SlashCommandCategory,
	type SlashCommandLocation,
} from "../slash-commands.js";

export interface SessionSlashCommandDescriptor {
	name: string;
	description?: string;
	source: "builtin" | SlashCommandInfo["source"];
	category?: SlashCommandCategory;
}

type Translate = Parameters<typeof getLocalizedCommands>[0];

export interface SlashCommandCatalogSource {
	promptTemplates: ReadonlyArray<PromptTemplate>;
	resourceLoader: ResourceLoader;
	extensionRunner?: ExtensionRunner;
}

function normalizeLocation(source: string): SlashCommandLocation | undefined {
	if (source === "user" || source === "project" || source === "path") {
		return source;
	}
	return undefined;
}

function getReservedBuiltinNames(): Set<string> {
	return new Set(BUILTIN_SLASH_COMMANDS.map((command) => command.name));
}

function getExtensionCommands(
	runner: ExtensionRunner | undefined,
	reservedBuiltins: Set<string>,
): Array<{ name: string; description?: string; path?: string; category: SlashCommandCategory }> {
	return (
		runner
			?.getRegisteredCommandsWithPaths()
			.filter(({ command }) => !reservedBuiltins.has(command.name))
			.map(({ command, extensionPath }) => ({
				name: command.name,
				description: command.description,
				path: extensionPath,
				category: inferSlashCommandCategory(command.name, "extension"),
			})) ?? []
	);
}

export function buildSessionSlashCommands(
	source: SlashCommandCatalogSource,
	translate: Translate,
): SessionSlashCommandDescriptor[] {
	const builtins: SessionSlashCommandDescriptor[] = getLocalizedCommands(
		translate,
	).map((command) => ({
		name: command.name,
		description: command.description,
		source: "builtin",
		category: command.category,
	}));

	const reservedBuiltins = getReservedBuiltinNames();
	const extensionCommands: SessionSlashCommandDescriptor[] =
		getExtensionCommands(source.extensionRunner, reservedBuiltins).map(
			(command) => ({
				name: command.name,
				description: command.description,
				source: "extension",
				category: command.category,
			}),
		);

	const promptCommands: SessionSlashCommandDescriptor[] =
		source.promptTemplates.map((template) => ({
			name: template.name,
			description: template.description,
			source: "prompt",
			category: inferSlashCommandCategory(template.name, "prompt"),
		}));

	const skillCommands: SessionSlashCommandDescriptor[] =
		source.resourceLoader.getSkills().skills.map((skill) => ({
			name: `skill:${skill.name}`,
			description: skill.description,
			source: "skill",
			category: inferSlashCommandCategory(skill.name, "skill"),
		}));

	return [
		...builtins,
		...extensionCommands,
		...promptCommands,
		...skillCommands,
	];
}

export function buildExtensionSlashCommands(
	source: SlashCommandCatalogSource & { extensionRunner: ExtensionRunner },
): SlashCommandInfo[] {
	const reservedBuiltins = getReservedBuiltinNames();
	const extensionCommands: SlashCommandInfo[] = getExtensionCommands(
		source.extensionRunner,
		reservedBuiltins,
	).map((command) => ({
		name: command.name,
		description: command.description,
		source: "extension",
		category: command.category,
		path: command.path,
	}));

	const templates: SlashCommandInfo[] = source.promptTemplates.map(
		(template) => ({
			name: template.name,
			description: template.description,
			source: "prompt",
			category: inferSlashCommandCategory(template.name, "prompt"),
			location: normalizeLocation(template.source),
			path: template.filePath,
		}),
	);

	const skills: SlashCommandInfo[] = source.resourceLoader
		.getSkills()
		.skills.map((skill) => ({
			name: `skill:${skill.name}`,
			description: skill.description,
			source: "skill",
			category: inferSlashCommandCategory(skill.name, "skill"),
			location: normalizeLocation(skill.source),
			path: skill.filePath,
		}));

	return [...extensionCommands, ...templates, ...skills];
}
