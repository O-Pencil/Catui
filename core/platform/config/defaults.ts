/**
 * [WHO]: DEFAULT_THINKING_LEVEL
 * [FROM]: Depends on agent-core
 * [TO]: Consumed by main.ts, core/runtime/sdk.ts, core/runtime/agent-session.ts, core/model-resolver.ts
 * [HERE]: core/platform/config/defaults.ts - default configuration values
 */
import type { ThinkingLevel } from "@pencil-agent/agent-core";

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";
