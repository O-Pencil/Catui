/**
 * [WHO]: createCronCreateTool, CronCreateInput
 * [FROM]: Depends on @sinclair/typebox, @catui/agent-core, core/extensions-host/types, ../cron, ./prompt
 * [TO]: Consumed by ./index
 * [HERE]: extensions/builtin/loop/cron-tools/cron-create-tool.ts - CronCreate tool factory
 *
 * CronCreate tool — creates a scheduled cron task.
 *
 * 1:1 port of Claude Code src/tools/ScheduleCronTool/CronCreateTool.ts
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@catui/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import {
	addCronTask,
	cronToHuman,
	listAllCronTasks,
	nextCronRunMs,
	parseCronExpression,
} from "../cron/index.js";
import {
	buildCronCreateDescription,
	buildCronCreatePrompt,
	CRON_CREATE_TOOL_NAME,
	DEFAULT_MAX_AGE_DAYS,
	isDurableCronEnabled,
} from "./prompt.js";

const MAX_JOBS = 50;

const cronCreateSchema = Type.Object({
	cron: Type.String({
		description:
			'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g. "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once).',
	}),
	prompt: Type.String({
		description: "The prompt to enqueue at each fire time.",
	}),
	recurring: Type.Optional(
		Type.Boolean({
			description: `true (default) = fire on every cron match until deleted or auto-expired after ${DEFAULT_MAX_AGE_DAYS} days. false = fire once at the next match, then auto-delete. Use false for "remind me at X" one-shot requests with pinned minute/hour/dom/month.`,
			default: true,
		}),
	),
	durable: Type.Optional(
		Type.Boolean({
			description:
				"true = persist to .claude/scheduled_tasks.json and survive restarts. false (default) = in-memory only, dies when this session ends. Use true only when the user asks the task to survive across sessions.",
			default: false,
		}),
	),
});

export type CronCreateInput = Static<typeof cronCreateSchema>;

export function createCronCreateTool() {
	return {
		name: CRON_CREATE_TOOL_NAME,
		label: "Create Scheduled Task",
		searchHint: "schedule a recurring or one-shot prompt",
		description: buildCronCreateDescription(isDurableCronEnabled()),
		parameters: cronCreateSchema,

		guidance: buildCronCreatePrompt(isDurableCronEnabled()),

		async execute(
			_toolCallId: string,
			params: CronCreateInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			// Validate cron expression
			if (!parseCronExpression(params.cron)) {
				return {
					content: [
						{
							type: "text",
							text: `Invalid cron expression '${params.cron}'. Expected 5 fields: M H DoM Mon DoW.`,
						},
					],
					details: { error: "invalid_cron" },
				};
			}

			// Validate next fire time exists within 1 year
			if (nextCronRunMs(params.cron, Date.now()) === null) {
				return {
					content: [
						{
							type: "text",
							text: `Cron expression '${params.cron}' does not match any calendar date in the next year.`,
						},
					],
					details: { error: "no_match" },
				};
			}

			// Check task count limit
			const tasks = await listAllCronTasks(ctx.agentDir);
			if (tasks.length >= MAX_JOBS) {
				return {
					content: [
						{
							type: "text",
							text: `Too many scheduled jobs (max ${MAX_JOBS}). Cancel one first.`,
						},
					],
					details: { error: "max_jobs" },
				};
			}

			try {
				const effectiveDurable = Boolean(params.durable) && isDurableCronEnabled();
				const id = await addCronTask(
					params.cron,
					params.prompt,
					params.recurring ?? true,
					effectiveDurable,
					ctx.agentDir,
				);

				const humanSchedule = cronToHuman(params.cron);
				const recurring = params.recurring ?? true;
				const where = effectiveDurable
					? "Persisted to .claude/scheduled_tasks.json"
					: "Session-only (not written to disk, dies when session exits)";

				return {
					content: [
						{
							type: "text",
							text: recurring
								? `Scheduled recurring job ${id} (${humanSchedule}). ${where}. Auto-expires after ${DEFAULT_MAX_AGE_DAYS} days. Use CronDelete to cancel sooner.`
								: `Scheduled one-shot task ${id} (${humanSchedule}). ${where}. It will fire once then auto-delete.`,
						},
					],
					details: {
						id,
						humanSchedule,
						recurring,
						durable: effectiveDurable,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text",
							text: `Error: Failed to create scheduled task: ${message}`,
						},
					],
					details: { error: message },
				};
			}
		},
	};
}
