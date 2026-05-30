/**
 * [WHO]: loopExtension - registers /loop command, cron tools (CronCreate/Delete/List), and unified scheduler
 * [FROM]: Depends on @pencil-agent/agent-core, @pencil-agent/tui, core/extensions-host/types, core/runtime/event-bus, ./cron, ./cron-tools, ./scheduler-parser
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/builtin/loop/index.ts - unified loop extension with single cron scheduler per refactoring plan
 */

import type { AgentMessage } from "@pencil-agent/agent-core";
import { Box, Container, Spacer, Text } from "@pencil-agent/tui";
import type { ArgumentCompletionContext, ExtensionAPI, ExtensionCommandContext } from "../../../core/extensions-host/types.js";
import type { EventBus } from "../../../core/runtime/event-bus.js";
import { createCronCreateTool, createCronDeleteTool, createCronListTool } from "./cron-tools/index.js";
import {
	createCronScheduler,
	addCronTask,
	deleteCronTask,
	listCronTasks,
	getCronTask,
	updateCronTask,
	intervalToCron,
	getSessionCronTasks,
	readCronTasks,
	clearSessionCronTasks,
} from "./cron/index.js";
import type { CronScheduler, CronTask } from "./cron/index.js";
import { buildSchedulerHelp, parseSchedulerCommand } from "./scheduler-parser.js";

const LOOP_CUSTOM_TYPE = "loop";
const SCHEDULER_TICK_MS = 1000;
const LOOP_ACTION_COMPLETIONS = [
	{ value: "list", label: "list", description: "Show scheduled tasks" },
	{ value: "status", label: "status", description: "Show scheduled tasks" },
	{ value: "pause", label: "pause", description: "Pause a scheduled task" },
	{ value: "resume", label: "resume", description: "Resume a paused task" },
	{ value: "run", label: "run", description: "Run a scheduled task now" },
	{ value: "cancel", label: "cancel", description: "Cancel a scheduled task" },
	{ value: "clear", label: "clear", description: "Remove session-only tasks" },
	{ value: "every", label: "every", description: "Schedule a repeated prompt or command" },
	{ value: "hourly", label: "hourly", description: "Run once per hour" },
	{ value: "daily", label: "daily", description: "Run once per day" },
] as const;
const LOOP_FLAG_COMPLETIONS = [
	{ value: "--name", label: "--name", description: "Give the schedule a name" },
	{ value: "--max", label: "--max", description: "Stop after a number of runs" },
	{ value: "--quiet", label: "--quiet", description: "Hide per-run messages" },
	{ value: "--durable", label: "--durable", description: "Keep the schedule across sessions" },
	{ value: "-q", label: "-q", description: "Hide per-run messages" },
	{ value: "-d", label: "-d", description: "Keep the schedule across sessions" },
] as const;
type LoopCompletion = { value: string; label: string; description: string };

function matchLoopCompletions(completions: readonly LoopCompletion[], prefix: string): LoopCompletion[] | null {
	const matches = completions.filter((completion) => completion.value.startsWith(prefix));
	return matches.length > 0 ? matches.map((completion) => ({ ...completion })) : null;
}

function getLoopArgumentCompletions(argumentPrefix: string, context?: ArgumentCompletionContext): LoopCompletion[] | null {
	const prefix = argumentPrefix.trim().toLowerCase();
	const isFirstToken = !context || context.tokenIndex === 0;
	if (!isFirstToken && !prefix.startsWith("-")) return null;

	const completions = prefix.startsWith("-")
		? LOOP_FLAG_COMPLETIONS
		: [...LOOP_ACTION_COMPLETIONS, ...LOOP_FLAG_COMPLETIONS];
	return matchLoopCompletions(completions, prefix);
}

// Single unified scheduler per session
const cronSchedulerByBus = new WeakMap<EventBus, CronScheduler>();
const apiByBus = new WeakMap<EventBus, ExtensionAPI>();
const notifyByBus = new WeakMap<EventBus, (msg: string, type?: "info" | "warning" | "error") => void>();
const schedulerTimerByBus = new WeakMap<EventBus, ReturnType<typeof setInterval>>();

