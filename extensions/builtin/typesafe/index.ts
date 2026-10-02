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
  "Before a tool call, identify the missing evidence or intended change and the result that would justify the next step. Answer directly when no tool is needed.",
  "Choose an available tool with the narrowest suitable scope; ground its arguments in observed state and its schema. Keep facts separate from assumptions. Batch independent reads; sequence dependent work and writes.",
  "After results arrive, check errors, evidence freshness and progress toward the user's acceptance criteria before acting again. Verify changed behavior with a proportionate check. A successful call or typed output alone does not prove task success.",
  "If an attempt makes no progress, inspect the failure and change the hypothesis, inputs or approach; do not repeat unchanged calls indefinitely. Stop when complete or explain the concrete blocker. Uncertainty is not permission for side effects.",
  "For complex tool workflows, load agent-decision-loop. For TypeSafe System One integrations, load typesafe-ai and its current docs. Ordinary Catui work needs no TypeSafe API call. Follow explicit user instructions.",
].join("\n");

export default function typesafeExtension(api: ExtensionAPI): void {
  api.on("resources_discover", () => ({ skillPaths: [skillsPath] }));
  api.on("before_agent_start", () => ({ appendSystemPrompt: DECISION_GUIDANCE }));
}
