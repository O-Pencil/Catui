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
import { Container, Text, type Component } from "@pencil-agent/tui";
import type { Theme } from "../../../../core/theme-contract.js";
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

		renderCall: (args: unknown, theme: Theme): Component => {
			const a = args as TaskGetInput;
			const container = new Container();
			container.addChild(new Text(theme.fg("toolTitle", theme.bold("TaskGet")), 0, 0));
			container.addChild(new Text(theme.fg("muted", "  Task #") + theme.fg("text", a.taskId ?? "?"), 0, 0));
			return container;
		},

		renderResult: (result: AgentToolResult<unknown>, _opts: { expanded: boolean; isPartial: boolean }, theme: Theme): Component => {
			const container = new Container();
			const details = result.details as { task?: { id: string; subject: string; description: string; status: string; blocks: string[]; blockedBy: string[] }; taskNull?: true; error?: string } | undefined;
			if (details?.error) {
				container.addChild(new Text(theme.fg("error", "  " + details.error), 0, 0));
			} else if (details?.taskNull) {
				container.addChild(new Text(theme.fg("muted", "  Task not found"), 0, 0));
			} else if (details?.task) {
				const t = details.task;
				const statusColor = t.status === "completed" ? "success" : t.status === "in_progress" ? "accent" : "muted";
				container.addChild(new Text(theme.fg("toolTitle", `  #${t.id}`) + " " + theme.fg("text", t.subject), 0, 0));
				container.addChild(new Text(theme.fg("muted", "  Status: ") + theme.fg(statusColor, t.status), 0, 0));
				if (t.description) {
					const desc = t.description.length > 300 ? t.description.slice(0, 300) + "..." : t.description;
					container.addChild(new Text(theme.fg("muted", "  ") + theme.fg("toolOutput", desc), 0, 0));
				}
				if (t.blockedBy.length > 0) {
					container.addChild(new Text(theme.fg("warning", `  Blocked by: ${t.blockedBy.map(id => `#${id}`).join(", ")}`), 0, 0));
				}
				if (t.blocks.length > 0) {
					container.addChild(new Text(theme.fg("muted", `  Blocks: ${t.blocks.map(id => `#${id}`).join(", ")}`), 0, 0));
				}
			} else {
				const textOut = result.content?.filter((c) => c.type === "text").map((c) => c.type === "text" ? c.text : "").join("\n");
				if (textOut) container.addChild(new Text(theme.fg("toolOutput", textOut), 0, 0));
			}
			return container;
		},

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
