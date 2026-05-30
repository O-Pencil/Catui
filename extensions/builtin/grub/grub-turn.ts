/**
 * [WHO]: Provides resolveGrubTurn(), GrubTurnResult
 * [FROM]: Depends on ./grub-controller, ./grub-decision, ./grub-format, ./grub-i18n for turn-end state transitions
 * [TO]: Consumed by ./index.ts and tests for /grub agent_end orchestration
 * [HERE]: extensions/builtin/grub/grub-turn.ts - pure orchestration boundary for one completed Grub assistant turn
 */

import { GrubController } from "./grub-controller.js";
import { extractGrubDecision } from "./grub-decision.js";
import { describeDecision, describeTerminalSnapshot } from "./grub-format.js";
import { grubText } from "./grub-i18n.js";

export interface GrubTurnEvent {
	message: string;
	level: "info" | "warning" | "error";
}

export interface GrubTurnResult {
	events: GrubTurnEvent[];
	dispatchNext: boolean;
}

export function resolveGrubTurn(controller: GrubController, assistantText: string): GrubTurnResult {
	const activeTask = controller.getActiveTask();
	if (!activeTask?.awaitingTurn) {
		return { events: [], dispatchNext: false };
	}

	const text = grubText(activeTask.locale);
	if (!assistantText) {
		return handleFailure(controller, text.failedNoAssistant, text.iterationFailedRetry);
	}

	const parsedDecision = extractGrubDecision(assistantText);
	if (!parsedDecision) {
		return handleFailure(controller, text.invalidLoopState, text.invalidLoopRetry);
	}

	const featureListValidation = controller.validateFeatureListAfterTurn();
	if (!featureListValidation.ok) {
		return handleFailure(controller, featureListValidation.message, () => `${text.prefix} ${featureListValidation.message}`);
	}

	const events: GrubTurnEvent[] = [];
	const validated = controller.validateCompletion(parsedDecision);
	if (validated.downgraded) {
		events.push({
			message: text.prematureComplete(
				validated.reason ?? (activeTask.locale === "zh" ? "仍有未完成 feature" : "pending features remain"),
			),
			level: "warning",
		});
	}

	const decision = validated.decision;
	events.push({ message: describeDecision(decision, activeTask.locale), level: "info" });

	const next = controller.finishTurn(decision);
	if (next.action === "stop") {
		events.push({
			message: describeTerminalSnapshot(next.snapshot, activeTask.locale),
			level: decision.status === "complete" ? "info" : "warning",
		});
		return { events, dispatchNext: false };
	}

	return { events, dispatchNext: true };
}

function handleFailure(
	controller: GrubController,
	failureMessage: string,
	retryMessage: (iteration: number | undefined) => string,
): GrubTurnResult {
	const activeTask = controller.getActiveTask();
	const locale = activeTask?.locale ?? "en";
	const failure = controller.recordFailure(failureMessage);
	if (failure.action === "stop") {
		return {
			events: [{ message: describeTerminalSnapshot(failure.snapshot, locale), level: "warning" }],
			dispatchNext: false,
		};
	}

	return {
		events: [{ message: retryMessage(failure.task?.currentIteration), level: "warning" }],
		dispatchNext: true,
	};
}
