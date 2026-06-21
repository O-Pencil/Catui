/**
 * [WHO]: Provides NEXT_STEP_RULE constant and the next-step ExtensionFactory; default-on builtin extension that injects a Codex-style "suggest next steps" rule into the agent system prompt via before_agent_start.
 * [FROM]: Depends on core/extensions-host/types for ExtensionAPI; reads settings.nextStep.enabled via ExtensionContext.getSettings().
 * [TO]: Consumed by core/extensions-host/loader via getBuiltinExtensionPaths(); gate is settings.nextStep.enabled (default true).
 * [HERE]: extensions/builtin/next-step/index.ts - sits alongside presence/; injection position (relative to presence) is controlled by builtin-extensions.ts registration order, NOT by this file.
 */

import type { ExtensionAPI } from "../../../core/extensions-host/types.js";

/**
 * Rule text injected after the base system prompt when next-step is enabled.
 * Prompt-driven: the LLM itself decides whether natural next steps exist and
 * formats them as a numeric list. No post-processing string assembly — that
 * cannot know whether "a natural next step" actually exists.
 */
export const NEXT_STEP_RULE = `## Suggesting Next Steps

After completing a task, if there are natural next steps the user is likely
to want, suggest them at the end of your response. Do not make suggestions
if there are no natural next steps. When suggesting multiple options, use
a numeric list so the user can answer with one number.`;

export default function nextStepExtension(api: ExtensionAPI): void {
	api.on("before_agent_start", (_event, ctx) => {
		const settings = ctx.getSettings?.();
		const enabled = settings?.nextStep?.enabled ?? true;
		if (!enabled) return undefined;
		return { appendSystemPrompt: "\n\n" + NEXT_STEP_RULE + "\n" };
	});
}