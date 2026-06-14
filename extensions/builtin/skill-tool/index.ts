/**
 * [WHO]: skillToolExtension - registers Skill tool for LLM-callable skill invocation
 * [FROM]: Depends on ./skill-tool
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/builtin/skill-tool/index.ts
 */

import type { ExtensionAPI } from "../../../core/extensions-host/types.js";
import { createSkillTool } from "./skill-tool.js";

export default function skillToolExtension(api: ExtensionAPI): void {
	api.registerTool(createSkillTool());
}
