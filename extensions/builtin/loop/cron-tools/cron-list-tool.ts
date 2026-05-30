/**
 * [WHO]: CronList tool - lists all scheduled cron tasks
 * [FROM]: Depends on @sinclair/typebox, ../cron, ../../types
 * [TO]: Consumed by loop extension via registerTool()
 * [HERE]: extensions/builtin/loop/cron-tools/cron-list-tool.ts - CronList tool per refactoring plan
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { listCronTasks, nextCronRunMs } from "../cron/index.js";

const cronListSchema = Type.Object({});
export type CronListInput = Static<typeof cronListSchema>;

export function createCronListTool() {
	return {
		name: "CronList",
		label: "List Scheduled Tasks",
		description: "List all active scheduled tasks (session-only and durable).",
		parameters: cronListSchema,

		guidance:
			"Use CronList to see all currently scheduled tasks, their cron expressions, prompts, and next fire times.",

		async execute(
			_toolCallId: string,
			_params: CronListInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const tasks = await listCronTasks(ctx.agentDir);

				if (tasks.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: "No scheduled tasks are active.",
							},
						],
						details: { tasks: [] },
					};
				}

				const now = Date.now();
				const lines = [`Scheduled tasks (${tasks.length}):`, ""];

				for (const task of tasks) {
					const nextRun = nextCronRunMs(task.cron, task.lastFiredAt ?? task.createdAt);
					const nextRunStr = nextRun ? formatRelativeTime(nextRun - now) : "unknown";

					const status = task.paused ? " (paused)" : task.pending ? " (running)" : "";
					lines.push(`ID: ${task.id}${status}`);
					lines.push(`  Schedule: ${task.cron} (${task.recurring ? "recurring" : "one-shot"})`);
					lines.push(`  Prompt: "${task.prompt}"`);
					lines.push(`  Next run: ${nextRunStr}`);
					lines.push(`  Durable: ${task.durable ?? false}`);
					lines.push(`  Run count: ${task.maxRuns ? task.runCount + "/" + task.maxRuns : task.runCount}`);
					if (task.name) lines.push(`  Name: ${task.name}`);
					lines.push("");
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { tasks },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: Failed to list scheduled tasks: ${message}` }],
					details: { error: message },
				};
			}
		},
	};
}

function formatRelativeTime(ms: number): string {
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
