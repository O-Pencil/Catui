/**
 * [WHO]: Skill tool - LLM-callable skill invocation
 * [FROM]: Claude Code Skill tool (aligned)
 * [TO]: Consumed by skill-tool extension via registerTool()
 * [HERE]: extensions/builtin/skill-tool/skill-tool.ts
 *
 * Allows the LLM to proactively invoke skills (slash commands)
 * by name, returning the skill content as a tool result.
 */

import { readFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@catui/agent-core";
import type { ExtensionContext } from "../../../core/extensions-host/types.js";
import { stripFrontmatter } from "../../../utils/frontmatter.js";

const skillInputSchema = Type.Object({
	skill: Type.String({ description: "The name of the skill to invoke" }),
	args: Type.Optional(Type.String({ description: "Optional arguments to pass to the skill" })),
});

export type SkillInput = Static<typeof skillInputSchema>;

export function createSkillTool() {
	return {
		name: "Skill",
		label: "Skill",
		description:
			"Invoke a skill (slash command) by name and return its content. Use this to load skill instructions before following them.",
		parameters: skillInputSchema,

		guidance: `Use the Skill tool to invoke a named skill and get its instructions.

- Takes a skill name (without the /skill: prefix) and optional args
- Returns the skill's content wrapped in <skill> XML tags
- Use this before following skill instructions to ensure you have the full content
- Available skills are listed in the system prompt under <available_skills>`,

		async execute(
			_toolCallId: string,
			params: SkillInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			const skills = ctx.getSkills();
			const skill = skills.find((s) => s.name === params.skill);

			if (!skill) {
				const available = skills.map((s) => s.name).join(", ");
				return {
					content: [{
						type: "text",
						text: `Skill not found: "${params.skill}"\n\nAvailable skills: ${available || "(none)"}`,
					}],
					details: undefined,
				};
			}

			if (skill.disableModelInvocation) {
				return {
					content: [{
						type: "text",
						text: `Skill "${params.skill}" has model invocation disabled and cannot be called by the LLM.`,
					}],
					details: undefined,
				};
			}

			try {
				const content = readFileSync(skill.filePath, "utf-8");
				const body = stripFrontmatter(content).trim();
				const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
				const result = params.args ? `${skillBlock}\n\n${params.args}` : skillBlock;

				return {
					content: [{ type: "text", text: result }],
					details: undefined,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Failed to read skill "${params.skill}": ${message}` }],
					details: undefined,
				};
			}
		},
	};
}
