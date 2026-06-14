/**
 * [WHO]: TeamCreate tool - create a multi-agent team
 * [FROM]: Claude Code TeamCreateTool (aligned)
 * [TO]: Consumed by team extension via registerTool()
 * [HERE]: extensions/builtin/team/team-tools/team-create-tool.ts
 */

import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@catui/agent-core";
import type { ExtensionContext } from "../../../../core/extensions-host/types.js";
import type { TeamRuntime } from "../team-runtime.js";

const teamCreateSchema = Type.Object({
	team_name: Type.String({ description: "Name for the new team to create." }),
	description: Type.Optional(Type.String({ description: "Team description/purpose." })),
	agent_type: Type.Optional(Type.String({ description: "Type/role of the team lead" })),
});

export type TeamCreateInput = Static<typeof teamCreateSchema>;

export function createTeamCreateTool(getRuntime: () => TeamRuntime) {
	return {
		name: "TeamCreate",
		label: "Team Create",
		description: "Create a new agent team with a leader agent.",
		parameters: teamCreateSchema,

		guidance: `Use TeamCreate to create a multi-agent team for complex tasks.

- team_name: A descriptive name for the team
- description: Optional team purpose/description
- agent_type: Optional role type for the team lead`,

		async execute(
			_toolCallId: string,
			params: TeamCreateInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			const runtime = getRuntime();

			try {
				const existing = runtime.getAllTeammates();
				if (existing.length > 0) {
					return {
						content: [{
							type: "text",
							text: `A team already exists with ${existing.length} teammate(s). Use TeamDelete first to remove the existing team, or use /team:spawn to add teammates.`,
						}],
						details: undefined,
					};
				}

				const teammate = await runtime.spawn({
					role: (params.agent_type as any) ?? "generic",
					name: params.team_name,
					baseCwd: ctx.cwd,
				});

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							team_name: params.team_name,
							lead_agent_id: teammate.identity.id,
						}),
					}],
					details: undefined,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Failed to create team: ${message}` }],
					details: undefined,
				};
			}
		},
	};
}
