/**
 * [WHO]: TaskStop tool - marks a task as completed (nanoPencil has no background processes)
 * [FROM]: Depends on @sinclair/typebox, ../task-store, ../task-types
 * [TO]: Consumed by task extension via registerTool()
 * [HERE]: extensions/builtin/task/task-tools/task-stop-tool.ts
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { getTask, updateTask } from "../task-store.js";
import { DEFAULT_TASK_LIST_ID } from "../task-types.js";

const taskStopSchema = Type.Object({
	task_id: Type.String({ description: "The ID of the task to stop/complete" }),
});

export type TaskStopInput = Static<typeof taskStopSchema>;

export function createTaskStopTool() {
	return {
		name: "TaskStop",
		label: "Stop Task",
		description:
			"Stop a running task by marking it as completed. In nanoPencil, tasks are state-managed (no background processes), so this is equivalent to setting status=completed.",
		parameters: taskStopSchema,

		guidance: `- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task`,

		async execute(
			_toolCallId: string,
			params: TaskStopInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const task = await getTask(ctx.agentDir, DEFAULT_TASK_LIST_ID, params.task_id);
				if (!task) {
					return {
						content: [{ type: "text", text: `No task found with ID: ${params.task_id}` }],
						details: { success: false, task_id: params.task_id, error: "Task not found" },
					};
				}

				if (task.status === "completed") {
					return {
						content: [{ type: "text", text: `Task #${params.task_id} is already completed` }],
						details: { success: true, task_id: params.task_id, message: "Already completed" },
					};
				}

				await updateTask(ctx.agentDir, DEFAULT_TASK_LIST_ID, params.task_id, {
					status: "completed",
				});

				return {
					content: [
						{
							type: "text",
							text: `Successfully stopped task: ${params.task_id} (${task.subject})`,
						},
					],
					details: {
						message: `Successfully stopped task: ${params.task_id} (${task.subject})`,
						task_id: params.task_id,
						task_type: "task",
						command: task.subject,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { success: false, task_id: params.task_id, error: message },
				};
			}
		},
	};
}
