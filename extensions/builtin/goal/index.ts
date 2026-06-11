/**
 * [WHO]: goalExtension default export - wires the GoalController per thread; registers /goal command + completions; registers get_goal/create_goal/update_goal tools; subscribes to session/turn/tool/message lifecycle hooks for accounting, idle continuation, and budget-limit steering; renders GOAL_MESSAGE_TYPE custom messages
 * [FROM]: Depends on @pencil-agent/agent-core, @pencil-agent/tui, core/extensions-host/types, ./goal-controller, ./goal-tools, ./goal-command, ./goal-parser, ./goal-types, ./goal-format
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/builtin/goal/index.ts - extension entry; owns the per-thread controller and the controller host singleton
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@pencil-agent/agent-core";
import { Box, Container, Spacer, Text } from "@pencil-agent/tui";
import type {
	AgentAbortEvent,
	AgentResultEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionHandler,
	MessageEndEvent,
	MessageStartEvent,
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
const PLAN_LOOP_FRAMEWORK = "weak-model-compatible" as const;

const debugLogPath = path.join(os.homedir(), ".nanopencil", "agent", "nanopencil-debug.log");
function dbg(msg: string): void {
	fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] [goal] ${msg}\n`);
}

/**
 * The GoalController is per-thread. We key it by `ExtensionAPI` (the runner's bus)
 * so that switching sessions rebuilds cleanly. The agent exposes the active api in
 * the event context; we look it up via WeakMap at every hook invocation.
 */
const controllersByBus = new Map<string, GoalController>();
let currentKey: string | null = null;
let activeController: GoalController | null = null;
/** Guard: tracks the goal ID whose terminal state has already been reported,
 *  preventing the onTurnEnd handler from re-sending "Goal complete/budget_limited"
 *  messages on every subsequent turn (which would cause an infinite loop). */
let reportedTerminalGoalId: string | null = null;

function resolveController(api: unknown, ctx: ExtensionContext | ExtensionCommandContext): GoalController | null {
	const sessionId = ctx.sessionManager.getSessionId();
	if (!sessionId) return null;
	const key = `${ctx.agentDir}/${sessionId}`;
	currentKey = key;
	let controller = controllersByBus.get(key);
	if (!controller) {
		controller = new GoalController(api as ExtensionAPI, sessionId);
		controllersByBus.set(key, controller);
	}
	activeController = controller;
	return controller;
}

const goalToolHost: GoalToolHost = {
	getController(agentDir, threadId) {
		const key = `${agentDir}/${threadId}`;
		const controller = controllersByBus.get(key);
		return controller ?? null;
	},
};