function getCronScheduler(bus: EventBus): CronScheduler | undefined {
	return cronSchedulerByBus.get(bus);
}

function notify(bus: EventBus, message: string, type: "info" | "warning" | "error" = "info"): void {
	notifyByBus.get(bus)?.(message, type);
}

function publishLoopUpdate(
	api: ExtensionAPI,
	bus: EventBus,
	message: string,
	type: "info" | "warning" | "error" = "info",
	options: { quiet?: boolean } = {},
): void {
	api.appendEntry(LOOP_CUSTOM_TYPE, { message, level: type, timestamp: Date.now() });
	if (options.quiet && type === "info") return;
	notify(bus, message, type);
	api.sendMessage({
		customType: LOOP_CUSTOM_TYPE,
		content: message,
		display: true,
		details: { message, level: type, timestamp: Date.now() },
	});
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatRelative(ms: number): string {
	if (ms <= 0) return "now";
	const sec = Math.round(ms / 1000);
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	const remSec = sec % 60;
	if (min < 60) return remSec ? `${min}m ${remSec}s` : `${min}m`;
	const hr = Math.floor(min / 60);
	const remMin = min % 60;
	if (hr < 24) return remMin ? `${hr}h ${remMin}m` : `${hr}h`;
	const day = Math.floor(hr / 24);
	const remHr = hr % 24;
	return remHr ? `${day}d ${remHr}h` : `${day}d`;
}

function formatLoopDate(timestamp: number | undefined): string {
	return timestamp ? new Date(timestamp).toLocaleString() : "never";
}

function summarizeLoopInput(input: string, maxLength = 72): string {
	const trimmed = input.trim();
	return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3)}...`;
}

function refLabel(task: CronTask): string {
	return task.name ? `${task.name} (${task.id})` : task.id;
}

function formatScheduledTask(task: CronTask, nextRunAt?: number): string {
	const now = Date.now();
	const runAt = nextRunAt ?? task.createdAt;
	const status = task.paused ? "paused" : task.pending ? "pending" : runAt <= now ? "due" : "scheduled";
	const nextLabel = nextRunAt !== undefined ? formatRelative(nextRunAt - now) : "unknown";
	const lines = [
		`[Loop] ${refLabel(task)} — ${status}`,
		`Every: ${describeInterval(task.cron)}`,
		`Kind: ${task.prompt.startsWith("/") ? "command" : "prompt"}${task.quiet ? " (quiet)" : ""}`,
		`Next run: in ${nextLabel}`,
		`Last run: ${formatLoopDate(task.lastFiredAt)}`,
		`Run count: ${task.maxRuns ? task.runCount + "/" + task.maxRuns : task.runCount}`,
		`Input: ${task.prompt}`,
	];
	if (task.lastOutputSnippet) lines.push(`Last output: ${task.lastOutputSnippet}`);
	if (task.lastError) lines.push(`Last error: ${task.lastError}`);
	return lines.join("\n");
}

function formatScheduledList(tasks: CronTask[], nextFireTimes: Map<string, number>): string {
	if (tasks.length === 0) return "[Loop] No scheduled tasks are active.";
	const now = Date.now();
	return [
		`[Loop] ${tasks.length} scheduled task${tasks.length === 1 ? "" : "s"}:`,
		...tasks.map((task) => {
			const flags: string[] = [];
			if (task.paused) flags.push("paused");
			if (task.quiet) flags.push("quiet");
			if (task.maxRuns) flags.push(`max ${task.runCount}/${task.maxRuns}`);
			const flagStr = flags.length ? ` [${flags.join(", ")}]` : "";
			const nextFire = nextFireTimes.get(task.id);
			const next = task.paused ? "paused" : nextFire ? `next in ${formatRelative(nextFire - now)}` : "scheduled";
			return `- ${refLabel(task)}  every ${describeInterval(task.cron)}  ${next}${flagStr}  ${summarizeLoopInput(task.prompt)}`;
		}),
	].join("\n");
}

function describeInterval(cron: string): string {
	const match = cron.match(/^\*\/(\d+) \* \* \* \*$/);
	if (match) return `${match[1]}m`;
	const hourMatch = cron.match(/^0 \*\/(\d+) \* \* \*$/);
	if (hourMatch) return `${hourMatch[1]}h`;
	const dayMatch = cron.match(/^0 0 \*\/(\d+) \* \*$/);
	if (dayMatch) return `${dayMatch[1]}d`;
	return cron;
}

function extractAssistantText(message: AgentMessage | undefined): string {
	if (!message || (message as { role?: string }).role !== "assistant") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" && part !== null && "type" in part && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
}

function getLastAssistantMessage(messages: AgentMessage[]): AgentMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		if ((messages[i] as { role?: string }).role === "assistant") return messages[i];
	}
	return undefined;
}

// ============================================================================
// Task dispatch: triggered by cron scheduler onFire callback
// ============================================================================

async function dispatchTask(api: ExtensionAPI, bus: EventBus, task: CronTask): Promise<void> {
	const scheduler = getCronScheduler(bus);
	if (!scheduler) return;

	const label = refLabel(task);
	publishLoopUpdate(
		api,
		bus,
		`[Loop] Triggering ${label} (${describeInterval(task.cron)}): ${summarizeLoopInput(task.prompt)}`,
		"info",
		{ quiet: task.quiet },
	);

	// Mark as pending
	task.pending = true;
	if (task.durable) {
		await updateCronTask(api.agentDir, task);
	} else {
		const { updateSessionCronTask } = await import("./cron/index.js");
		updateSessionCronTask(task);
	}

	if (task.prompt.startsWith("/")) {
		// Slash command: execute directly
		const handled = await api.executeCommand(task.prompt.trim());
		if (!handled) {
			scheduler.markSettled(task.id, "Unknown slash command.");
			if (task.durable) await updateCronTask(api.agentDir, { ...task, pending: false, lastError: "Unknown slash command." });
			publishLoopUpdate(api, bus, `[Loop] Failed to run ${label}: unknown slash command.`, "error");
			return;
		}

		// Capture output snippet after execution
		if (api.isIdle()) {
			scheduler.markSettled(task.id);
			if (task.durable) await updateCronTask(api.agentDir, { ...task, pending: false });
			await maybeAutoCancel(api, bus, task.id);
		}
	} else {
		// Prompt: send as follow-up user message
		api.sendUserMessage(task.prompt, { deliverAs: "followUp" });
	}
}

async function maybeAutoCancel(api: ExtensionAPI, bus: EventBus, id: string): Promise<void> {
	const task = await getCronTask(api.agentDir, id);
	if (!task || task.maxRuns === undefined) return;
	if ((task.runCount ?? 0) < task.maxRuns) return;

	const deleted = await deleteCronTask(api.agentDir, id);
	if (!deleted) return;

	publishLoopUpdate(
		api,
		bus,
		`[Loop] ${refLabel(task)} hit its max runs (${task.maxRuns}); auto-cancelled.`,
		"info",
	);
}

// ============================================================================
// Extension entry point
// ============================================================================

export default async function loopExtension(api: ExtensionAPI) {
	const bus = api.events;
	apiByBus.set(bus, api);

	// =========================================================================
	// Register Cron tools (per refactoring plan)
	// =========================================================================
	api.registerTool(createCronCreateTool());
	api.registerTool(createCronDeleteTool());
	api.registerTool(createCronListTool());

	// =========================================================================
	// Message renderer
	// =========================================================================
	api.registerMessageRenderer(LOOP_CUSTOM_TYPE, (message, _options, theme) => {
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

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	});

	// =========================================================================
	// Create unified cron scheduler
	// =========================================================================
	const scheduler = createCronScheduler({
		onFire: (prompt: string, task: CronTask) => {
			const currentApi = apiByBus.get(bus);
			if (currentApi) {
				void dispatchTask(currentApi, bus, task);
			}
		},
		onSettle: async (id: string, error?: string, outputSnippet?: string) => {
			const task = await getCronTask(api.agentDir, id);
			if (!task) return;

			task.pending = false;
			if (error) task.lastError = error;
			if (outputSnippet) {
				task.lastOutputSnippet = outputSnippet.length > 120 ? `${outputSnippet.slice(0, 117)}...` : outputSnippet;
			}

			if (task.durable) {
				await updateCronTask(api.agentDir, task);
			} else {
				const { updateSessionCronTask } = await import("./cron/index.js");
				updateSessionCronTask(task);
			}

			await maybeAutoCancel(api, bus, id);
		},
		dir: api.agentDir,
			legacyCwd: api.cwd,
	});
	cronSchedulerByBus.set(bus, scheduler);

	// =========================================================================
	// Session lifecycle
	// =========================================================================
	api.on("session_start", async () => {
		scheduler.start();

		// Ticker for dispatching tasks when agent becomes idle
		const timer = setInterval(() => {
			// Cron scheduler handles timing; we just need to check for pending completions
		}, SCHEDULER_TICK_MS);
		schedulerTimerByBus.set(bus, timer);
	});

	api.on("agent_end", async (event) => {
		const scheduler = getCronScheduler(bus);
		if (!scheduler) return;

		// Check if there's a pending task that just completed
		const tasks = await listCronTasks(api.agentDir);
		const pendingTask = tasks.find((t) => t.pending);
		if (!pendingTask) return;

		const assistantText = extractAssistantText(getLastAssistantMessage(event.messages));
		const snippet = assistantText.replace(/\s+/g, " ").trim() || undefined;
		scheduler.markSettled(pendingTask.id, undefined, snippet);
	});

	api.on("session_shutdown", async () => {
		const timer = schedulerTimerByBus.get(bus);
		if (timer) clearInterval(timer);

		scheduler.stop();

		cronSchedulerByBus.delete(bus);
		schedulerTimerByBus.delete(bus);
		notifyByBus.delete(bus);
		apiByBus.delete(bus);
	});

	// =========================================================================
	// /loop command handler
	// Unified: creates tasks via addCronTask, uses cron scheduler for everything
	// =========================================================================
	const handleLoopCommand = async (args: string, ctx: ExtensionCommandContext) => {
		if (ctx.ui.notify) {
			notifyByBus.set(bus, ctx.ui.notify.bind(ctx.ui));
		}

		const parsed = parseSchedulerCommand(args);

		// Subcommands
		if (parsed.type === "help") {
			publishLoopUpdate(api, bus, buildSchedulerHelp(parsed.reason), "warning");
			return;
		}

		if (parsed.type === "list") {
			const tasks = await listCronTasks(api.agentDir);
			const scheduler = getCronScheduler(bus);
			const nextFireTimes = new Map<string, number>();
			// Approximate next fire times from tasks
			for (const task of tasks) {
				const { nextCronRunMs } = await import("./cron/index.js");
				const next = nextCronRunMs(task.cron, task.lastFiredAt ?? task.createdAt);
				if (next) nextFireTimes.set(task.id, next);
			}
			publishLoopUpdate(api, bus, formatScheduledList(tasks, nextFireTimes), "info");
			return;
		}

		if (parsed.type === "status") {
			const task = await resolveTask(api.agentDir, parsed.ref);
			if (!task) {
				publishLoopUpdate(api, bus, `[Loop] No scheduled task matches "${parsed.ref}".`, "warning");
				return;
			}
			const { nextCronRunMs } = await import("./cron/index.js");
			const nextRun = nextCronRunMs(task.cron, task.lastFiredAt ?? task.createdAt) ?? undefined;
			publishLoopUpdate(api, bus, formatScheduledTask(task, nextRun), "info");
			return;
		}

		if (parsed.type === "clear") {
			clearSessionCronTasks();
			if (api.agentDir) {
				await import("./cron/index.js").then(({ writeCronTasks }) => writeCronTasks(api.agentDir, []));
			}
			publishLoopUpdate(api, bus, "[Loop] Cleared all scheduled tasks.", "info");
			return;
		}

		if (parsed.type === "cancel") {
			const removed = await deleteCronTask(api.agentDir, parsed.ref);
			publishLoopUpdate(
				api,
				bus,
				removed ? `[Loop] Cancelled ${parsed.ref}.` : `[Loop] No scheduled task matches "${parsed.ref}".`,
				removed ? "info" : "warning",
			);
			return;
		}

		if (parsed.type === "pause") {
			const task = await resolveTask(api.agentDir, parsed.ref);
			if (!task) {
				publishLoopUpdate(api, bus, `[Loop] No scheduled task matches "${parsed.ref}".`, "warning");
				return;
			}
			task.paused = true;
			await updateCronTask(api.agentDir, task);
			publishLoopUpdate(api, bus, `[Loop] Paused ${refLabel(task)}.`, "info");
			return;
		}

		if (parsed.type === "resume") {
			const task = await resolveTask(api.agentDir, parsed.ref);
			if (!task) {
				publishLoopUpdate(api, bus, `[Loop] No scheduled task matches "${parsed.ref}".`, "warning");
				return;
			}
			task.paused = false;
			// Re-prime next run from now to avoid immediate fire
			const { nextCronRunMs } = await import("./cron/index.js");
			const next = nextCronRunMs(task.cron, Date.now());
			if (next) {
				const scheduler = getCronScheduler(bus);
				if (scheduler) scheduler.forceDue(task.id);
			}
			await updateCronTask(api.agentDir, task);
			const nextMs = nextCronRunMs(task.cron, Date.now());
			const nextLabel = nextMs ? formatRelative(nextMs - Date.now()) : "scheduled";
			publishLoopUpdate(api, bus, `[Loop] Resumed ${refLabel(task)}; next run in ${nextLabel}.`, "info");
			return;
		}

		if (parsed.type === "run") {
			const task = await resolveTask(api.agentDir, parsed.ref);
			if (!task) {
				publishLoopUpdate(api, bus, `[Loop] No scheduled task matches "${parsed.ref}".`, "warning");
				return;
			}
			const scheduler = getCronScheduler(bus);
			if (scheduler && scheduler.forceDue(task.id)) {
				publishLoopUpdate(api, bus, `[Loop] Forcing ${refLabel(task)} to run now.`, "info");
			}
			return;
		}

		// === Create task (type === "start") ===
		try {
			const cronExpr = intervalToCron(parsed.intervalLabel.split(" ")[0] ?? parsed.intervalLabel);
			if (!cronExpr) {
				publishLoopUpdate(api, bus, `[Loop] Could not convert interval "${parsed.intervalLabel}" to cron.`, "error");
				return;
			}

			const result = await addCronTask(ctx.agentDir, {
				cron: cronExpr,
				prompt: parsed.input,
				recurring: true,
				durable: parsed.durable,
				name: parsed.name,
				maxRuns: parsed.maxRuns,
				quiet: parsed.quiet,
			});

			// Immediately dispatch the first run (per refactoring plan requirement)
			const task = await resolveTask(api.agentDir, result.id);
			if (task) {
				void dispatchTask(api, bus, task);
			}

			const displayTask = await resolveTask(api.agentDir, result.id);
			if (displayTask) {
				const { nextCronRunMs } = await import("./cron/index.js");
				const nextRun = nextCronRunMs(displayTask.cron, displayTask.lastFiredAt ?? displayTask.createdAt) ?? undefined;
				publishLoopUpdate(api, bus, formatScheduledTask(displayTask, nextRun), "info");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			publishLoopUpdate(api, bus, `[Loop] ${message}`, "error");
		}
	};

	api.registerCommand("loop", {
		description: "Schedule a recurring prompt or slash command for this session.",
		getArgumentCompletions: getLoopArgumentCompletions,
		handler: handleLoopCommand,
	});
}

/**
 * Resolve a task reference (id or name) from any store.
 */
async function resolveTask(projectRoot: string | undefined, ref: string): Promise<CronTask | undefined> {
	const trimmed = ref.trim();
	if (!trimmed) return undefined;

	// Try direct ID match
	const byId = await getCronTask(projectRoot, trimmed);
	if (byId) return byId;

	// Try name match
	const all = await listCronTasks(projectRoot);
	const lower = trimmed.toLowerCase();
	return all.find((t) => t.name && t.name.toLowerCase() === lower);
}
