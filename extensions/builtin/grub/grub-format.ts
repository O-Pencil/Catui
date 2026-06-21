/**
 * [WHO]: Provides formatTaskState(), formatSnapshot(), describeDecision(), describeTerminalSnapshot(), describeTaskState()
 * [FROM]: Depends on ./grub-feature-list, ./grub-i18n, ./grub-types for human-readable /grub TUI copy
 * [TO]: Consumed by ./index.ts and tests for status/result rendering
 * [HERE]: extensions/builtin/grub/grub-format.ts - user-facing formatting boundary for Grub status messages
 */

import { readFeatureList } from "./grub-feature-list.js";
import { grubText, type GrubLocale } from "./grub-i18n.js";
import type { GrubDecision, GrubTaskSnapshot, GrubTaskState } from "./grub-types.js";

export function formatTaskState(task: GrubTaskState): string {
	const text = grubText(task.locale ?? "en");
	const list = readFeatureList(task.featureListPath);
	const lines = [
		`${text.prefix} ${text.activeTask} ${task.id}`,
		`${text.task}: ${task.goal}`,
		`${text.state}: ${describeTaskState(task.status, task.phase, task.awaitingTurn, task.locale)}`,
		`${text.round}: ${task.currentIteration}/${task.maxIterations}`,
	];

	if (list) {
		const total = list.features.length;
		const passing = list.features.filter((feature) => feature.passes).length;
		lines.push(text.featuresPassing(passing, total));
	} else {
		lines.push(text.unknownProgress);
	}

	if (task.lastDecision?.summary) lines.push(`${text.lastUpdate}: ${task.lastDecision.summary}`);
	if (task.lastDecision?.nextStep) lines.push(`${text.next}: ${task.lastDecision.nextStep}`);
	if (task.lastError) lines.push(`${text.lastIssue}: ${task.lastError}`);
	lines.push(`${text.savedIn}: ${task.harnessDirectory}`);
	lines.push(`${text.taskFiles}: ${task.featureListPath}, ${task.progressLogPath}`);
	lines.push(text.advancedJson);

	return lines.join("\n");
}

export function formatSnapshot(snapshot: GrubTaskSnapshot): string {
	const locale = snapshot.locale ?? "en";
	const text = grubText(locale);
	const lines = [
		`${text.prefix} ${text.lastTask} ${snapshot.id}`,
		`${text.task}: ${snapshot.goal}`,
		`${text.state}: ${describeTaskState(snapshot.status, snapshot.phase, false, locale)}`,
		`${text.round}: ${snapshot.completedIterations}`,
		`${text.updated}: ${formatDate(snapshot.updatedAt, locale)}`,
	];

	const list = readFeatureList(snapshot.featureListPath);
	if (list) {
		const passing = list.features.filter((feature) => feature.passes).length;
		const pending = list.features.filter((feature) => !feature.passes);
		lines.push(text.featuresPassing(passing, list.features.length));
		if (pending.length > 0) {
			const visible = pending.slice(0, 8).map((feature) => feature.id);
			lines.push(text.remainingFeatures(visible, pending.length - visible.length));
		}
	}

	if (snapshot.lastDecision?.summary) lines.push(`${text.lastUpdate}: ${snapshot.lastDecision.summary}`);
	if (snapshot.lastDecision?.nextStep) lines.push(`${text.next}: ${snapshot.lastDecision.nextStep}`);
	if (snapshot.lastError) lines.push(`${text.lastIssue}: ${snapshot.lastError}`);
	lines.push(`${text.savedIn}: ${snapshot.harnessDirectory}`);
	lines.push(`${text.taskFiles}: ${snapshot.featureListPath}, ${snapshot.progressLogPath}`);

	return lines.join("\n");
}

export function describeDecision(decision: GrubDecision, locale: GrubLocale): string {
	const text = grubText(locale);
	const lines = [`${text.prefix} ${text.lastUpdate}: ${decision.summary}`];
	if (decision.nextStep) lines.push(`${text.nextStep}: ${decision.nextStep}`);
	return lines.join("\n");
}

export function describeTerminalSnapshot(snapshot: GrubTaskSnapshot | undefined, locale: GrubLocale): string {
	if (!snapshot) return `${grubText(locale).prefix} ${grubText(locale).noActive}`;
	return formatSnapshot(snapshot);
}

export function describeTaskState(
	status: GrubTaskState["status"],
	phase: GrubTaskState["phase"],
	awaitingTurn: boolean,
	locale: GrubLocale,
): string {
	const text = grubText(locale);
	if (status === "complete") return text.finished;
	if (status === "blocked") return text.blocked;
	if (status === "stopped") return text.stoppedState;
	if (status === "failed") return text.failed;
	if (awaitingTurn) return text.waiting;
	if (phase === "initializer") return text.preparing;
	return text.working;
}

function formatDate(timestamp: number, locale: GrubLocale): string {
	return new Date(timestamp).toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
}
