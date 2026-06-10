/**
 * [WHO]: taskExtension - registers TaskCreate, TaskGet, TaskUpdate, TaskList, TaskStop, TaskOutput, ToolSearch
 * [FROM]: Depends on core/extensions-host/types, ./task-store, ./task-tools
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/builtin/task/index.ts - task management and tool discovery extension
 */

import type { ExtensionAPI } from "../../../core/extensions-host/types.js";
import { createTaskCreateTool } from "./task-tools/task-create-tool.js";
import { createTaskGetTool } from "./task-tools/task-get-tool.js";
import { createTaskUpdateTool } from "./task-tools/task-update-tool.js";
import { createTaskListTool } from "./task-tools/task-list-tool.js";
import { createTaskStopTool } from "./task-tools/task-stop-tool.js";
import { createTaskOutputTool } from "./task-tools/task-output-tool.js";
import { createToolSearchTool } from "./task-tools/tool-search-tool.js";

export default async function taskExtension(api: ExtensionAPI) {
	// Register all 7 tools
	api.registerTool(createTaskCreateTool());
	api.registerTool(createTaskGetTool());
	api.registerTool(createTaskUpdateTool());
	api.registerTool(createTaskListTool());
	api.registerTool(createTaskStopTool());
	api.registerTool(createTaskOutputTool());
	api.registerTool(createToolSearchTool(() => api.getAllTools()));
}
