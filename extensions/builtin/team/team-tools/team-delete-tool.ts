/**
 * [WHO]: TeamDelete tool - delete the current agent team
 * [FROM]: Claude Code TeamDeleteTool (aligned)
 * [TO]: Consumed by team extension via registerTool()
 * [HERE]: extensions/builtin/team/team-tools/team-delete-tool.ts
 */

import { Type } from "@sinclair/typebox";
import type { AgentToolResult } from "@catui/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import type { TeamRuntime } from "../team-runtime.js";

const teamDeleteSchema = Type.Object({});

export function createTeamDeleteTool(getRuntime: () => TeamRuntime) {
	return {
		name: "TeamDelete",
		label: "Team Delete",
		description: "Delete the current agent team and terminate all teammates.",
		parameters: teamDeleteSchema,

		guidance: `Use TeamDelete to remove the current team and terminate all teammates.

- Fails if teammates are still running (stop them first)
- Cleans up all team resources including worktrees`,

		async execute(
			_toolCallId: string,
			_params: Record<string, never>,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			_ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			const runtime = getRuntime();

			try {
				const teammates = runtime.getAllTeammates();
				if (teammates.length === 0) {
					return {
						content: [{
							type: "text",
							text: JSON.stringify({ success: false, message: "No active team to delete." }),
						}],
						details: undefined,
					};
				}

				const running = teammates.filter((t) => t.status === "running");
				if (running.length > 0) {
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								success: false,
								message: `${running.length} teammate(s) still running. Stop them first with /team:stop or TaskStop.`,
								team_name: running.map((t) => t.identity.name).join(", "),
							}),
						}],
						details: undefined,
					};
				}

				let terminated = 0;
				for (const teammate of teammates) {
					const ok = await runtime.terminate(teammate.identity.name);
					if (ok) terminated++;
				}

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							success: true,
							message: `Terminated ${terminated} teammate(s). Team deleted.`,
						}),
					}],
					details: undefined,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Failed to delete team: ${message}` }],
					details: undefined,
				};
			}
		},
	};
}
