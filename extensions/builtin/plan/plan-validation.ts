/**
 * [WHO]: validatePlan(), checkPlanStructure()
 * [FROM]: No external dependencies
 * [TO]: Consumed by exit-plan-mode-tool.ts
 * [HERE]: extensions/builtin/plan/plan-validation.ts - plan content validation
 */

// Minimum required sections in a plan
const REQUIRED_PATTERNS = [
	/^#{1,3}\s*(Context|Background|Why)/im,      // Context section
	/^#{1,3}\s*(Approach|Implementation|Plan)/im, // Approach section
	/^#{1,3}\s*(Files?|Changes?|Steps?)/im,       // Files to modify
	/^#{1,3}\s*(Test|Verification|Validate)/im,   // Verification section
];

/**
 * Validate that a plan has the minimum required structure.
 */
export function validatePlan(planContent: string): {
	valid: boolean;
	missingSections: string[];
	suggestions: string[];
} {
	if (!planContent || planContent.trim().length === 0) {
		return {
			valid: false,
			missingSections: ["Empty plan"],
			suggestions: ["Write a plan with Context, Approach, Files, and Verification sections"],
		};
	}

	const missingSections: string[] = [];
	const suggestions: string[] = [];

	// Check for required patterns
	const patterns = [
		{ pattern: /^#{1,3}\s*(Context|Background|Why)/im, name: "Context" },
		{ pattern: /^#{1,3}\s*(Approach|Implementation|Plan|Design)/im, name: "Approach" },
		{ pattern: /^#{1,3}\s*(Files?|Changes?|Steps?|Files to Modify)/im, name: "Files to modify" },
		{ pattern: /^#{1,3}\s*(Test|Verification|Validate|Testing)/im, name: "Verification" },
	];

	for (const { pattern, name } of patterns) {
		if (!pattern.test(planContent)) {
			missingSections.push(name);
		}
	}

	// Length check
	if (planContent.length < 200) {
		suggestions.push("Plan seems too short - consider adding more detail");
	}

	// Check for code blocks (indicates thinking about implementation)
	const codeBlockCount = (planContent.match(/```/g) || []).length;
	if (codeBlockCount === 0 && planContent.length > 500) {
		suggestions.push("Consider including code examples or pseudocode");
	}

	return {
		valid: missingSections.length === 0,
		missingSections,
		suggestions,
	};
}

/**
 * Generate a validation message for the user.
 */
export function formatValidationMessage(result: ReturnType<typeof validatePlan>): string {
	if (result.valid) {
		if (result.suggestions.length > 0) {
			return [
				"Plan structure looks good!",
				"",
				"Suggestions:",
				...result.suggestions.map((s) => `- ${s}`),
			].join("\n");
		}
		return "Plan structure is complete.";
	}

	return [
		"Plan is missing required sections:",
		...result.missingSections.map((s) => `- ${s}`),
		"",
		"Please add these sections before exiting plan mode.",
		"",
		result.suggestions.length > 0 ? "Suggestions:\n" + result.suggestions.map((s) => `- ${s}`).join("\n") : "",
	].join("\n");
}
