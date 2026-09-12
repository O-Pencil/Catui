/**
 * [WHO]: grubExtension default export - registers /grub command, completions, dual-phase prompts, resume support, feature-list validation, and grub renderer
 * [FROM]: Depends on @catui/agent-core, @catui/tui, core/extensions-host/types, core/runtime/event-bus, ./grub-controller, ./grub-format, ./grub-parser, ./grub-types, ./grub-harness, ./grub-prompts, ./grub-persistence, ./grub-turn
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/builtin/grub/index.ts - durable task lifecycle; GrubDispatch owns exact iteration prompts, abort and exclusive continuation
 */

import type { AgentMessage } from "@catui/agent-core";
import { Box, Container, Spacer, Text } from "@catui/tui";
import type { ExtensionAPI, ExtensionCommandContext } from "../../../core/extensions-host/types.js";
import { getLocale, type Locale } from "../../../core/platform/i18n/index.js";
import type { EventBus } from "../../../core/runtime/event-bus.js";
import { GrubController } from "./grub-controller.js";
import { GrubDispatch } from "./grub-dispatch.js";
import {
	describeTaskState,
	formatSnapshot,
	formatTaskState,
} from "./grub-format.js";
import { ensureHarnessArtifacts } from "./grub-harness.js";
import { detectGrubLocale, grubText, languageName, type GrubLocale } from "./grub-i18n.js";
import { buildGrubHelp, getGrubArgumentCompletions, parseGrubCommand } from "./grub-parser.js";
import { discoverActiveTasks, pruneStale } from "./grub-persistence.js";
import { buildGrubCodingPrompt, buildGrubInitializerPrompt } from "./grub-prompts.js";
import { resolveGrubTurn } from "./grub-turn.js";
import type { GrubTaskState } from "./grub-types.js";

const GRUB_CUSTOM_TYPE = "grub";
let currentGrubLocale: GrubLocale = "en";

const controllersByBus = new WeakMap<EventBus, GrubController>();
const notifyByBus = new WeakMap<EventBus, (msg: string, type?: "info" | "warning" | "error") => void>();

function getController(bus: EventBus): GrubController {
	let controller = controllersByBus.get(bus);
	if (!controller) {
		controller = new GrubController();
		controllersByBus.set(bus, controller);
	}
	return controller;
}

function notify(bus: EventBus, message: string, type: "info" | "warning" | "error" = "info"): void {
	notifyByBus.get(bus)?.(message, type);
}

function getActiveLocale(): GrubLocale {
	return currentGrubLocale;
}

function localeFromSettings(ctx: Pick<ExtensionCommandContext, "getSettings">): GrubLocale {
	const locale = ctx.getSettings().locale;
	return locale === "zh" || locale === "en" ? locale : getLocale();
}

function localeForTask(task: GrubTaskState | undefined): GrubLocale {
	return task?.locale ?? getActiveLocale();
}

function publishGrubUpdate(
	api: ExtensionAPI,
	bus: EventBus,
	message: string,
	type: "info" | "warning" | "error" = "info",
): void {
	api.appendEntry(GRUB_CUSTOM_TYPE, { message, timestamp: Date.now() });
	notify(bus, message, type);
	api.sendMessage({
		customType: GRUB_CUSTOM_TYPE,
		content: message,
		display: true,
		details: { message, level: type, timestamp: Date.now() },
	});
}

function extractAssistantText(message: AgentMessage | undefined): string {
	if (!message || (message as { role?: string }).role !== "assistant") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" &&
				part !== null &&
				"type" in part &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
}

function extractUserText(message: AgentMessage | undefined): string {
	if (!message || (message as { role?: string }).role !== "user") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" &&
				part !== null &&
				"type" in part &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
}

function getLastAssistantMessage(messages: AgentMessage[]): AgentMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		if ((messages[i] as { role?: string }).role === "assistant") {
			return messages[i];
		}
	}
	return undefined;
}

function resumeSummary(task: GrubTaskState): string {
	const text = grubText(task.locale ?? "en");
	return [
		text.resumeSummary(task.id, task.currentIteration, describeTaskState(task.status, task.phase, task.awaitingTurn, task.locale)),
		`${text.goal}: ${task.goal}`,
		text.resumeHint,
	].join("\n");
}

