/**
 * [WHO]: The plan-to-scripts contract as functions, so counterexamples can run a mutated plan copy
 * [FROM]: No runtime dependencies; both the plan and the script map are passed in
 * [TO]: Consumed by test/verification-contract.test.ts and test/verification-plan-coverage-recheck.test.ts
 * [HERE]: test/helpers/verification-plan.ts - what the verification plan is required to satisfy
 *
 * The plan is a data file, and every rule about it used to be written inline against the real one.
 * That makes two things impossible: proving a rule is load-bearing, and counterexampleing it without
 * editing the file the rules are supposed to protect. Both matter more here than usual — the plan is
 * the document the whole acceptance story rests on.
 *
 * Every lookup in the original assertions was `find`-based, which shares a hazard worth naming: a
 * duplicated id is invisible to all of them at once. The duplicate check below is not tidiness, it is
 * the thing that stops a second entry from hiding behind a first one.
 */

export interface PlanCommand {
	id: string;
	command: string;
	required?: boolean;
}

export interface VerificationPlan {
	commands: PlanCommand[];
}

/** The five mandatory gates from feature-workflow.md section 5. */
export const MANDATORY_GATES: readonly { id: string; script: string }[] = [
	{ id: "dip", script: "verify:dip" },
	{ id: "quality", script: "verify:quality" },
	{ id: "package-boundary", script: "verify:package-boundary" },
	{ id: "build", script: "build" },
	{ id: "typecheck", script: "typecheck" },
];

/** Plan commands that are not a bare `npm run <script>` invocation. */
export function malformedInvocations(plan: VerificationPlan): string[] {
	return plan.commands
		.filter((command) => !/^npm run [\w:-]+$/.test(command.command))
		.map((command) => `${command.id} (${command.command})`);
}

/** Plan commands naming an npm script that does not exist. */
export function missingScripts(plan: VerificationPlan, scripts: Record<string, string>): string[] {
	return plan.commands
		.filter((command) => /^npm run [\w:-]+$/.test(command.command))
		.filter((command) => !(command.command.replace("npm run ", "") in scripts))
		.map((command) => `${command.id} (${command.command})`);
}

/** Mandatory gates that are absent, point at the wrong script, or are not required. */
export function gateViolations(plan: VerificationPlan, gates = MANDATORY_GATES): string[] {
	return gates.flatMap((gate) => {
		const entry = plan.commands.find((command) => command.id === gate.id);
		if (!entry) return [`missing gate ${gate.id}`];
		const problems: string[] = [];
		if (entry.command !== `npm run ${gate.script}`) problems.push(`${gate.id} runs ${entry.command}, expected npm run ${gate.script}`);
		if (entry.required !== true) problems.push(`${gate.id} is required:${String(entry.required)}`);
		return problems;
	});
}

/** Test suites in the plan that are not required. An optional test gate is a gate nobody waits for. */
export function optionalTestGates(plan: VerificationPlan, isTestCommand: (command: string) => boolean): string[] {
	return plan.commands
		.filter((command) => isTestCommand(command.command))
		.filter((command) => command.required !== true)
		.map((command) => `${command.id} (${command.command})`);
}

/**
 * Ids and commands that appear more than once.
 *
 * Every lookup above is `find`-based, so a second entry sharing an id or a command with the first is
 * unreachable by all of them at once. That is the same shape as a shadowed declaration: the file
 * still looks correct to anyone reading it.
 */
export function duplicatedPlanKeys(plan: VerificationPlan): { ids: string[]; commands: string[] } {
	const repeated = (values: readonly string[]): string[] => [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
	return {
		ids: repeated(plan.commands.map((command) => command.id)),
		commands: repeated(plan.commands.map((command) => command.command)),
	};
}

/** Script names a plan command runs, in plan order. */
export function planStageScripts(plan: VerificationPlan): string[] {
	return plan.commands.flatMap((command) => {
		const match = command.command.match(/^npm run ([\w:-]+)$/);
		return match ? [match[1]!] : [];
	});
}
