/**
 * [WHO]: IdleThink extension interface — idle detection, background code exploration orchestration
 * [FROM]: Depends on core/extensions-host/types, ./thinker (runExploration), ./insights (storeInsight, buildInsightInjection, loadRecentInsights, projectKeyFromCwd), ./curiosity (loadCuriosityQueue, saveCuriosityQueue, pickNextTopics, addTopicsFromInsight, extractTopicsFromInsight, markExplored)
 * [TO]: Loaded by builtin-extensions.ts as default extension
 * [HERE]: extensions/builtin/idle-think/index.ts - background code archaeology during idle time
 *
 * When the user is idle for 10+ minutes, spawns a read-only SubAgent to explore the current
 * project and discover non-obvious patterns, architecture decisions, and knowledge worth
 * remembering. Insights are persisted to nanomem and injected into subsequent conversations.
 *
 * Default: OFF. Enable via settings.idleThink.enabled = true.
 * When enabled, the agent thinks when idle — exploring code and building knowledge.
 */

import type { ExtensionAPI, ExtensionContext } from "../../../core/extensions-host/types.js";
import {
	cleanup,
	createState,
	getSettings,
	startIdleLoop,
	touch,
} from "./idle-think-runtime.js";
import { buildInsightInjection, projectKeyFromCwd } from "./insights.js";

// ── Extension entry ──────────────────────────────────────────────────────────

export default async function idleThinkExtension(api: ExtensionAPI): Promise<void> {
	const state = createState();

	// ── Session lifecycle ─────────────────────────────────────────────────

	api.on("session_start", (_event, ctx) => {
		// Only runs in TUI mode
		if (!ctx.hasUI) return;

		// Default: disabled. Enable via settings.idleThink.enabled = true
		const settings = getSettings(ctx);
		if (settings.enabled !== true) return;

		startIdleLoop(api, ctx, state);
	});

	api.on("session_shutdown", () => {
		cleanup(state);
	});

	// ── Activity tracking (reset idle timer) ──────────────────────────────

	api.on("input", () => touch(state));
	api.on("agent_start", () => touch(state));
	api.on("agent_end", () => touch(state));
	api.on("tool_execution_start", () => touch(state));
	api.on("tool_execution_end", () => touch(state));
	api.on("tool_call", () => touch(state));
	api.on("message_end", () => touch(state));

	// ── System prompt injection (reads from nanomem, persistent) ──────────

	api.on("before_agent_start", async (_event, ctx) => {
		const injection = await buildInsightInjection(projectKeyFromCwd(ctx.cwd));
		if (!injection) return undefined;
		return { appendSystemPrompt: injection };
	});
}
