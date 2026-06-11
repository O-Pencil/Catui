/**
 * [WHO]: askUserQuestionExtension - registers AskUserQuestion tool
 * [FROM]: Depends on ./ask-user-question-tool
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/builtin/ask-user-question/index.ts - extension entry point
 */

import type { ExtensionAPI } from "../../../core/extensions-host/types.js";
import { createAskUserQuestionTool } from "./ask-user-question-tool.js";

export default async function askUserQuestionExtension(api: ExtensionAPI) {
	api.registerTool(createAskUserQuestionTool());
}
