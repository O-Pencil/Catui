/**
 * [WHO]: setPendingClearContextPlan(), getAndClearPendingPlan()
 * [FROM]: No dependencies
 * [TO]: Consumed by ./exit-plan-mode-tool.ts and ./index.ts
 * [HERE]: extensions/builtin/plan/clear-context-state.ts - module-level state for clear-context plan injection
 */

let pendingPlan: string | null = null;

export function setPendingClearContextPlan(plan: string): void {
	pendingPlan = plan;
}

export function getAndClearPendingPlan(): string | null {
	const plan = pendingPlan;
	pendingPlan = null;
	return plan;
}
