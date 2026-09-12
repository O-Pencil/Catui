/**
 * [WHO]: goalExtension default export - wires the GoalController per thread; registers /goal command + completions; registers GetGoal/CreateGoal/UpdateGoal tools; subscribes to lifecycle hooks for accounting (turn_end), pull-model continuation + run-error blocking (agent_end, mirrors Codex continue_if_idle), and budget-limit steering; renders GOAL_MESSAGE_TYPE custom messages
 * [FROM]: Depends on @catui/agent-core, @catui/tui, core/extensions-host/types, ./goal-controller, ./goal-tools, ./goal-command, ./goal-parser, ./goal-types, ./goal-format
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/builtin/goal/index.ts - extension entry; binds run accounting, scoped cancellation, owned input and per-thread controllers
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@catui/agent-core";
import { Box, Container, Spacer, Text } from "@catui/tui";
import type {
	AgentAbortEvent,
	AgentResultEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionHandler,
	MessageEndEvent,
	ToolExecutionEndEvent,
	TurnEndEvent,
	TurnStartEvent,
} from "../../../core/extensions-host/types.js";
import { runGoalCommand } from "./goal-command.js";
import { GoalController } from "./goal-controller.js";
import {
	getGoalArgumentCompletions,
} from "./goal-parser.js";
import {
	buildAllGoalTools,
	setGoalToolHost,
	type GoalToolHost,
} from "./goal-tools.js";
import { goalStatusIndicator, goalSummaryLines, goalUsageSummary } from "./goal-format.js";
import { isActiveStatus, type GoalRunKind, type ThreadGoal } from "./goal-types.js";

const GOAL_MESSAGE_TYPE = "goal";

const _dbgEnabled = process.env.CATUI_DEBUG === "1";
const debugLogPath = path.join(os.homedir(), ".catui", "agent", "catui-debug.log");
function dbg(msg: string): void {
	// Off by default; never write or crash in a release (ENOENT on fresh install).
	if (!_dbgEnabled) return;
	try {
		fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
		fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] [goal] ${msg}\n`);
	} catch {
		// debug logging is best-effort
	}
}

function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max) + "…" : s;
}

function extractContentPreview(message: { role?: string; content?: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return truncate(content, 150);
	if (Array.isArray(content)) {
		const textParts = content
			.filter((p): p is { type: string; text?: string } => p.type === "text" && typeof p.text === "string")
			.map((p) => p.text!);
		if (textParts.length > 0) return truncate(textParts.join(" "), 150);
		const toolParts = content
			.filter((p): p is { type: string; name?: string } => p.type === "tool_use")
			.map((p) => `[tool_use:${p.name ?? "?"}]`);
		if (toolParts.length > 0) return toolParts.join(" ");
	}
	return "(empty)";
}

/**
 * The GoalController is per-thread. We key it by `ExtensionAPI` (the runner's bus)
 * so that switching sessions rebuilds cleanly. The agent exposes the active api in
 * the event context; we look it up via WeakMap at every hook invocation.
 */
const controllersByBus = new Map<string, GoalController>();

function resolveController(api: unknown, ctx: ExtensionContext | ExtensionCommandContext): GoalController | null {
	const sessionId = ctx.sessionManager.getSessionId();
	if (!sessionId) return null;
	const key = `${ctx.agentDir}/${sessionId}`;
	let controller = controllersByBus.get(key);
	if (!controller) {
		controller = new GoalController(api as ExtensionAPI, sessionId);
		controllersByBus.set(key, controller);
	}
	return controller;
}

const goalToolHost: GoalToolHost = {
	getController(agentDir, threadId) {
		const key = `${agentDir}/${threadId}`;
		const controller = controllersByBus.get(key);
		return controller ?? null;
	},
};

/** Heuristic for plan mode: agent_session exposes no first-class Plan signal in hooks,
 *  so we treat turns that started under the plan extension's flag as plan-mode. */
function isPlanMode(ctx: ExtensionContext): boolean {
	// The plan extension injects a custom marker; check session metadata as a fallback.
	const settings = ctx.getSettings();
	const planFlag = (settings as Record<string, unknown>).plan;
	return Boolean(planFlag);
}

function getRunningTotalTokens(messages: AgentMessage[]): number {
	let total = 0;
	for (const message of messages) {
		const role = (message as { role?: string }).role;
		if (role !== "assistant") continue;
		const usage = (message as { usage?: { totalTokens?: number } }).usage;
		if (usage && typeof usage.totalTokens === "number") {
			total += usage.totalTokens;
		}
	}
	return total;
}





