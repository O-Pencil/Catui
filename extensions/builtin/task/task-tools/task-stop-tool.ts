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
import { Container, Text, type Component } from "@pencil-agent/tui";
import type { Theme } from "../../../../core/theme-contract.js";
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

		renderCall: (args: unknown, theme: Theme): Component => {
			const a = args as TaskStopInput;
			const container = new Container();
			container.addChild(new Text(theme.fg("toolTitle", theme.bold("TaskStop")), 0, 0));
			container.addChild(new Text(theme.fg("muted", "  Stopping task #") + theme.fg("text", a.task_id ?? "?"), 0, 0));
			return container;
		},

		renderResult: (result: AgentToolResult<unknown>, _opts: { expanded: boolean; isPartial: boolean }, theme: Theme): Component => {
			const container = new Container();
			const details = result.details as { success?: boolean; task_id?: string; message?: string; error?: string } | undefined;
			if (details?.error) {
				container.addChild(new Text(theme.fg("error", "  " + details.error), 0, 0));
			} else if (details?.success) {
				container.addChild(
					new Text(theme.fg("success", "  Task #") + theme.fg("text", details.task_id ?? "?") + theme.fg("success", " stopped"), 0, 0),
				);
			} else {
				const textOut = result.content?.filter((c) => c.type === "text").map((c) => c.type === "text" ? c.text : "").join("\n");
				if (textOut) container.addChild(new Text(theme.fg("toolOutput", textOut), 0, 0));
			}
			return container;
		},

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
