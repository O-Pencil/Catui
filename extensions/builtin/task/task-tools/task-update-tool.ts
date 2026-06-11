/**
 * [WHO]: TaskUpdate tool - updates a task's fields, status, and block relationships
 * [FROM]: Depends on @sinclair/typebox, ../task-store, ../task-types
 * [TO]: Consumed by task extension via registerTool()
 * [HERE]: extensions/builtin/task/task-tools/task-update-tool.ts
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { Container, Text, type Component } from "@pencil-agent/tui";
import type { Theme } from "../../../../core/theme-contract.js";
import { blockTask, deleteTask, getTask, updateTask, listTasks } from "../task-store.js";
import { DEFAULT_TASK_LIST_ID, TaskStatusValues } from "../task-types.js";
import type { TaskStatus, TaskUpdateStatus } from "../task-types.js";

const taskUpdateSchema = Type.Object({
	taskId: Type.String({ description: "The ID of the task to update" }),
	subject: Type.Optional(Type.String({ description: "New subject for the task" })),
	description: Type.Optional(Type.String({ description: "New description for the task" })),
	activeForm: Type.Optional(
		Type.String({
			description:
				'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
		}),
	),
	status: Type.Optional(
		Type.Union(
			[...TaskStatusValues, "deleted"].map(s => Type.Literal(s)),
			{ description: "New status for the task. Use 'deleted' to remove the task." },
		),
	),
	owner: Type.Optional(Type.String({ description: "New owner for the task" })),
	metadata: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Metadata keys to merge into the task. Set a key to null to delete it.",
		}),
	),
	addBlocks: Type.Optional(
		Type.Array(Type.String(), { description: "Task IDs that this task blocks" }),
	),
	addBlockedBy: Type.Optional(
		Type.Array(Type.String(), { description: "Task IDs that block this task" }),
	),
});

export type TaskUpdateInput = Static<typeof taskUpdateSchema>;

export function createTaskUpdateTool() {
	return {
		name: "TaskUpdate",
		label: "Update Task",
		description:
			"Update a task's fields, status, metadata, and block relationships. Use status='deleted' to remove a task.",
		parameters: taskUpdateSchema,

		renderCall: (args: unknown, theme: Theme): Component => {
			const a = args as TaskUpdateInput;
			const container = new Container();
			container.addChild(new Text(theme.fg("toolTitle", theme.bold("TaskUpdate")), 0, 0));
			container.addChild(new Text(theme.fg("muted", "  Task #") + theme.fg("text", a.taskId ?? "?"), 0, 0));
			if (a.status) {
				const color = a.status === "completed" ? "success" : a.status === "deleted" ? "error" : "accent";
				container.addChild(new Text(theme.fg("muted", "  Status → ") + theme.fg(color, a.status), 0, 0));
			}
			if (a.subject) {
				container.addChild(new Text(theme.fg("muted", "  Subject: ") + theme.fg("text", a.subject), 0, 0));
			}
			return container;
		},

		renderResult: (result: AgentToolResult<unknown>, _opts: { expanded: boolean; isPartial: boolean }, theme: Theme): Component => {
			const container = new Container();
			const details = result.details as { task?: { id: string; subject: string; status: string }; error?: string; deleted?: boolean } | undefined;
			if (details?.error) {
				container.addChild(new Text(theme.fg("error", "  " + details.error), 0, 0));
			} else if (details?.deleted) {
				container.addChild(new Text(theme.fg("success", "  Task deleted"), 0, 0));
			} else if (details?.task) {
				container.addChild(
					new Text(theme.fg("success", `  Task #${details.task.id} updated`) + theme.fg("muted", " — ") + theme.fg("text", details.task.subject), 0, 0),
				);
			} else {
				const textOut = result.content?.filter((c) => c.type === "text").map((c) => c.type === "text" ? c.text : "").join("\n");
				if (textOut) container.addChild(new Text(theme.fg("toolOutput", textOut), 0, 0));
			}
			return container;
		},

		guidance: `Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to \`deleted\` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: \`pending\` → \`in_progress\` → \`completed\`

Use \`deleted\` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using \`TaskGet\` before updating it.

## Examples

Mark task as in progress when starting work:
\`\`\`json
{"taskId": "1", "status": "in_progress"}
\`\`\`

Mark task as completed after finishing work:
\`\`\`json
{"taskId": "1", "status": "completed"}
\`\`\`

Delete a task:
\`\`\`json
{"taskId": "1", "status": "deleted"}
\`\`\`

Claim a task by setting owner:
\`\`\`json
{"taskId": "1", "owner": "my-name"}
\`\`\`

Set up task dependencies:
\`\`\`json
{"taskId": "2", "addBlockedBy": ["1"]}
\`\`\``,

		async execute(
			_toolCallId: string,
			params: TaskUpdateInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const taskListId = DEFAULT_TASK_LIST_ID;
				const existingTask = await getTask(ctx.agentDir, taskListId, params.taskId);
				if (!existingTask) {
					return {
						content: [{ type: "text", text: `Task #${params.taskId} not found` }],
						details: { success: false, taskId: params.taskId, updatedFields: [], error: "Task not found" },
					};
				}

				const updatedFields: string[] = [];
				const updates: Partial<{
					subject: string;
					description: string;
					activeForm: string;
					status: TaskStatus;
					owner: string;
					metadata: Record<string, unknown>;
				}> = {};

				// Update basic fields
				if (params.subject !== undefined && params.subject !== existingTask.subject) {
					updates.subject = params.subject;
					updatedFields.push("subject");
				}
				if (params.description !== undefined && params.description !== existingTask.description) {
					updates.description = params.description;
					updatedFields.push("description");
				}
				if (params.activeForm !== undefined && params.activeForm !== existingTask.activeForm) {
					updates.activeForm = params.activeForm;
					updatedFields.push("activeForm");
				}
				if (params.owner !== undefined && params.owner !== existingTask.owner) {
					updates.owner = params.owner;
					updatedFields.push("owner");
				}

				// Metadata merge
				if (params.metadata !== undefined) {
					const merged = { ...(existingTask.metadata ?? {}) };
					for (const [key, value] of Object.entries(params.metadata)) {
						if (value === null) {
							delete merged[key];
						} else {
							merged[key] = value;
						}
					}
					updates.metadata = merged;
					updatedFields.push("metadata");
				}

				// Status handling
				if (params.status !== undefined) {
					if (params.status === "deleted") {
						const deleted = await deleteTask(ctx.agentDir, taskListId, params.taskId);
						return {
							content: [
								{
									type: "text",
									text: deleted
										? `Deleted task #${params.taskId}`
										: `Failed to delete task #${params.taskId}`,
								},
							],
							details: {
								success: deleted,
								taskId: params.taskId,
								updatedFields: deleted ? ["deleted"] : [],
								statusChange: deleted ? { from: existingTask.status, to: "deleted" } : undefined,
							},
						};
					}

					if (params.status !== existingTask.status) {
						updates.status = params.status as TaskStatus;
						updatedFields.push("status");
					}
				}

				// Apply updates
				if (Object.keys(updates).length > 0) {
					await updateTask(ctx.agentDir, taskListId, params.taskId, updates);
				}

				// Handle blocks
				if (params.addBlocks && params.addBlocks.length > 0) {
					const newBlocks = params.addBlocks.filter(id => !existingTask.blocks.includes(id));
					for (const blockId of newBlocks) {
						await blockTask(ctx.agentDir, taskListId, params.taskId, blockId);
					}
					if (newBlocks.length > 0) updatedFields.push("blocks");
				}

				// Handle blockedBy (reverse: the blocker blocks this task)
				if (params.addBlockedBy && params.addBlockedBy.length > 0) {
					const newBlockedBy = params.addBlockedBy.filter(id => !existingTask.blockedBy.includes(id));
					for (const blockerId of newBlockedBy) {
						await blockTask(ctx.agentDir, taskListId, blockerId, params.taskId);
					}
					if (newBlockedBy.length > 0) updatedFields.push("blockedBy");
				}

				// Build result
				const statusChange =
					params.status !== undefined && params.status !== existingTask.status && params.status !== "deleted"
						? { from: existingTask.status, to: params.status }
						: undefined;

				let resultContent = `Updated task #${params.taskId} ${updatedFields.join(", ")}`;

				// Verification nudge: if all tasks are completed and no verification step exists
				if (updates.status === "completed") {
					const allTasks = await listTasks(ctx.agentDir, taskListId);
					const allDone = allTasks.every(t => t.status === "completed");
					if (allDone && allTasks.length >= 3 && !allTasks.some(t => /verif/i.test(t.subject))) {
						resultContent +=
							"\n\nNOTE: You just closed out 3+ tasks and none of them was a verification step. Before writing your final summary, verify your work.";
					}
				}

				return {
					content: [{ type: "text", text: resultContent }],
					details: {
						success: true,
						taskId: params.taskId,
						updatedFields,
						statusChange,
					},
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Error: ${message}` }],
					details: { success: false, taskId: params.taskId, updatedFields: [], error: message },
				};
			}
		},
	};
}