export default async function goalExtension(api: ExtensionAPI): Promise<void> {
	setGoalToolHost(goalToolHost);
	let currentKey: string | null = null;
	let activeController: GoalController | null = null;
	// Reporting and shutdown ownership belong to this host, not the last SDK session.
	let reportedTerminalGoalId: string | null = null;
	let reportedTerminalStatus: string | null = null;

	// Resolve the controller eagerly so tool registrations can find it.
	const ensureController = (ctx: ExtensionContext | ExtensionCommandContext): GoalController | null => {
		const controller = resolveController(api, ctx);
		if (controller) {
			activeController = controller;
			currentKey = `${ctx.agentDir}/${ctx.sessionManager.getSessionId()}`;
		}
		return controller;
	};

	// Register tools (LLM-facing)
	const [getGoalTool, createGoalTool, updateGoalTool] = buildAllGoalTools();
	api.registerTool(getGoalTool);
	api.registerTool(createGoalTool);
	api.registerTool(updateGoalTool);

	// Renderer for custom goal messages
	api.registerMessageRenderer(GOAL_MESSAGE_TYPE, (message, _options, theme) => {
		const text =
			typeof message.content === "string"
				? message.content
				: Array.isArray(message.content)
					? message.content
							.filter((part): part is { type: "text"; text: string } => part.type === "text")
							.map((part) => part.text)
							.join("\n")
					: JSON.stringify(message.content ?? "");
		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(theme.fg("dim", text), 0, 0));
		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	});

	// Slash command
	api.registerCommand("goal", {
		description: "Set, show, edit, pause, resume, or clear the thread goal.",
		getArgumentCompletions: getGoalArgumentCompletions,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			dbg(`/goal command invoked: args="${args}"`);
			const controller = ensureController(ctx);
			await runGoalCommand(args, ctx, controller);
			// Reset terminal-state guard so a newly set goal's completion can be reported
			reportedTerminalGoalId = null;
			reportedTerminalStatus = null;
			dbg(`/goal command done, reportedTerminalGoalId reset`);
		},
	});

	// ── Session lifecycle ─────────────────────────────────────────────

	api.on("session_start", (_event, ctx) => {
		dbg("session_start");
		const controller = ensureController(ctx);
		controller?.resetIdleContinuationFlag();
		if (controller?.goalStore.get_goal()?.status === "active") controller.activateContinuation();
		reportedTerminalGoalId = null;
		reportedTerminalStatus = null;
	});

	api.on("session_shutdown", () => {
		activeController?.cancelContinuation();
		if (currentKey) controllersByBus.delete(currentKey);
		currentKey = null;
		activeController = null;
	});

	// ── Turn lifecycle ───────────────────────────────────────────────
	api.on("agent_start", (_event, ctx) => { ensureController(ctx)?.on_run_start(); });
	api.on("input", (event, ctx) => {
		if (event.source !== "extension" || !event.text.startsWith("[GOAL:")) return;
		return { action: ensureController(ctx)?.acceptPrompt(event.text) ? "continue" : "handled" };
	});

	const onTurnStart: ExtensionHandler<TurnStartEvent> = (event, ctx) => {
		dbg(`turn_start index=${event.turnIndex} timestamp=${event.timestamp}`);
		const controller = ensureController(ctx);
		if (!controller) return;
		const runKind: GoalRunKind = isPlanMode(ctx) ? "plan" : "normal";
		controller.on_turn_start(`turn-${event.turnIndex}-${event.timestamp}`, runKind, 0);
	};
	api.on("turn_start", onTurnStart);

	const onMessageEnd: ExtensionHandler<MessageEndEvent> = (event, ctx) => {
		const controller = ensureController(ctx);
		if (!controller) return;
		const message = event.message as { role?: string; usage?: { totalTokens?: number }; content?: unknown };
		// Log message content preview
		const contentPreview = extractContentPreview(message);
		dbg(`message_end role=${message.role ?? "?"} tokens=${message.usage?.totalTokens ?? "?"} content=${contentPreview}`);
		if (message.role !== "assistant") return;
		const total = message.usage?.totalTokens;
		if (typeof total !== "number") return;
		const crossed = controller.on_token_usage(total);
		if (crossed.crossed && crossed.goal) {
			const steering = controller.maybe_build_budget_limit_steering();
			if (steering) {
				api.sendMessage({
					customType: GOAL_MESSAGE_TYPE,
					content: steering,
					display: true,
					details: { kind: "budget_limit", goal: crossed.goal },
				});
			}
		}
	};
	api.on("message_end", onMessageEnd);

	const onToolExecutionEnd: ExtensionHandler<ToolExecutionEndEvent> = (event, ctx) => {
		dbg(`tool_execution_end name=${event.toolName} isError=${event.isError} result=${truncate(JSON.stringify(event.result ?? ""), 200)}`);
		const controller = ensureController(ctx);
		if (!controller) return;
		if (event.isError) return;

		controller.on_tool_finish(event.toolName);
	};
	api.on("tool_execution_end", onToolExecutionEnd);

	const onTurnEnd: ExtensionHandler<TurnEndEvent> = async (event, ctx) => {
		try {
		const controller = ensureController(ctx);
		if (!controller) return;
		const turnSnapshot = controller.currentTurnSnapshot();
		const turnDuration = turnSnapshot ? ((Date.now() - turnSnapshot.turnStartedAt) / 1000).toFixed(1) : "?";
		dbg(`turn_end BEGIN index=${event.turnIndex} duration=${turnDuration}s tokens=${turnSnapshot?.tokensNow ?? "?"}`);
		const outcome = await controller.on_turn_end();
		dbg(`turn_end RESULT: reason=${outcome.reason} goalId=${outcome.goal?.goal_id} goalStatus=${outcome.goal?.status} reportedTerminalGoalId=${reportedTerminalGoalId}`);
		if (outcome.reason !== "not_active_status" || !outcome.goal) return;
		// Cancel only this goal's prompts; unrelated queued work must survive.
		const s = outcome.goal.status;
		if (s === "complete" || s === "blocked" || s === "budget_limited" || s === "paused") {
			dbg(`turn_end → clearing followUp queue (goal is ${s})`);
			try {
				controller.cancelContinuation();
			} catch (e) {
				dbg(`turn_end → clearFollowUpQueue FAILED: ${e}`);
			}
		}
		// Surface terminal states for visibility — but only once per goal+status.
		// Without this guard, every subsequent turn_end re-sends the message,
		// causing an infinite loop of "Goal complete" notifications.
		const goalId = outcome.goal.goal_id;
		const goalStatus = outcome.goal.status;
		if (reportedTerminalGoalId === goalId && reportedTerminalStatus === goalStatus) {
			return;
		}
		const indicator = goalStatusIndicator(outcome.goal, null);
		if (indicator.type === "Complete" || indicator.type === "BudgetLimited") {
			reportedTerminalGoalId = goalId;
			reportedTerminalStatus = goalStatus;
			dbg(`turn_end → sending terminal message: ${indicator.type} for goal ${goalId}`);
			api.sendMessage({
				customType: GOAL_MESSAGE_TYPE,
				content: `Goal ${indicator.type === "Complete" ? "complete" : "budget_limited"}.\n${summarizeGoalStatus(outcome.goal)}`,
				display: true,
				details: { kind: indicator.type.toLowerCase(), goal: outcome.goal },
			}, { triggerTurn: false });
			// No steering followUp here: the pull model (maybe_dispatch_continuation
			// at agent_end) refuses to start a new turn when the goal is not Active,
			// so the agent stops cleanly (aligns with Codex's continue_if_idle).
		}
		} catch (e) {
			dbg(`turn_end EXCEPTION: ${e instanceof Error ? e.message : String(e)}\n${e instanceof Error ? e.stack : ""}`);
		}
	};
	api.on("turn_end", onTurnEnd);

	// ── Agent-level lifecycle ────────────────────────────────────────

	// agent_end is the true idle point: the runtime emits it only after retries
	// and compaction settle, with the agent no longer streaming. This is where
	// the pull-model continuation decision happens (mirrors Codex's
	// on_thread_idle → continue_if_idle()).
	const onAgentEnd = async (event: { messages: AgentMessage[] }, ctx: ExtensionContext) => {
		try {
		const controller = ensureController(ctx);
		if (!controller) return;
		// Final accounting using aggregate usage from the run.
		const total = getRunningTotalTokens(event.messages);
		controller.on_token_usage(total);

		const stopReason = controller.runStopReason;
		dbg(`agent_end stopReason=${stopReason ?? "unknown"}`);
		if (stopReason === "aborted") {
			// onAgentAbort pauses the goal; never restart a run the user stopped.
			return;
		}
		if (stopReason === "error") {
			// Run ended with a non-recoverable error (retries already exhausted by
			// the retry coordinator). Mirror Codex's on_turn_error: stop the active
			// goal as blocked instead of looping continuations against a failing run.
			const stopped = controller.on_turn_error();
			if (stopped && stopped.status === "blocked") {
				dbg(`agent_end → goal ${stopped.goal_id} blocked after run error`);
				api.sendMessage({
					customType: GOAL_MESSAGE_TYPE,
					content: `Goal blocked: the run ended with an error. Use /goal resume to continue.\n${summarizeGoalStatus(stopped)}`,
					display: true,
					details: { kind: "blocked_on_error", goal: stopped },
				}, { triggerTurn: false });
			}
			return;
		}

		const outcome = controller.maybe_dispatch_continuation({
			hasPendingMessages: ctx.hasPendingMessages(),
		});
		dbg(`agent_end DISPATCH: dispatched=${outcome.dispatched} reason=${outcome.reason} goalStatus=${outcome.goal?.status}`);
		if (outcome.dispatched) {
			api.sendMessage({
				customType: GOAL_MESSAGE_TYPE,
				content: `Goal continuation dispatched.\n${summarizeGoalStatus(outcome.goal)}`,
				display: true,
				details: { kind: "continuation", goal: outcome.goal },
			}, { triggerTurn: false });
		} else if (outcome.goal && outcome.reason === "continuation_limit_reached") {
			// Silent: goal is still active; status bar tick already shows pursuit state.
			// User can /goal resume or send a message to continue.
			if (ctx.hasUI) {
				ctx.ui.setStatus("goal", "Continuation limit — /goal resume to continue");
			}
		} else if (outcome.goal && outcome.reason === "total_continuation_limit_reached") {
			// Guard: only send once per goal+status
			if (reportedTerminalGoalId === outcome.goal.goal_id && reportedTerminalStatus === "paused") {
				return;
			}
			reportedTerminalGoalId = outcome.goal.goal_id;
			reportedTerminalStatus = "paused";
			api.sendMessage({
				customType: GOAL_MESSAGE_TYPE,
				content: `Goal auto-paused after ${outcome.consecutiveContinuations ?? "?"} continuation turns. Use /goal resume to continue.\n${summarizeGoalStatus(outcome.goal)}`,
				display: true,
				details: { kind: "total_continuation_limit", goal: outcome.goal },
			}, { triggerTurn: false });
		}
		} catch (e) {
			dbg(`agent_end EXCEPTION: ${e instanceof Error ? e.message : String(e)}\n${e instanceof Error ? e.stack : ""}`);
		}
	};
	api.on("agent_end", onAgentEnd as ExtensionHandler<{ type: "agent_end"; messages: AgentMessage[] }>);

	const onAgentResult: ExtensionHandler<AgentResultEvent> = (event, ctx) => {
		const controller = ensureController(ctx);
		if (!controller) return;
		controller.note_run_stop_reason(event.stopReason);
		const usage = event.usage;
		if (usage && typeof usage.totalTokens === "number") {
			controller.on_token_usage(usage.totalTokens);
		}
	};
	api.on("agent_result", onAgentResult);

	// ── Abort handling: pause goal on Esc ────────────────────────────

	const onAgentAbort: ExtensionHandler<AgentAbortEvent> = async (_event, ctx) => {
		const controller = ensureController(ctx);
		if (!controller) return;
		const goal = await controller.get_goal();
		if (!goal || !isActiveStatus(goal.status)) return;
		dbg(`agent_abort → pausing goal ${goal.goal_id}`);
		await controller.set_status("paused");
		reportedTerminalGoalId = null;
		reportedTerminalStatus = null;
		if (ctx.hasUI) {
			ctx.ui.notify("Goal paused (agent aborted).", "info");
		}
	};
	api.on("agent_abort", onAgentAbort);

	// ── Status footer indicator ──────────────────────────────────────

	api.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		const tick = () => {
			const controller = activeController;
			if (!controller) return;
			controller.get_goal().then((goal) => {
				if (!goal || !isActiveStatus(goal.status) && goal.status !== "budget_limited" && goal.status !== "complete") {
					ctx.ui.setStatus("goal", undefined);
					return;
				}
				const activeTurnStartedAt = controller.currentTurnSnapshot()?.turnStartedAt ?? null;
				const indicator = goalStatusIndicator(goal, activeTurnStartedAt);
				const label = indicatorLabel(indicator);
				ctx.ui.setStatus("goal", label);
			}).catch(() => {});
		};
		const interval = setInterval(tick, 200);
		const cleanup = () => clearInterval(interval);
		api.on("session_shutdown", () => cleanup());
	});
}

function indicatorLabel(indicator: ReturnType<typeof goalStatusIndicator>): string {
	switch (indicator.type) {
		case "Active":
			return `Pursuing goal (${indicator.usage})`;
		case "Paused":
			return "Goal paused (/goal resume)";
		case "Blocked":
			return "Goal blocked (/goal resume)";
		case "UsageLimited":
			return "Goal hit usage limits (/goal resume)";
		case "BudgetLimited":
			return indicator.usage ? `Goal unmet (${indicator.usage})` : "Goal abandoned";
		case "Complete":
			return `Goal achieved (${indicator.usage})`;
	}
}

function summarizeGoalStatus(goal: ThreadGoal | undefined): string {
	if (!goal) return "";
	const lines = goalSummaryLines(goal);
	const summary = goalUsageSummary(goal);
	void lines;
	return [
		`  Status: ${goal.status}`,
		`  Objective: ${goal.objective}`,
		`  Time used: ${summary.elapsed}`,
		`  Tokens used: ${summary.tokensLabel}${summary.hasBudget ? " tokens" : ""}`,
	].join("\n");
}
