/**
 * [WHO]: notebookExtension - registers NotebookEdit tool for .ipynb cell editing
 * [FROM]: Depends on ./notebook-edit-tool
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/builtin/notebook/index.ts
 */

import type { ExtensionAPI } from "../../../core/extensions-host/types.js";
import { createNotebookEditTool } from "./notebook-edit-tool.js";

export default function notebookExtension(api: ExtensionAPI): void {
	api.registerTool(createNotebookEditTool());
}
