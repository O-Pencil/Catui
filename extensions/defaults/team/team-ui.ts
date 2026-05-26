/**
 * [WHO]: TEAM_MESSAGE_TYPE, team message rendering, status/list formatting, dashboard/observer helpers
 * [FROM]: Depends on @pencil-agent/tui, core/extensions/types, theme colors, team runtime/types/dashboard/harness/orchestrator helpers
 * [TO]: Consumed by extensions/defaults/team/index.ts
 * [HERE]: extensions/defaults/team/team-ui.ts - UI and text formatting boundary for AgentTeam
 */

import { Box, Container, Spacer, Text } from "@pencil-agent/tui";
import type { ExtensionAPI, MessageRenderer } from "../../../core/extensions/types.js";
import type { ThemeColor } from "../../../modes/interactive/theme/theme.js";
import { formatHarnessProgress } from "./team-harness.js";
import { createTeamUtterance, formatUtteranceForContext } from "./team-orchestrator.js";
import { renderTeamDashboard, renderTeamFooterStatus } from "./team-dashboard.js";
import type { TeamRuntime, TeamRuntimeEvent } from "./team-runtime.js";
import type { PersistedTeammate, TeamTask, TeamUtterance } from "./team-types.js";
import { formatPsycheWeights } from "./team-psyche.js";

export const TEAM_MESSAGE_TYPE = "team";

interface TeamMessageDetails {
	variant: "utterance";
	utterance: TeamUtterance;
	streamKey?: string;
	replace?: boolean;
}

let dashboardVisible = false;
let dashboardAutoHideTimer: ReturnType<typeof setTimeout> | undefined;

export function clearTeamDashboardTimer(): void {
	if (dashboardAutoHideTimer) {
		clearTimeout(dashboardAutoHideTimer);
		dashboardAutoHideTimer = undefined;
	}
}

export function createTeamMessageRenderer(): MessageRenderer {
	return (message, _options, theme) => {
		const details = message.details as TeamMessageDetails | undefined;
		if (details?.variant === "utterance") {
			const { utterance } = details;
			const speaker = theme.fg(getTeamSpeakerColor(utterance.role), `\x1b[1m${utterance.speakerLabel}:\x1b[22m`);
			const text = theme.fg(getTeamUtteranceColor(utterance.kind), utterance.text);
			const container = new Container();
			container.addChild(new Spacer(1));
			container.addChild(new Text(`${speaker} ${text}`, 1, 0));
			return container;
		}
		const text =
			typeof message.content === "string"
				? message.content
				: Array.isArray(message.content)
					? message.content
							.filter((part): part is { type: "text"; text: string } => part.type === "text")
							.map((part) => part.text)
							.join("\n")
					: "";

		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(theme.fg("customMessageText", text), 0, 0));

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	};
}

export function formatTaskList(tasks: TeamTask[]): string[] {
	if (tasks.length === 0) return ["No team tasks. Use /team:task add <title> to create one."];
	const lines = ["Team Tasks:", ""];
	for (const task of tasks) {
		const owner = task.ownerName ? ` @${task.ownerName}` : "";
		const deps = task.dependsOn.length ? ` deps:${task.dependsOn.join(",")}` : "";
		lines.push(`${task.id} [${task.status}]${owner}${deps} ${task.title}`);
		if (task.description) lines.push(`  ${task.description}`);
		if (task.artifactPaths.length) lines.push(`  artifacts: ${task.artifactPaths.join(", ")}`);
	}
	return lines;
}

export function formatTeammateList(teammates: PersistedTeammate[]): string[] {
	if (teammates.length === 0) {
		return ["No teammates. Use /team:spawn to create one."];
	}

	const lines = [
		`Team (${teammates.length} teammate${teammates.length === 1 ? "" : "s"}):`,
		"",
	];

	for (const teammate of teammates) {
		const statusIcon = getStatusIconAscii(teammate.status);
		const harness = teammate.harness?.enabled ? ` | harness:${teammate.harness.phase} ${teammate.harness.passedFeatures}/${teammate.harness.totalFeatures}` : "";
		lines.push(`${statusIcon} ${teammate.identity.name} (${teammate.identity.role}) - ${teammate.mode} mode${harness}`);
	}

	return lines;
}

