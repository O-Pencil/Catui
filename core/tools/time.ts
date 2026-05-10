/**
 * [WHO]: TimeTool, timeTool, createTimeTool
 * [FROM]: Depends on agent-core, typebox
 * [TO]: Consumed by core/tools/index.ts
 * [HERE]: core/tools/time.ts - current time tool
 */
import type { AgentTool } from "@pencil-agent/agent-core";
import { type Static, Type } from "@sinclair/typebox";

const timeSchema = Type.Object({
	timeZone: Type.Optional(
		Type.String({
			description: "Optional IANA time zone like Asia/Shanghai or America/Los_Angeles",
		}),
	),
	locale: Type.Optional(
		Type.String({
			description: "Optional locale like en-US or zh-CN for formatting",
		}),
	),
});

export type TimeToolInput = Static<typeof timeSchema>;

function formatTimeSnapshot(timeZone?: string, locale = "en-US"): string {
	const now = new Date();
	const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	const resolvedTimeZone = timeZone || systemTimeZone;
	const iso = now.toISOString();
	const local = now.toLocaleString(locale, {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		timeZone: resolvedTimeZone,
		timeZoneName: "short",
	});

	return [
		`Current system time: ${iso}`,
		`Formatted time: ${local}`,
		`Time zone: ${resolvedTimeZone}`,
		`Epoch ms: ${now.getTime()}`,
	].join("\n");
}

export function createTimeTool(): AgentTool<typeof timeSchema> {
	return {
		name: "time",
		label: "time",
		description:
			"Get the current system time. You must use this for time-sensitive questions such as 'what time is it', 'what day is it', 'today', 'tomorrow', 'yesterday', deadlines, schedules, elapsed time, or any request that depends on the real current date/time instead of prompt context.",
		parameters: timeSchema,
		isConcurrencySafe: true,
		execute: async (_toolCallId, { timeZone, locale }: TimeToolInput) => {
			return {
				content: [{ type: "text", text: formatTimeSnapshot(timeZone, locale) }],
				details: {
					timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
					locale: locale || "en-US",
				},
			};
		},
	};
}

export const timeTool = createTimeTool();
