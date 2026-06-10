/**
 * CronDelete tool — deletes a scheduled cron task.
 *
 * 1:1 port of Claude Code src/tools/ScheduleCronTool/CronDeleteTool.ts
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { listAllCronTasks, removeCronTasks } from "../cron/index.js";
import {
	buildCronDeletePrompt,
	CRON_DELETE_DESCRIPTION,
	CRON_DELETE_TOOL_NAME,
	isDurableCronEnabled,
} from "./prompt.js";

const cronDeleteSchema = Type.Object({
	id: Type.String({
		description: "Job ID returned by CronCreate.",
	}),
});

export type CronDeleteInput = Static<typeof cronDeleteSchema>;

export function createCronDeleteTool() {
	return {
		name: CRON_DELETE_TOOL_NAME,
		label: "Delete Scheduled Task",
		searchHint: "cancel a scheduled cron job",
		description: CRON_DELETE_DESCRIPTION,
		parameters: cronDeleteSchema,

		guidance: buildCronDeletePrompt(isDurableCronEnabled()),

		async execute(
			_toolCallId: string,
			params: CronDeleteInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			// Validate task exists
			const tasks = await listAllCronTasks(ctx.agentDir);
			const task = tasks.find((t) => t.id === params.id);
			if (!task) {
				return {
					content: [
						{
							type: "text",
							text: `No scheduled job with id '${params.id}'`,
						},
					],
					details: { error: "not_found" },
				};
			}

			try {
				await removeCronTasks([params.id], ctx.agentDir);
				return {
					content: [
						{
							type: "text",
							text: `Cancelled job ${params.id}.`,
						},
					],
					details: { id: params.id },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text",
							text: `Error: Failed to delete scheduled task: ${message}`,
						},
					],
					details: { error: message },
				};
			}
		},
	};
}
