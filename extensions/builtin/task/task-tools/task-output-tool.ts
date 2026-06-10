/**
 * [WHO]: TaskOutput tool - retrieves task details and current state
 * [FROM]: Claude Code TaskOutputTool (1:1 port, simplified for state-managed tasks)
 * [TO]: Consumed by task extension via registerTool()
 * [HERE]: extensions/builtin/task/task-tools/task-output-tool.ts
 *
 * NOTE: CC's TaskOutputTool handles background shell/agent output with blocking.
 * In nanoPencil there are no background processes, so this is a simplified version
 * that returns the task's current state and description.
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { getTask } from "../task-store.js";
import { DEFAULT_TASK_LIST_ID } from "../task-types.js";

const taskOutputSchema = Type.Object({
	task_id: Type.String({ description: "The task ID to get output from" }),
	block: Type.Optional(
		Type.Boolean({
			description: "Whether to wait for completion (default: true). In nanoPencil, this is a no-op since tasks are state-managed.",
			default: true,
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			description: "Max wait time in ms (default: 30000). In nanoPencil, this is a no-op.",
			default: 30000,
			minimum: 0,
			maximum: 600000,
		}),
	),
});

export type TaskOutputInput = Static<typeof taskOutputSchema>;

export function createTaskOutputTool() {
	return {
		name: "TaskOutput",
		label: "Task Output",
		description:
			"Retrieve the current state and details of a task. In nanoPencil, tasks are state-managed (no background processes), so this returns the task's current status and description.",
		parameters: taskOutputSchema,

		guidance: `DEPRECATED: Prefer using the Read tool on the task's output file path instead. Background tasks return their output file path in the tool result, and you receive a <task-notification> with the same path when the task completes -- Read that file directly.

- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions`,

		async execute(
			_toolCallId: string,
			params: TaskOutputInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const task = await getTask(ctx.agentDir, DEFAULT_TASK_LIST_ID, params.task_id);
				if (!task) {
					return {
						content: [{ type: "text", text: `No task found with ID: ${params.task_id}` }],
						details: { retrieval_status: "not_ready", task: null },
					};
				}

				const isComplete = task.status === "completed";

				return {
					content: [
						{
							type: "text",
							text: [
								`Task #${task.id}: ${task.subject}`,
								`Status: ${task.status}`,
								`Description: ${task.description}`,
								task.owner ? `Owner: ${task.owner}` : null,
								task.activeForm ? `Active form: ${task.activeForm}` : null,
							]
								.filter(Boolean)
								.join("\n"),
						},
					],
					details: {
						retrieval_status: isComplete ? "success" : task.status === "in_progress" ? "not_ready" : "success",
						task: {
							task_id: task.id,
							task_type: "task",
							status: task.status,
							description: task.description,
							output: task.description,
						},
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { retrieval_status: "not_ready", task: null, error: message },
				};
			}
		},
	};
}
