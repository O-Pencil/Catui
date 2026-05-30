/**
 * [WHO]: CronDelete tool - deletes a scheduled cron task
 * [FROM]: Depends on @sinclair/typebox, ../cron, ../../types
 * [TO]: Consumed by loop extension via registerTool()
 * [HERE]: extensions/builtin/loop/cron-tools/cron-delete-tool.ts - CronDelete tool per refactoring plan
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { deleteCronTask } from "../cron/index.js";

const cronDeleteSchema = Type.Object({
	id: Type.String({
		description: "The ID of the scheduled task to delete",
	}),
});

export type CronDeleteInput = Static<typeof cronDeleteSchema>;

export function createCronDeleteTool() {
	return {
		name: "CronDelete",
		label: "Delete Scheduled Task",
		description: "Delete a scheduled task by its ID. The task will no longer execute.",
		parameters: cronDeleteSchema,

		guidance:
			"Use CronDelete to cancel a scheduled task. Provide the task ID returned by CronCreate or listed by CronList.",

		async execute(
			_toolCallId: string,
			params: CronDeleteInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const deleted = await deleteCronTask(ctx.agentDir, params.id);

				if (deleted) {
					return {
						content: [
							{
								type: "text",
								text: `Deleted scheduled task ${params.id}. It will no longer execute.`,
							},
						],
						details: { deleted: true, id: params.id },
					};
				} else {
					return {
						content: [
							{
								type: "text",
								text: `Error: No scheduled task found with ID: ${params.id}`,
							},
						],
						details: { deleted: false, id: params.id },
					};
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: Failed to delete scheduled task: ${message}` }],
					details: { error: message },
				};
			}
		},
	};
}
