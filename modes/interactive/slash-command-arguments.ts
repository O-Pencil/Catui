/**
 * [WHO]: getAgentLoopArgumentCompletions(), getThinkingArgumentCompletions(), getMcpArgumentCompletions(), getLanguageArgumentCompletions(), getPersonaArgumentCompletions(), getLoginArgumentCompletions()
 * [FROM]: Depends on @pencil-agent/agent-core, @pencil-agent/tui, core/i18n, core/mcp/mcp-client
 * [TO]: Consumed by modes/interactive/interactive-mode.ts
 * [HERE]: modes/interactive/slash-command-arguments.ts - pure argument completion helpers for built-in TUI slash commands
 */

import type { AgentLoopFramework, ThinkingLevel } from "@pencil-agent/agent-core";
import type { ArgumentCompletionContext, AutocompleteItem } from "@pencil-agent/tui";
import { AVAILABLE_LOCALES, LOCALE_NAMES, type Locale } from "../../core/i18n/index.js";
import type { MCPServerConfig } from "../../core/mcp/mcp-client.js";

const THINKING_COMPLETIONS: Record<ThinkingLevel, string> = {
	off: "Skip extra reasoning",
	minimal: "Very small reasoning budget",
	low: "Light reasoning for simple tasks",
	medium: "Balanced reasoning for everyday coding",
	high: "Deeper reasoning for complex work",
	xhigh: "Maximum reasoning when the model supports it",
};

const AGENT_LOOP_COMPLETIONS: ReadonlyArray<AutocompleteItem & { value: AgentLoopFramework }> = [
	{
		value: "standard",
		label: "standard",
		description: "Use the normal agent loop",
	},
	{
		value: "weak-model-compatible",
		label: "weak-model-compatible",
		description: "Keep working with simpler models",
	},
];

const MCP_ACTION_COMPLETIONS = [
	{ value: "list", label: "list", description: "Show configured MCP servers" },
	{ value: "status", label: "status", description: "Show loaded MCP tools and runtime status" },
	{ value: "tools", label: "tools", description: "Show loaded MCP tools and runtime status" },
	{ value: "enable", label: "enable", description: "Turn on an MCP server" },
	{ value: "disable", label: "disable", description: "Turn off an MCP server" },
] as const;
const PERSONA_ACTION_COMPLETIONS = [
	{ value: "list", label: "list", description: "Show available personas" },
	{ value: "use", label: "use", description: "Switch to a persona" },
] as const;

type McpCompletionServer = Pick<MCPServerConfig, "id" | "name" | "enabled">;
type LoginCompletionProvider = {
	id: string;
	name: string;
	authType: "oauth" | "api_key";
};

function matchCompletions(items: readonly AutocompleteItem[], prefix: string): AutocompleteItem[] | null {
	const lowerPrefix = prefix.trim().toLowerCase();
	const matches = items.filter((item) => item.value.toLowerCase().startsWith(lowerPrefix));
	return matches.length > 0 ? matches.map((item) => ({ ...item })) : null;
}

function isFirstToken(context?: Pick<ArgumentCompletionContext, "tokenIndex">): boolean {
	return !context || context.tokenIndex === 0;
}

export function getThinkingArgumentCompletions(
	argumentPrefix: string,
	context: Pick<ArgumentCompletionContext, "tokenIndex"> | undefined,
	levels: readonly ThinkingLevel[],
): AutocompleteItem[] | null {
	if (!isFirstToken(context)) return null;
	return matchCompletions(
		levels.map((level) => ({
			value: level,
			label: level,
			description: THINKING_COMPLETIONS[level],
		})),
		argumentPrefix,
	);
}

export function getAgentLoopArgumentCompletions(
	argumentPrefix: string,
	context?: Pick<ArgumentCompletionContext, "tokenIndex">,
): AutocompleteItem[] | null {
	if (!isFirstToken(context)) return null;
	return matchCompletions(AGENT_LOOP_COMPLETIONS, argumentPrefix);
}

export function getMcpArgumentCompletions(
	argumentPrefix: string,
	context?: Pick<ArgumentCompletionContext, "tokenIndex" | "previousTokens">,
	servers: readonly McpCompletionServer[] = [],
): AutocompleteItem[] | null {
	if (isFirstToken(context)) return matchCompletions(MCP_ACTION_COMPLETIONS, argumentPrefix);
	if (context?.tokenIndex !== 1) return null;

	const action = context.previousTokens[0]?.toLowerCase();
	if (action !== "enable" && action !== "disable") return null;

	const targetEnabledState = action === "disable";
	return matchCompletions(
		servers
			.filter((server) => (server.enabled !== false) === targetEnabledState)
			.map((server) => ({
				value: server.id,
				label: server.id,
				description: `${server.name} (${server.enabled === false ? "disabled" : "enabled"})`,
			})),
		argumentPrefix,
	);
}

export function getLanguageArgumentCompletions(
	argumentPrefix: string,
	context?: Pick<ArgumentCompletionContext, "tokenIndex">,
): AutocompleteItem[] | null {
	if (!isFirstToken(context)) return null;
	return matchCompletions(
		AVAILABLE_LOCALES.map((locale: Locale) => ({
			value: locale,
			label: locale,
			description: LOCALE_NAMES[locale],
		})),
		argumentPrefix,
	);
}

export function getPersonaArgumentCompletions(
	argumentPrefix: string,
	context?: Pick<ArgumentCompletionContext, "tokenIndex" | "previousTokens">,
	personas: readonly string[] = [],
	activePersonaId?: string,
): AutocompleteItem[] | null {
	if (isFirstToken(context)) return matchCompletions(PERSONA_ACTION_COMPLETIONS, argumentPrefix);
	if (context?.tokenIndex !== 1 || context.previousTokens[0]?.toLowerCase() !== "use") return null;
	return matchCompletions(
		personas.map((personaId) => ({
			value: personaId,
			label: personaId,
			description: personaId === activePersonaId ? "Current persona" : `Switch to ${personaId}`,
		})),
		argumentPrefix,
	);
}

export function getLoginArgumentCompletions(
	argumentPrefix: string,
	context?: Pick<ArgumentCompletionContext, "tokenIndex">,
	providers: readonly LoginCompletionProvider[] = [],
): AutocompleteItem[] | null {
	if (!isFirstToken(context)) return null;
	return matchCompletions(
		providers.map((provider) => ({
			value: provider.id,
			label: provider.id,
			description: provider.authType === "oauth"
				? `Sign in with browser for ${provider.name}`
				: `Set API key for ${provider.name}`,
		})),
		argumentPrefix,
	);
}
