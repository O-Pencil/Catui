/**
 * [WHO]: ResourceCollision, ResourceDiagnostic
 * [FROM]: No external dependencies
 * [TO]: Consumed by core/platform/config/resource-loader.ts, core/skills.ts
 * [HERE]: core/platform/config/diagnostics.ts - resource collision and diagnostic types
 */
export interface ResourceCollision {
	resourceType: "extension" | "skill" | "prompt" | "theme";
	name: string; // skill name, command/tool/flag name, prompt name, theme name
	winnerPath: string;
	loserPath: string;
	winnerSource?: string; // e.g., "npm:foo", "git:...", "local"
	loserSource?: string;
}

export interface ResourceDiagnostic {
	type: "warning" | "error" | "collision";
	message: string;
	path?: string;
	collision?: ResourceCollision;
}
