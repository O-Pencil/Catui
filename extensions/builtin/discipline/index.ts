/**
 * [WHO]: disciplineExtension - registers skill tool, nanoPencil engineering discipline skills, and lightweight bootstrap prompt
 * [FROM]: Depends on node:path, node:url, node:fs, core/extensions-host/types
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension; consumed by ResourceLoader via resources_discover
 * [HERE]: extensions/builtin/discipline/index.ts - default engineering workflow discipline package
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import type { ExtensionAPI, ExtensionContext } from "../../../core/extensions-host/types.js";
import { stripFrontmatter } from "../../../utils/frontmatter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "skills");

const DISCIPLINE_SKILLS = [
	"brainstorming",
	"systematic-debugging",
	"test-driven-development",
	"verification-before-completion",
	"writing-plans",
	"executing-plans",
	"requesting-code-review",
	"receiving-code-review",
	"using-git-worktrees",
	"finishing-development-branch",
] as const;

const BOOTSTRAP_PROMPT = [
	"## nanoPencil Engineering Discipline",
	"",
	"nanoPencil ships default discipline skills for coding work. Treat them as executable workflow guidance, not background reading.",
	"",
	"Before taking action, check whether one of these skills applies. If it does, call the `skill` tool or load the matching SKILL.md before other tool use or implementation:",
	DISCIPLINE_SKILLS.map((name) => `- ${name}`).join("\n"),
	"",
	"Hard gates:",
	"- Feature or behavior changes start with design clarification when intent, scope, trade-offs, or acceptance criteria are not already explicit.",
	"- Bugs, test failures, build failures, and unexpected behavior require root-cause investigation before fixes.",
	"- Production code changes require a failing test first unless the user explicitly accepts a documented exception.",
	"- Completion claims require fresh verification evidence from commands, tests, diffs, or runtime behavior.",
	"",
	"User instructions still define the goal and may override workflow details. If a skill conflicts with explicit user direction, follow the user and state the trade-off.",
].join("\n");

const SkillToolInputSchema = Type.Object(
	{
		name: Type.Optional(Type.String({ description: "Exact skill name to load. Omit to list available skills." })),
	},
	{ additionalProperties: false },
);

type SkillToolInput = Static<typeof SkillToolInputSchema>;

function createSkillTool() {
	return {
		name: "skill",
		label: "Load Skill",
		description:
			"List or load currently available nanoPencil skills. Call this before acting when a skill description matches the task.",
		parameters: SkillToolInputSchema,
		isConcurrencySafe: true,
		guidance:
			"Use skill to inspect available workflow instructions. Call with no name to list skills, or with an exact name to load the full skill content.",

		async execute(
			_toolCallId: string,
			params: SkillToolInput,
			_signal: AbortSignal | undefined,
			_onUpdate: undefined,
			ctx: ExtensionContext,
		): Promise<AgentToolResult<unknown>> {
			const skills = [...ctx.getSkills()].sort((a, b) => a.name.localeCompare(b.name));
			const name = params.name?.trim();

			if (!name) {
				const lines = [
					`Available skills (${skills.length}):`,
					"",
					...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
				];
				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { skills: skills.map(({ name, description, filePath, source }) => ({ name, description, filePath, source })) },
				};
			}

			const skill = skills.find((candidate) => candidate.name === name);
			if (!skill) {
				return {
					content: [
						{
							type: "text",
							text: `Skill not found: ${name}\n\nCall skill with no name to list available skills.`,
						},
					],
					details: { error: "not_found", name },
				};
			}

			try {
				const body = stripFrontmatter(readFileSync(skill.filePath, "utf-8")).trim();
				const text = [
					`<skill name="${skill.name}" location="${skill.filePath}">`,
					`References are relative to ${skill.baseDir}.`,
					"",
					body,
					"</skill>",
				].join("\n");
				return {
					content: [{ type: "text", text }],
					details: { name: skill.name, filePath: skill.filePath, source: skill.source },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Failed to load skill "${skill.name}": ${message}` }],
					details: { error: message, name: skill.name, filePath: skill.filePath },
				};
			}
		},
	};
}

export default async function disciplineExtension(api: ExtensionAPI): Promise<void> {
	api.registerTool(createSkillTool());

	api.on("resources_discover", () => {
		if (!existsSync(SKILLS_DIR)) {
			return;
		}
		return { skillPaths: [SKILLS_DIR] };
	});

	api.on("before_agent_start", () => {
		if (!existsSync(SKILLS_DIR)) {
			return;
		}
		return { appendSystemPrompt: BOOTSTRAP_PROMPT };
	});
}
