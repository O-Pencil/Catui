/**
 * [WHO]: buildSessionOptions()
 * [FROM]: Depends on @catui/ai/models, chalk, cli/args, core/model-registry, core/model-resolver, core/tools, core/runtime/sdk, core/platform/config, core/agent-dir/agent-dir-context
 * [TO]: Consumed by main.ts (primary session + ACP per-workspace sessions)
 * [HERE]: cli/session-options.ts - maps parsed CLI flags + scoped models into CreateAgentSessionOptions
 */
import { modelsAreEqual } from "@catui/ai/models";
import chalk from "chalk";
import type { Args } from "./args.js";
import { DEFAULT_THINKING_LEVEL } from "../core/platform/config/defaults.js";
import type { ModelRegistry } from "../core/model-registry.js";
import { resolveCliModel, type ScopedModel } from "../core/model-resolver.js";
import { allTools } from "../core/tools/index.js";
import type { CreateAgentSessionOptions } from "../core/runtime/sdk.js";
import type { SessionManager } from "../core/session/session-manager.js";
import type { SettingsManager } from "../core/platform/config/settings-manager.js";
import type { AgentDirContext } from "../core/agent-dir/agent-dir-context.js";

export function buildSessionOptions(
	parsed: Args,
	scopedModels: ScopedModel[],
	sessionManager: SessionManager | undefined,
	modelRegistry: ModelRegistry,
	settingsManager: SettingsManager,
	ctx: AgentDirContext,
): { options: CreateAgentSessionOptions; cliThinkingFromModel: boolean } {
	const options: CreateAgentSessionOptions = {
		agentDir: ctx.path,
		agentCtx: ctx,
	};
	let cliThinkingFromModel = false;

	if (sessionManager) {
		options.sessionManager = sessionManager;
	}

	// Model from CLI
	// - supports --provider <name> --model <pattern>
	// - supports --model <provider>/<pattern>
	if (parsed.model) {
		const resolved = resolveCliModel({
			cliProvider: parsed.provider,
			cliModel: parsed.model,
			modelRegistry,
		});
		if (resolved.warning) {
			console.warn(chalk.yellow(`Warning: ${resolved.warning}`));
		}
		if (resolved.error) {
			console.error(chalk.red(resolved.error));
			process.exit(1);
		}
		if (resolved.model) {
			options.model = resolved.model;
			// Allow "--model <pattern>:<thinking>" as a shorthand.
			// Explicit --thinking still takes precedence (applied later).
			if (!parsed.thinking && resolved.thinkingLevel) {
				options.thinkingLevel = resolved.thinkingLevel;
				cliThinkingFromModel = true;
			}
		}
	}

	if (!options.model && scopedModels.length > 0 && !parsed.continue && !parsed.resume) {
		// Check if saved default is in scoped models - use it if so, otherwise first scoped model
		const savedProvider = settingsManager.getDefaultProvider();
		const savedModelId = settingsManager.getDefaultModel();
		const savedModel = savedProvider && savedModelId ? modelRegistry.find(savedProvider, savedModelId) : undefined;
		const savedInScope = savedModel ? scopedModels.find((sm) => modelsAreEqual(sm.model, savedModel)) : undefined;

		if (savedInScope) {
			options.model = savedInScope.model;
			// Use thinking level from scoped model config if explicitly set
			if (!parsed.thinking && savedInScope.thinkingLevel) {
				options.thinkingLevel = savedInScope.thinkingLevel;
			}
		} else {
			options.model = scopedModels[0].model;
			// Use thinking level from first scoped model if explicitly set
			if (!parsed.thinking && scopedModels[0].thinkingLevel) {
				options.thinkingLevel = scopedModels[0].thinkingLevel;
			}
		}
	}

	// Thinking level from CLI (takes precedence over scoped model thinking levels set above)
	if (parsed.thinking) {
		options.thinkingLevel = parsed.thinking;
	}

	if (parsed.agentLoopFramework) {
		options.agentLoopFramework = parsed.agentLoopFramework;
	}
	if (parsed.loopPolicy) {
		options.loopPolicy = parsed.loopPolicy;
	}

	// Scoped models for Ctrl+P cycling - fill in default thinking level for models without explicit level
	if (scopedModels.length > 0) {
		const defaultThinkingLevel = settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
		options.scopedModels = scopedModels.map((sm) => ({
			model: sm.model,
			thinkingLevel: sm.thinkingLevel ?? defaultThinkingLevel,
		}));
	}

	// Tools
	if (parsed.noTools) {
		// --no-tools: start with no built-in tools
		// --tools can still add specific ones back
		if (parsed.tools && parsed.tools.length > 0) {
			options.tools = parsed.tools.map((name) => allTools[name]);
		} else {
			options.tools = [];
		}
	} else if (parsed.tools) {
		options.tools = parsed.tools.map((name) => allTools[name]);
	}

	// Soul (AI personality evolution) - enabled by default, disable with --disable-soul
	options.enableSoul = parsed.disableSoul !== true;

	return { options, cliThinkingFromModel };
}
