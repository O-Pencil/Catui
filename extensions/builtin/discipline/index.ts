/**
 * [WHO]: disciplineExtension - registers Catui engineering discipline skills and a lightweight bootstrap prompt
 * [FROM]: Depends on node:path, node:url, node:fs, core/extensions-host/types
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension; consumed by ResourceLoader via resources_discover
 * [HERE]: extensions/builtin/discipline/index.ts - default engineering workflow discipline package
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "../../../core/extensions-host/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "skills");

const DISCIPLINE_SKILLS = [
	"interview",
	"domain-modeling",
	"handoff",
	"systematic-debugging",
	"test-driven-development",
	"writing-plans",
	"executing-plans",
	"requesting-code-review",
	"receiving-code-review",
	"using-git-worktrees",
	"finishing-development-branch",
] as const;

const BOOTSTRAP_PROMPT = [
	"## Catui Engineering Discipline",
	"",
	"Catui ships default discipline skills for coding work. Treat them as executable workflow guidance, not background reading.",
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

export default async function disciplineExtension(api: ExtensionAPI): Promise<void> {
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
