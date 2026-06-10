/**
 * Loop extension — registers /loop command, CronCreate/Delete/List tools,
 * and the unified cron scheduler.
 *
 * 1:1 port of Claude Code's cron/loop system:
 * - /loop skill (src/skills/bundled/loop.ts) → registered as /loop command
 * - CronCreate/Delete/List tools (src/tools/ScheduleCronTool/)
 * - Cron scheduler (src/utils/cronScheduler.ts)
 * - Cron task storage (src/utils/cronTasks.ts)
 * - Cron parser (src/utils/cron.ts)
 * - Scheduler lock (src/utils/cronTasksLock.ts)
 */

import { Box, Text } from "@pencil-agent/tui";
import type { ExtensionAPI } from "../../../core/extensions-host/types.js";
import type { Component } from "@pencil-agent/tui";
import { createCronScheduler } from "./cron/cron-scheduler.js";
import type { CronScheduler } from "./cron/cron-scheduler.js";
import { createCronCreateTool, createCronDeleteTool, createCronListTool } from "./cron-tools/index.js";
import { buildLoopPrompt, getLoopUsageMessage } from "./loop-skill.js";

const LOOP_CUSTOM_TYPE = "loop";

// Per-session state
const schedulerByBus = new WeakMap<object, CronScheduler>();
const apiByBus = new WeakMap<object, ExtensionAPI>();

function notify(api: ExtensionAPI, message: string, type: "info" | "warning" | "error" = "info"): void {
	api.sendMessage({
		customType: LOOP_CUSTOM_TYPE,
		content: message,
		display: true,
		details: { message, level: type, timestamp: Date.now() },
	});
}

// ============================================================================
// Extension entry point
// ============================================================================

export default async function loopExtension(api: ExtensionAPI) {
	const bus = api.events;
	apiByBus.set(bus, api);

	// =========================================================================
	// Register Cron tools (1:1 port of CC ScheduleCronTool)
	// =========================================================================
	api.registerTool(createCronCreateTool());
	api.registerTool(createCronDeleteTool());
	api.registerTool(createCronListTool());

	// =========================================================================
	// Message renderer for cron-triggered messages
	// =========================================================================
	api.registerMessageRenderer(LOOP_CUSTOM_TYPE, (message, _options, theme): Component => {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("\n");

		const level =
			typeof message.details === "object" && message.details !== null && "level" in message.details
				? ((message.details as { level?: string }).level ?? "info")
				: "info";
		const colorKey = level === "error" ? "error" : level === "warning" ? "warning" : "dim";

		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(theme.fg(colorKey, text), 0, 0));
		return box;
	});

	// =========================================================================
	// Create cron scheduler (1:1 port of CC cronScheduler.ts)
	// =========================================================================
	const scheduler = createCronScheduler({
		onFire: (prompt: string) => {
			// Fire: send the prompt as a follow-up user message
			// Matches CC's REPL behavior where onFire enqueues the prompt
			const currentApi = apiByBus.get(bus);
			if (currentApi) {
				currentApi.sendUserMessage(prompt, { deliverAs: "followUp" });
				notify(currentApi, `Fired scheduled task: ${prompt.slice(0, 80)}`, "info");
			}
		},
		isLoading: () => !api.isIdle(),
		dir: api.agentDir,
	});
	schedulerByBus.set(bus, scheduler);

	// =========================================================================
	// Session lifecycle
	// =========================================================================
	api.on("session_start", () => {
		scheduler.start();
	});

	api.on("session_shutdown", () => {
		scheduler.stop();
		schedulerByBus.delete(bus);
		apiByBus.delete(bus);
	});

	// =========================================================================
	// /loop command handler
	//
	// 1:1 port of CC's bundled loop skill:
	// - Empty args → show usage
	// - With args → build skill prompt and send as user message for model to process
	// The model will parse the interval, call CronCreate, confirm, and execute.
	// =========================================================================
	api.registerCommand("loop", {
		description:
			"Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo, defaults to 10m)",
		handler: async (args: string) => {
			const trimmed = args.trim();

			if (!trimmed) {
				notify(api, getLoopUsageMessage(), "warning");
				return;
			}

			// Build the skill prompt (1:1 port of CC skills/bundled/loop.ts)
			// This instructs the model to parse the interval, convert to cron,
			// call CronCreate, confirm, and execute the prompt immediately.
			const prompt = buildLoopPrompt(trimmed);
			api.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});
}
