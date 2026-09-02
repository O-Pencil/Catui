/**
 * [WHO]: catailExtension - exposes Catui's professional research-to-publication Skill
 * [FROM]: Depends on node:fs, node:path, node:url, and core/extensions-host/types
 * [TO]: Auto-loaded by builtin-extensions.ts; ResourceLoader discovers SKILL.md through resources_discover
 * [HERE]: extensions/builtin/catail/index.ts - passive CATAIL research-to-publication Skill wrapper
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "../../../core/extensions-host/types.js";

const CATAIL_DIR = dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = join(CATAIL_DIR, "SKILL.md");

export const CATAIL_BOOTSTRAP_PROMPT = [
	"## CATAIL — Professional Research-to-Publication Skill",
	"",
	"Catui bundles the `catail` Skill for professional scientific work. Load it when the user explicitly invokes `/skill:catail`, explicitly asks to use CATAIL, or the active persona is Athena and the request has scientific intent. Outside Athena, do not infer activation from words such as research, paper, discovery, test, experiment, evidence, analysis, or their translations; ordinary coding remains Catui's default behavior.",
	"",
	"Athena's ordinary coding, debugging, maintenance, and administrative work does not require a research workflow. When activated, follow the Skill's task, method, lifecycle, stop-boundary, and language routing. Preserve the distinction between observation, hypothesis, evidence, claim, and conclusion; do not strengthen claims during translation or writing.",
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
