/**
 * [WHO]: typesafeExtension discovers TypeSafe skills and supplies bounded decision guidance
 * [FROM]: node:path/url and the extension API type; no service or model calls
 * [TO]: Default extension loader and resource discovery across all modes
 * [HERE]: extensions/builtin/typesafe/index.ts - passive decision/tool/evaluation guidance
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "../../../core/extensions-host/types.js";

const skillsPath = join(dirname(fileURLToPath(import.meta.url)), "skills");

export const DECISION_GUIDANCE = [
  "## Decision, tool, evaluation loop",
  "Before a tool call, name the missing evidence or intended change and the result that would justify the next step. Answer directly when no tool is needed.",
  "Pick the narrowest suitable tool; ground its arguments in observed state and its schema. Keep facts separate from assumptions. Batch independent reads; sequence dependent work and writes.",
  "After results arrive, check errors, evidence freshness and progress toward the user's acceptance criteria before acting again. A successful call or typed output does not prove task success.",
  "If an attempt makes no progress, change the hypothesis, inputs or approach; do not repeat unchanged calls. Stop when complete or name the concrete blocker. Uncertainty is not permission for side effects.",
].join("\n");

export default function typesafeExtension(api: ExtensionAPI): void {
  api.on("resources_discover", () => ({ skillPaths: [skillsPath] }));
  api.on("before_agent_start", () => ({ appendSystemPrompt: DECISION_GUIDANCE }));
}
