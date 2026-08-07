/**
 * [WHO]: Stable root SDK exports for @catui/agent
 * [FROM]: Depends on config, core/runtime/sdk, core/runtime/catui-agent
 * [TO]: Consumed by external SDK embedders via the package root
 * [HERE]: index.ts - intentionally narrow root package entry; advanced APIs live in subpaths
 */

export { getAgentDir, VERSION } from "./config.js";
export { FileCheckpointStore } from "./core/runtime/checkpoint-store.js";
export {
  CatuiAgent,
  quickAgent,
  type CatuiAgentOptions,
} from "./core/runtime/catui-agent.js";
export {
  type CreateAgentSessionOptions,
  type CreateAgentSessionResult,
  createAgentSession,
  createBashTool,
  createCodingTools,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadOnlyTools,
  createReadTool,
  createWriteTool,
  defaultLogger,
  type PromptTemplate,
  readOnlyTools,
  type SDKLogger,
  silentLogger,
} from "./core/runtime/sdk.js";
