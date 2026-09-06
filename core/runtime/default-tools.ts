/**
 * [WHO]: Provides createDefaultRuntimeTools()
 * [FROM]: Depends on SettingsManager and core/tools factories for default runtime tool wiring
 * [TO]: Consumed by AgentSession runtime construction
 * [HERE]: core/runtime/default-tools.ts - isolates default tool configuration from session orchestration
 */
import type { SettingsManager } from "../platform/config/settings-manager.js";
import type { ApprovalClient } from "../tools/bash.js";
import {
	createAllTools,
	createWorkspaceWriteGuard,
	type Tool,
	type ToolName,
} from "../tools/index.js";

export interface DefaultRuntimeToolsOptions {
	bashApproval?: ApprovalClient;
}

export function createDefaultRuntimeTools(
	cwd: string,
	settingsManager: SettingsManager,
	options: DefaultRuntimeToolsOptions = {},
): Record<ToolName, Tool> {
	const workspaceWriteGuard = createWorkspaceWriteGuard(cwd);
	return createAllTools(cwd, {
		read: { autoResizeImages: settingsManager.getImageAutoResize() },
		bash: {
			commandPrefix: settingsManager.getShellCommandPrefix(),
			...(options.bashApproval ? { approval: options.bashApproval } : {}),
		},
		edit: { beforeWrite: workspaceWriteGuard },
		write: { beforeWrite: workspaceWriteGuard },
	});
}