export function formatTeammateStatus(teammate: PersistedTeammate): string[] {
	const lines = [
		`Teammate: ${teammate.identity.name}`,
		`  ID: ${teammate.identity.id}`,
		`  Role: ${teammate.identity.role}`,
		`  Mode: ${teammate.mode}`,
		`  Status: ${teammate.status}`,
		`  Created: ${new Date(teammate.identity.createdAt).toLocaleString()}`,
		`  Last Active: ${new Date(teammate.lastActiveAt).toLocaleString()}`,
		`  Working Directory: ${teammate.cwd}`,
	];

	if (teammate.worktreePath) {
		lines.push(`  Worktree: ${teammate.worktreePath}`);
		if (teammate.worktreeBranch) {
			lines.push(`  Branch: ${teammate.worktreeBranch}`);
		}
	}

	if (teammate.lastError) {
		lines.push(`  Last Error: ${teammate.lastError}`);
	}

	if (teammate.harness?.enabled) {
		lines.push(...formatHarnessProgress(teammate.harness).map((line) => `  ${line}`));
	}
	if (teammate.psyche) {
		lines.push(`  ${formatPsycheWeights(teammate.psyche)}`);
	}

	lines.push(`  Messages: ${teammate.messages.length}`);

	return lines;
}

export function emitTeamUtterance(
	api: ExtensionAPI,
	utterance: TeamUtterance,
	options?: { streamKey?: string; replace?: boolean },
): void {
	api.sendMessage({
		customType: TEAM_MESSAGE_TYPE,
		content: formatUtteranceForContext(utterance),
		display: true,
		details: {
			variant: "utterance",
			utterance,
			streamKey: options?.streamKey,
			replace: options?.replace,
		} satisfies TeamMessageDetails,
	});
}

export function formatSpeakerName(teammate: PersistedTeammate): string {
	return teammate.identity.name;
}

export function toggleTeamDashboard(
	ctx: { ui: { setStatus(key: string, text: string | undefined): void; setWidget(key: string, content: string[] | undefined): void } },
	teamRuntime: TeamRuntime,
): boolean {
	dashboardVisible = !dashboardVisible;
	updateTeamUi(ctx, teamRuntime);
	return dashboardVisible;
}

export function updateTeamUi(
	ctx: { ui: { setStatus(key: string, text: string | undefined): void; setWidget(key: string, content: string[] | undefined): void } },
	teamRuntime: TeamRuntime,
): void {
	const teammates = teamRuntime.getAllTeammates();
	const hasRunning = teammates.some((teammate) => teammate.status === "running");
	clearTeamDashboardTimer();

	ctx.ui.setStatus("team", renderTeamFooterStatus(teammates));
	ctx.ui.setWidget(
		"team-dashboard",
		dashboardVisible || hasRunning || teammates.length > 0 ? renderTeamDashboard(teammates, 80, { expanded: dashboardVisible }) : undefined,
	);
	if (!dashboardVisible && !hasRunning && teammates.length > 0) {
		dashboardAutoHideTimer = setTimeout(() => {
			ctx.ui.setWidget("team-dashboard", undefined);
			dashboardAutoHideTimer = undefined;
		}, 30_000);
	}
}

export function setTeamActivity(
	ctx: {
		ui: {
			setStatus(key: string, text: string | undefined): void;
			setWidget(key: string, content: string[] | undefined): void;
			setWorkingMessage(message?: string): void;
		};
	},
	lines: string[],
): void {
	const [firstLine] = lines;
	ctx.ui.setStatus("team", firstLine ?? "Team: working...");
	ctx.ui.setWidget("team-dashboard", ["+ Team Workbench ------------------------------------------+", ...lines.map((line) => `| ${truncateForStatus(line, 58).padEnd(58)} |`), "+---------------------------------------------------------+"]);
	ctx.ui.setWorkingMessage(firstLine ?? "Team: working...");
}

