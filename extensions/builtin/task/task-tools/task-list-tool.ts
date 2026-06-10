/**
 * [WHO]: TaskList tool - lists all tasks in the task list
 * [FROM]: Depends on @sinclair/typebox, ../task-store, ../task-types
 * [TO]: Consumed by task extension via registerTool()
 * [HERE]: extensions/builtin/task/task-tools/task-list-tool.ts
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { listTasks } from "../task-store.js";
import { DEFAULT_TASK_LIST_ID } from "../task-types.js";

const taskListSchema = Type.Object({});
export type TaskListInput = Static<typeof taskListSchema>;

export function createTaskListTool() {
	return {
		name: "TaskList",
		label: "List Tasks",
		description: "List all tasks in the task list with their status and dependencies.",
		parameters: taskListSchema,

		guidance: `Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.`,

		async execute(
			_toolCallId: string,
			_params: TaskListInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const allTasks = (await listTasks(ctx.agentDir, DEFAULT_TASK_LIST_ID)).filter(
					t => !(t.metadata as Record<string, unknown>)?._internal,
				);

				if (allTasks.length === 0) {
					return {
						content: [{ type: "text", text: "No tasks found" }],
						details: { tasks: [] },
					};
				}

				// Build set of resolved task IDs for filtering blockers
				const resolvedTaskIds = new Set(
					allTasks.filter(t => t.status === "completed").map(t => t.id),
				);

				const tasks = allTasks.map(task => ({
					id: task.id,
					subject: task.subject,
					status: task.status,
					owner: task.owner,
					blockedBy: task.blockedBy.filter(id => !resolvedTaskIds.has(id)),
				}));

				const lines = tasks.map(task => {
					const owner = task.owner ? ` (${task.owner})` : "";
					const blocked =
						task.blockedBy.length > 0
							? ` [blocked by ${task.blockedBy.map(id => `#${id}`).join(", ")}]`
							: "";
					return `#${task.id} [${task.status}] ${task.subject}${owner}${blocked}`;
				});

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { tasks },
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