export default async function grubExtension(api: ExtensionAPI) {
	const bus = api.events;
	const controller = getController(bus);
	const dispatch = new GrubDispatch(api, controller, () => {
		const task = controller.getActiveTask()!;
		publishGrubUpdate(api, bus, grubText(task.locale).startingIteration(task.currentIteration, task.id), "info");
	});

	// Opportunistic cleanup of long-abandoned harnesses (best effort).
	try {
		pruneStale(api.cwd);
	} catch {
		// ignore
	}

	api.registerMessageRenderer(GRUB_CUSTOM_TYPE, (message, _options, theme) => {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("\n");

		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(theme.fg("dim", text), 0, 0));

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	});

	api.on("session_start", () => {
		if (controller.hasActiveTask()) return;
		const active = discoverActiveTasks(api.cwd);
		if (active.length === 0) return;
		const persisted = active[0];
		try {
			controller.adoptResumedTask(persisted.task);
			currentGrubLocale = persisted.task.locale ?? getLocale();
			publishGrubUpdate(api, bus, resumeSummary(persisted.task), "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			publishGrubUpdate(api, bus, grubText(persisted.task.locale ?? getLocale()).failedResume(persisted.task.id, message), "warning");
		}
	});

	api.on("session_shutdown", () => {
		dispatch.cancel();
		// Persist is already called on every state transition; we only need to
		// unbind the in-memory bindings so a future session starts fresh.
		controllersByBus.delete(bus);
		notifyByBus.delete(bus);
	});

	api.on("before_agent_start", (event) => {
		if (!dispatch.accepts(event.prompt)) return;
		dispatch.begin(event.prompt);
		const task = controller.getActiveTask();
		const phase = task?.phase ?? "execution";
		const locale = localeForTask(task);
		return {
			appendSystemPrompt: phase === "initializer" ? buildGrubInitializerPrompt(locale) : buildGrubCodingPrompt(locale),
		};
	});

	api.on("input", (event) => {
		if (event.source !== "extension" || !event.text.startsWith("[GRUB:")) return;
		if (!dispatch.accepts(event.text)) return { action: "handled" };
		return { action: "continue" };
	});

	api.on("context", (event) => {
		const lastMessage = event.messages[event.messages.length - 1];
		const lastUserText = extractUserText(lastMessage);
		if (!lastUserText.startsWith("[GRUB:")) return;
		if (controller.isGrubPrompt(lastUserText)) return;
		return { messages: event.messages.slice(0, -1) };
	});

	api.on("agent_result", (event) => {
		// Only fold into the running grub task. Stale events after the task has
		// already terminated would otherwise pollute the next run.
		const taskId = dispatch.takeResultTask();
		if (!taskId) return;
		controller.accumulateRunResult({
			turnCount: event.turnCount,
			toolCallCount: event.toolCallCount,
			durationMs: event.durationMs,
			usage: event.usage,
		}, taskId);
		if (event.stopReason === "aborted") {
			const hadActiveTask = controller.hasActiveTask();
			const locale = controller.getActiveTask()?.locale ?? currentGrubLocale;
			if (hadActiveTask) {
				dispatch.pause("Paused after cancellation. Use /grub resume to continue.");
				publishGrubUpdate(api, bus, grubText(locale).protocolExit, "info");
			}
		}
	});

	api.on("agent_abort", () => {
		const hadActiveTask = controller.hasActiveTask();
		const locale = controller.getActiveTask()?.locale ?? currentGrubLocale;
		if (hadActiveTask) {
			dispatch.pause("Paused by user. Use /grub resume to continue.");
			publishGrubUpdate(api, bus, grubText(locale).protocolExit, "info");
		}
	});
	api.on("agent_end", (event, ctx) => {
		if (!dispatch.end()) { dispatch.flush(ctx.hasPendingMessages()); return; }
		const activeTask = controller.getActiveTask();
		if (!activeTask?.awaitingTurn) return;
		currentGrubLocale = activeTask.locale;

		const assistantText = extractAssistantText(getLastAssistantMessage(event.messages));
		const turn = resolveGrubTurn(controller, assistantText);
		for (const update of turn.events) {
			publishGrubUpdate(api, bus, update.message, update.level);
		}
		if (turn.dispatchNext) dispatch.request(ctx.hasPendingMessages());
		else dispatch.cancel();
	});

	const handleGrubCommand = async (args: string, ctx: ExtensionCommandContext) => {
		if (ctx.ui.notify) {
			notifyByBus.set(bus, ctx.ui.notify.bind(ctx.ui));
		}

		const parsed = parseGrubCommand(args);
		const settingsLocale = localeFromSettings(ctx);
		if (parsed.type === "help") {
			const text = grubText(settingsLocale);
			const reason = parsed.reason === "empty" ? text.missingGoal : undefined;
			publishGrubUpdate(api, bus, buildGrubHelp(reason, settingsLocale), "warning");
			return;
		}

		if (parsed.type === "status") {
			const state = controller.getState();
			if (parsed.json) {
				publishGrubUpdate(api, bus, JSON.stringify(state, null, 2), "info");
				return;
			}
			const message = state.active
				? formatTaskState(state.active)
				: state.lastTerminal
					? formatSnapshot(state.lastTerminal)
					: `${grubText(settingsLocale).prefix} ${grubText(settingsLocale).noStarted}`;
			publishGrubUpdate(api, bus, message, "info");
			return;
		}

		if (parsed.type === "stop") {
			const activeTask = controller.getActiveTask();
			const locale = localeForTask(activeTask);
			const text = grubText(locale);
			if (!activeTask) {
				publishGrubUpdate(api, bus, `${text.prefix} ${text.noActiveRunning}`, "warning");
				return;
			}

			const ownsRun = dispatch.ownsRun;
			controller.stop(locale === "zh" ? "用户请求停止。" : "Stopped by user request.", "stopped");
			dispatch.cancel();
			if (ownsRun && !ctx.isIdle()) {
				ctx.abort();
			}
			publishGrubUpdate(api, bus, `${text.stopped(activeTask.id)}\n${text.protocolExit}`, "info");
			return;
		}

		if (parsed.type === "resume") {
			let activeTask = controller.getActiveTask();
			if (activeTask?.awaitingTurn) return;
			let locale = localeForTask(activeTask);
			if (!activeTask) {
				const persisted = discoverActiveTasks(ctx.cwd, true);
				if (persisted.length === 0) {
					publishGrubUpdate(api, bus, `${grubText(settingsLocale).prefix} ${grubText(settingsLocale).noPersisted}`, "warning");
					return;
				}
				try {
					activeTask = controller.adoptResumedTask(persisted[0].task, true);
					locale = activeTask.locale ?? settingsLocale;
					currentGrubLocale = locale;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					publishGrubUpdate(api, bus, grubText(settingsLocale).failedAdopt(message), "error");
					return;
				}
			}
			ensureHarnessArtifacts(activeTask);
			publishGrubUpdate(api, bus, grubText(locale).resuming(activeTask.id), "info");
			dispatch.claim();
			dispatch.request(ctx.hasPendingMessages());
			return;
		}

		try {
			const locale = detectGrubLocale(parsed.goal, settingsLocale);
			currentGrubLocale = locale;
			const task = controller.start(parsed.goal, ctx.cwd, {
				maxIterations: parsed.maxIterations,
				maxConsecutiveFailures: parsed.maxConsecutiveFailures,
				locale,
			});
			ensureHarnessArtifacts(task);
			const text = grubText(locale);
			publishGrubUpdate(
				api,
				bus,
				[
					text.startedTask(task.id),
					`${text.goal}: ${task.goal}`,
					`${text.savedIn}: ${task.harnessDirectory}`,
					text.initPhase,
					text.safetyLimits(task.maxIterations, task.maxConsecutiveFailures),
					`Language: ${languageName(locale)}`,
				].join("\n"),
				"info",
			);
			dispatch.claim();
			dispatch.request(ctx.hasPendingMessages());
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			publishGrubUpdate(api, bus, `${grubText(settingsLocale).prefix} ${message}`, "error");
		}
	};

	api.registerCommand("grub", {
		description: "Keep working on one task until it is done, stopped, or needs your help.",
		getArgumentCompletions: getGrubArgumentCompletions,
		handler: handleGrubCommand,
	});
}
