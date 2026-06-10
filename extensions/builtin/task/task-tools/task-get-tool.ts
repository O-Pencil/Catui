/**
 * [WHO]: TaskGet tool - retrieves a task by ID
 * [FROM]: Depends on @sinclair/typebox, ../task-store, ../task-types
 * [TO]: Consumed by task extension via registerTool()
 * [HERE]: extensions/builtin/task/task-tools/task-get-tool.ts
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { getTask } from "../task-store.js";
import { DEFAULT_TASK_LIST_ID } from "../task-types.js";

const taskGetSchema = Type.Object({
	taskId: Type.String({ description: "The ID of the task to retrieve" }),
});

export type TaskGetInput = Static<typeof taskGetSchema>;

export function createTaskGetTool() {
	return {
		name: "TaskGet",
		label: "Get Task",
		description: "Retrieve a task by its ID, showing full details including blocks/blockedBy.",
		parameters: taskGetSchema,

		guidance: `Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.`,

		async execute(
			_toolCallId: string,
			params: TaskGetInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const task = await getTask(ctx.agentDir, DEFAULT_TASK_LIST_ID, params.taskId);

				if (!task) {
					return {
						content: [{ type: "text", text: "Task not found" }],
						details: { task: null },
					};
				}

				const lines = [
					`Task #${task.id}: ${task.subject}`,
					`Status: ${task.status}`,
					`Description: ${task.description}`,
				];
				if (task.owner) lines.push(`Owner: ${task.owner}`);
				if (task.activeForm) lines.push(`Active form: ${task.activeForm}`);
				if (task.blockedBy.length > 0) {
					lines.push(`Blocked by: ${task.blockedBy.map(id => `#${id}`).join(", ")}`);
				}
				if (task.blocks.length > 0) {
					lines.push(`Blocks: ${task.blocks.map(id => `#${id}`).join(", ")}`);
				}

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: {
						task: {
							id: task.id,
							subject: task.subject,
							description: task.description,
							status: task.status,
							blocks: task.blocks,
							blockedBy: task.blockedBy,
						},
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { error: message },
				};
			}
		},
	};
}