function detectRunKind(loopFramework: string | undefined): GoalRunKind {
	if (!loopFramework) return "normal";
	if (loopFramework === PLAN_LOOP_FRAMEWORK) return "normal"; // weak-model-compatible is normal for accounting; Plan-mode is detected differently below.
	return "normal";
}

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

	// Resolve the controller eagerly so tool registrations can find it.
	const ensureController = (ctx: ExtensionContext | ExtensionCommandContext): GoalController | null => {
		const controller = resolveController(api, ctx);
		if (controller) activeController = controller;
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
			dbg(`/goal command done, reportedTerminalGoalId reset`);
		},
	});

	// ── Session lifecycle ─────────────────────────────────────────────

	api.on("session_start", (_event, ctx) => {
		dbg("session_start");
		const controller = ensureController(ctx);
		controller?.resetIdleContinuationFlag();
		reportedTerminalGoalId = null;
	});

	api.on("session_shutdown", () => {
		if (currentKey) controllersByBus.delete(currentKey);
		currentKey = null;
		activeController = null;
	});

	// ── Turn lifecycle ───────────────────────────────────────────────

	const onTurnStart: ExtensionHandler<TurnStartEvent> = (event, ctx) => {
		dbg(`turn_start index=${event.turnIndex}`);
		const controller = ensureController(ctx);
		if (!controller) return;
		const runKind: GoalRunKind = isPlanMode(ctx) ? "plan" : "normal";
		// Token start is set to 0; real usage accrues via on_token_usage (message_end hook)
		controller.on_turn_start(`turn-${event.turnIndex}-${event.timestamp}`, runKind, 0);
	};
	api.on("turn_start", onTurnStart);

	const onMessageStart: ExtensionHandler<MessageStartEvent> = (_event, ctx) => {
		ensureController(ctx);
	};
	api.on("message_start", onMessageStart);

	const onMessageEnd: ExtensionHandler<MessageEndEvent> = (event, ctx) => {
		const controller = ensureController(ctx);
		if (!controller) return;
		const message = event.message as { role?: string; usage?: { totalTokens?: number } };
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
		const controller = ensureController(ctx);
		if (!controller) return;
		if (event.isError) return;

		controller.on_tool_finish(event.toolName);
	};
	api.on("tool_execution_end", onToolExecutionEnd);

	const onTurnEnd: ExtensionHandler<TurnEndEvent> = async (_event, ctx) => {
		const controller = ensureController(ctx);
		if (!controller) return;
		const outcome = await controller.on_turn_end();
		dbg(`turn_end: dispatched=${outcome.dispatched} reason=${outcome.reason} goalId=${outcome.goal?.goal_id} goalStatus=${outcome.goal?.status} reportedTerminalGoalId=${reportedTerminalGoalId}`);
		if (outcome.dispatched) {
			dbg("turn_end → sending continuation message");
			api.sendMessage({
				customType: GOAL_MESSAGE_TYPE,
				content: `Goal continuation dispatched.\n${summarizeGoalStatus(outcome.goal)}`,
				display: true,
				details: { kind: "continuation", goal: outcome.goal },
			});
		} else if (outcome.goal && outcome.reason === "continuation_limit_reached") {
			dbg(`turn_end → continuation limit reached, goal paused: ${outcome.goal.goal_id}`);
			reportedTerminalGoalId = outcome.goal.goal_id;
			api.sendMessage({
				customType: GOAL_MESSAGE_TYPE,
				content: `Goal paused — no progress after ${outcome.consecutiveContinuations ?? "?"} continuation attempts.\n${summarizeGoalStatus(outcome.goal)}`,
				display: true,
				details: { kind: "continuation_limit", goal: outcome.goal },
			});
		} else if (outcome.goal && outcome.reason === "not_active_status") {
			// Surface terminal states for visibility — but only once per goal.
			// Without this guard, every subsequent turn_end re-sends the message,
			// causing an infinite loop of "Goal complete" notifications.
			if (reportedTerminalGoalId === outcome.goal.goal_id) {
				dbg(`turn_end → BLOCKED by guard (already reported goal ${outcome.goal.goal_id})`);
				return;
			}
			const indicator = goalStatusIndicator(outcome.goal, null);
			if (indicator.type === "Complete" || indicator.type === "BudgetLimited") {
				reportedTerminalGoalId = outcome.goal.goal_id;
				dbg(`turn_end → sending terminal message: ${indicator.type} for goal ${outcome.goal.goal_id}`);
				api.sendMessage({
					customType: GOAL_MESSAGE_TYPE,
					content: `Goal ${indicator.type === "Complete" ? "complete" : "budget_limited"}.\n${summarizeGoalStatus(outcome.goal)}`,
					display: true,
					details: { kind: indicator.type.toLowerCase(), goal: outcome.goal },
				});
			}
		}
	};
	api.on("turn_end", onTurnEnd);

	// ── Agent-level lifecycle ────────────────────────────────────────

	const onAgentEnd = async (event: { messages: AgentMessage[] }, ctx: ExtensionContext) => {
		const controller = ensureController(ctx);
		if (!controller) return;
		// Final accounting using aggregate usage from the run.
		const total = getRunningTotalTokens(event.messages);
		controller.on_token_usage(total);
	};
	api.on("agent_end", onAgentEnd as ExtensionHandler<{ type: "agent_end"; messages: AgentMessage[] }>);

	const onAgentResult: ExtensionHandler<AgentResultEvent> = (event, ctx) => {
		const controller = ensureController(ctx);
		if (!controller) return;
		const usage = event.usage;
		if (usage && typeof usage.totalTokens === "number") {
			controller.on_token_usage(usage.totalTokens);
		}
		const loopFramework = event.loopFramework;
		void detectRunKind(loopFramework);
		// turnIndexFromMessages removed; loop framework not wired yet
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
		const interval = setInterval(tick, 1000);
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
