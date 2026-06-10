/**
 * CronList tool — lists all scheduled cron tasks.
 *
 * 1:1 port of Claude Code src/tools/ScheduleCronTool/CronListTool.ts
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import { cronToHuman, listAllCronTasks } from "../cron/index.js";
import {
	buildCronListPrompt,
	CRON_LIST_DESCRIPTION,
	CRON_LIST_TOOL_NAME,
	isDurableCronEnabled,
} from "./prompt.js";

const cronListSchema = Type.Object({});
export type CronListInput = Static<typeof cronListSchema>;

/**
 * Truncate a string to `maxLen` characters, appending "…" if truncated.
 * Matches CC's truncate utility.
 */
function truncate(str: string, maxLen: number, _ellipsis?: boolean): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen - 1) + "…";
}

export function createCronListTool() {
	return {
		name: CRON_LIST_TOOL_NAME,
		label: "List Scheduled Tasks",
		searchHint: "list active cron jobs",
		description: CRON_LIST_DESCRIPTION,
		parameters: cronListSchema,

		guidance: buildCronListPrompt(isDurableCronEnabled()),

		async execute(
			_toolCallId: string,
			_params: CronListInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			try {
				const allTasks = await listAllCronTasks(ctx.agentDir);

				if (allTasks.length === 0) {
					return {
						content: [{ type: "text", text: "No scheduled jobs." }],
						details: { jobs: [] },
					};
				}

				const jobs = allTasks.map((t) => ({
					id: t.id,
					cron: t.cron,
					humanSchedule: cronToHuman(t.cron),
					prompt: t.prompt,
					...(t.recurring ? { recurring: true } : {}),
					...(t.durable === false ? { durable: false } : {}),
				}));

				const text = jobs
					.map(
						(j) =>
							`${j.id} — ${j.humanSchedule}${j.recurring ? " (recurring)" : " (one-shot)"}${j.durable === false ? " [session-only]" : ""}: ${truncate(j.prompt, 80, true)}`,
					)
					.join("\n");

				return {
					content: [{ type: "text", text }],
					details: { jobs },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [
						{
							type: "text",
							text: `Error: Failed to list scheduled tasks: ${message}`,
						},
					],
					details: { error: message },
				};
			}
		},
	};
}
