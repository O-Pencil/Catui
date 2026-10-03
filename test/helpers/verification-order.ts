/**
 * [WHO]: One ordering predicate shared by the plan assertion and its counterexample
 * [FROM]: No runtime dependencies
 * [TO]: Consumed by test/verification-contract.test.ts and test/verification-stage-order-recheck.test.ts
 * [HERE]: test/helpers/verification-order.ts - stage ordering rule for the verification plan
 *
 * The rule is deliberately tiny. It is here anyway, because a counterexample that re-implements the
 * check it is supposed to falsify only proves that the copy can be wrong. Both the assertion over
 * the real plan and the assertion over a deliberately scrambled one call this.
 */

/** A stage that must run earlier than another. */
export interface OrderingRule {
	/** Human-readable id, used in the failure message. */
	id: string;
	before: string;
	after: string;
	/** Why the order matters, so a failure says what breaks rather than only what moved. */
	reason: string;
}

/**
 * The rules the verification flow depends on, in npm script names.
 *
 * Script names, not plan ids. A plan id is documentation; the script name is what actually runs, and
 * the two do not match (`package-boundary-dist` versus `verify:package-boundary:dist`). Expressing the
 * rules in the executing name space means the same rules can be applied to the plan, to the
 * aggregate script, or to a mutated copy of either, without a translation step that could quietly
 * stop translating.
 */
export const VERIFICATION_ORDERING_RULES: readonly OrderingRule[] = [
	{
		id: "build-before-dist-boundary",
		before: "build",
		after: "verify:package-boundary:dist",
		reason: "the dist package-boundary check verifies what the build produced, so it must run after it or check a stale or absent dist",
	},
	{
		id: "dist-boundary-before-artifact-tests",
		before: "verify:package-boundary:dist",
		after: "test:artifact",
		reason: "artifact tests consume the packaged output, so they must run after the dist boundary check has cleared it",
	},
];

/** The plan's stages as npm script names, read from each command's own `command` field. */
export function planStageScriptNames(plan: { commands: { id: string; command: string }[] }): string[] {
	return plan.commands.map((command) => {
		const match = command.command.match(/^npm run ([\w:-]+)$/);
		if (!match) throw new Error(`plan command ${command.id} is not a bare npm invocation: ${command.command}`);
		return match[1]!;
	});
}

/** Rules the given ordered ids break. An empty array means the ordering holds. */
export function orderingViolations(ids: readonly string[], rules: readonly OrderingRule[] = VERIFICATION_ORDERING_RULES): string[] {
	return rules.flatMap((rule) => {
		const before = ids.indexOf(rule.before);
		const after = ids.indexOf(rule.after);
		if (before < 0 || after < 0) return [`${rule.id}: "${rule.before}" or "${rule.after}" is not present in [${ids.join(", ")}]`];
		// Strictly less than. Equal indices cannot happen for distinct ids, and `<=` would silently
		// accept a list where the two were the same entry.
		return before < after ? [] : [`${rule.id}: "${rule.before}" (index ${before}) must run before "${rule.after}" (index ${after}) — ${rule.reason}`];
	});
}
