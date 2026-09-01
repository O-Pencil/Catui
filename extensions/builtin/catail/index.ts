/**
 * [WHO]: catailExtension - exposes Catui's evidence-traceable scientific workflow skill
 * [FROM]: Depends on node:fs, node:path, node:url, and core/extensions-host/types
 * [TO]: Auto-loaded by builtin-extensions.ts; ResourceLoader discovers SKILL.md through resources_discover
 * [HERE]: extensions/builtin/catail/index.ts - passive CATAIL skill bundle wrapper
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "../../../core/extensions-host/types.js";

const CATAIL_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = join(CATAIL_DIR, "SKILL.md");

export const CATAIL_BOOTSTRAP_PROMPT = [
	"## CATAIL Research Workflow",
	"",
	"Catui bundles the `catail` skill for evidence-traceable scientific work. Load it through the Skill tool when the user is framing a research question, mapping literature or claims, designing or running a study, analyzing results, producing scientific figures or writing, or reviewing research quality.",
	"",
	"CATAIL treats project artifacts as the durable source of truth. Model output, search snippets, hypotheses, and fluent drafts are not evidence, and scientific or ethics decisions remain with accountable humans.",
].join("\n");

export default async function catailExtension(api: ExtensionAPI): Promise<void> {
	api.on("resources_discover", () => {
		if (!existsSync(SKILL_FILE)) {
			return;
		}
		return { skillPaths: [SKILL_FILE] };
	});

	api.on("before_agent_start", () => {
		if (!existsSync(SKILL_FILE)) {
			return;
		}
		return { appendSystemPrompt: CATAIL_BOOTSTRAP_PROMPT };
	});
}
