/**
 * [WHO]: CronCreate tool - creates a scheduled cron task
 * [FROM]: Depends on @sinclair/typebox, ../cron, ../../types
 * [TO]: Consumed by loop extension via registerTool()
 * [HERE]: extensions/builtin/loop/cron-tools/cron-create-tool.ts - CronCreate tool per refactoring plan
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { addCronTask } from "../cron/index.js";

const cronCreateSchema = Type.Object({
	cron: Type.String({
		description: "5-field cron expression (e.g., '*/5 * * * *' for every 5 minutes)",
	}),
	prompt: Type.String({
		description: "The prompt or command to execute when the task fires",
	}),
	recurring: Type.Optional(Type.Boolean({
		description: "Whether to repeat this task. Default: true",
		default: true,
	})),
	durable: Type.Optional(Type.Boolean({
		description: "Whether to persist across sessions. Default: false",
		default: false,
	})),
});

export type CronCreateInput = Static<typeof cronCreateSchema>;

export function createCronCreateTool() {
	return {
		name: "CronCreate",
		label: "Create Scheduled Task",
		description: "Create a recurring or one-shot scheduled task. The task will re-enqueue its prompt at the specified cron time.",
		parameters: cronCreateSchema,

		guidance:
			"Use CronCreate to schedule recurring prompts or commands. Provide a valid 5-field cron expression and the prompt to run. Set durable=true to persist across sessions.",

		async execute(
			_toolCallId: string,
			params: CronCreateInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const result = await addCronTask(ctx.agentDir, {
					cron: params.cron,
					prompt: params.prompt,
					recurring: params.recurring,
					durable: params.durable,
				});

				return {
					content: [
						{
							type: "text",
							text: [
								`Created scheduled task:`,
								`- ID: ${result.id}`,
								`- Schedule: ${result.humanSchedule}`,
								`- Cron: ${params.cron}`,
								`- Recurring: ${result.recurring}`,
								`- Durable: ${result.durable}`,
								``,
								`The task will execute: "${params.prompt}"`,
								result.recurring
									? "This task will repeat until the session ends (7 days for durable tasks)."
									: "This is a one-shot task.",
							].join("\n"),
						},
					],
					details: result,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: Failed to create scheduled task: ${message}` }],
					details: { error: message },
				};
			}
		},
	};
}