export function createTeamObserver(
	api: ExtensionAPI,
	ctx: {
		ui: {
			setStatus(key: string, text: string | undefined): void;
			setWidget(key: string, content: string[] | undefined): void;
			setWorkingMessage(message?: string): void;
		};
	},
	teamRuntime: TeamRuntime,
): { onEvent(event: TeamRuntimeEvent): void; flush(): void } {
	let lastUiUpdate = 0;
	const streamedPreviewByTeammate = new Map<string, string>();
	const lastStreamEmitAt = new Map<string, number>();

	return {
		onEvent(event) {
			const now = Date.now();
			if (event.type === "teammate_live") {
				ctx.ui.setWorkingMessage(formatLiveWorkingMessage(event));
				if (event.event.type === "message_update") {
					const teammate = event.teammate;
					const preview = teammate.live?.preview ?? event.event.text ?? "";
					const previousPreview = streamedPreviewByTeammate.get(teammate.identity.id) ?? "";
					const delta = preview.startsWith(previousPreview) ? preview.slice(previousPreview.length) : preview;
					const lastEmitAt = lastStreamEmitAt.get(teammate.identity.id) ?? 0;
					if (shouldEmitStreamDelta(delta, now - lastEmitAt)) {
						emitTeamUtterance(
							api,
							createTeamUtterance({
								speakerId: teammate.identity.id,
								speakerLabel: formatSpeakerName(teammate),
								role: teammate.identity.role,
								kind: "thought",
								text: preview.trim() || tailPreview(preview),
							}),
							{ streamKey: `team-stream:${teammate.identity.id}`, replace: true },
						);
						streamedPreviewByTeammate.set(teammate.identity.id, preview);
						lastStreamEmitAt.set(teammate.identity.id, now);
					}
				}
			} else if (event.type === "teammate_status") {
				ctx.ui.setWorkingMessage(`Team: ${event.event}`);
			} else {
				ctx.ui.setWorkingMessage(`Team: ${event.teammate.identity.name} ${event.event}`);
			}

			if (event.type === "teammate_live" || now - lastUiUpdate > 80) {
				updateTeamUi(ctx, teamRuntime);
				lastUiUpdate = now;
			}
		},
		flush() {
			updateTeamUi(ctx, teamRuntime);
		},
	};
}

export function truncateForStatus(value: string, max = 100): string {
	const single = singleLine(value);
	if (single.length <= max) return single;
	return `${single.slice(0, Math.max(0, max - 3))}...`;
}

function getTeamSpeakerColor(role: TeamUtterance["role"]): ThemeColor {
	switch (role) {
		case "leader":
			return "accent";
		case "pm":
			return "warning";
		case "architect":
			return "mdHeading";
		case "developer":
		case "implementer":
			return "success";
		case "designer":
			return "mdLink";
		case "data-analyst":
			return "syntaxNumber";
		case "reviewer":
			return "mdQuote";
		case "researcher":
			return "syntaxFunction";
		default:
			return "customMessageLabel";
	}
}

function getTeamUtteranceColor(kind: TeamUtterance["kind"]): ThemeColor {
	switch (kind) {
		case "thought":
			return "thinkingText";
		case "handoff":
			return "mdLink";
		case "work":
		case "result":
		default:
			return "text";
	}
}

function shouldEmitStreamDelta(delta: string, elapsedMs: number): boolean {
	const trimmed = delta.trim();
	if (!trimmed) return false;
	return trimmed.length >= 24 || /[\n。！？!?]$/.test(trimmed) || elapsedMs >= 700;
}

function tailPreview(value: string, max = 120): string {
	const single = value.replace(/\s+/g, " ").trim();
	if (single.length <= max) return single;
	return single.slice(single.length - max);
}

function formatLiveWorkingMessage(event: Extract<TeamRuntimeEvent, { type: "teammate_live" }>): string {
	const name = event.teammate.identity.name;
	const live = event.teammate.live;
	if (event.event.type === "tool_start") {
		return `Team: ${name} running ${event.event.toolName}...`;
	}
	if (event.event.type === "tool_update" || event.event.type === "tool_end") {
		return `Team: ${name} using ${event.event.toolName}...`;
	}
	if (live?.phase === "thinking") {
		return `Team: ${name} streaming...`;
	}
	if (live?.phase === "finishing") {
		return `Team: ${name} finishing...`;
	}
	return `Team: ${name} ${live?.phase ?? "working"}...`;
}

function singleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function getStatusIconAscii(status: PersistedTeammate["status"]): string {
	switch (status) {
		case "idle":
			return "o";
		case "running":
			return "*";
		case "stopped":
			return "!";
		case "error":
			return "x";
		case "terminated":
			return "-";
		default:
			return "?";
	}
}
