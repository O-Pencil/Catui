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
import { Container, Text, type Component } from "@pencil-agent/tui";
import type { Theme } from "../../../../core/theme-contract.js";
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

		renderCall: (_args: unknown, theme: Theme): Component => {
			const container = new Container();
			container.addChild(new Text(theme.fg("toolTitle", theme.bold("TaskList")), 0, 0));
			container.addChild(new Text(theme.fg("muted", "  Retrieving all tasks..."), 0, 0));
			return container;
		},

		renderResult: (result: AgentToolResult<unknown>, _opts: { expanded: boolean; isPartial: boolean }, theme: Theme): Component => {
			const container = new Container();
			const details = result.details as { tasks?: Array<{ id: string; subject: string; status: string; owner?: string; blockedBy: string[] }>; error?: string } | undefined;
			if (details?.error) {
				container.addChild(new Text(theme.fg("error", "  " + details.error), 0, 0));
			} else if (details?.tasks && details.tasks.length > 0) {
				container.addChild(new Text(theme.fg("success", `  ${details.tasks.length} task(s):`), 0, 0));
				for (const task of details.tasks) {
					const statusColor = task.status === "completed" ? "success" : task.status === "in_progress" ? "accent" : "muted";
					const statusText = theme.fg(statusColor, task.status);
					const ownerText = task.owner ? theme.fg("muted", ` (${task.owner})`) : "";
					const blockedText = task.blockedBy.length > 0 ? theme.fg("warning", ` [blocked by ${task.blockedBy.map(id => `#${id}`).join(", ")}]`) : "";
					container.addChild(new Text(`  #${task.id} ${statusText} ${theme.fg("text", task.subject)}${ownerText}${blockedText}`, 0, 0));
				}
			} else {
				const textOut = result.content?.filter((c) => c.type === "text").map((c) => c.type === "text" ? c.text : "").join("\n");
				if (textOut) container.addChild(new Text(theme.fg("toolOutput", textOut), 0, 0));
			}
			return container;
		},

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
