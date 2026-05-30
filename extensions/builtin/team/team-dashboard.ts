/**
 * [WHO]: Provides renderTeamDashboard(), renderTeamFooterStatus()
 * [FROM]: Depends on ./team-types and ./team-psyche formatting helpers
 * [TO]: Consumed by index.ts to render /team:dashboard widget and footer status text
 * [HERE]: extensions/builtin/team/team-dashboard.ts - lightweight team workbench dashboard
 */

import type { PersistedTeammate } from "./team-types.js";

interface TeamDashboardOptions {
	expanded?: boolean;
}

export function renderTeamDashboard(teammates: PersistedTeammate[], width = 80, options: TeamDashboardOptions = {}): string[] {
	if (teammates.length === 0) return ["Team: no agents"];

	const panelWidth = Math.max(58, Math.min(width, 100));
	const active = teammates.filter((teammate) => teammate.status === "running").length;
	const blocked = teammates.filter((teammate) => teammate.liveView?.blockedOn || teammate.status === "error").length;
	const visibleCount = options.expanded ? 6 : 4;
	const visibleTeammates = prioritizeTeammates(teammates).slice(0, visibleCount);
	const hiddenCount = Math.max(0, teammates.length - visibleTeammates.length);
	const bodyWidth = panelWidth - 2;
	const lines = [
		`+${pad(` Team Workbench  ${teammates.length} agents | ${active} running | ${blocked} blocked `, bodyWidth, "-")}+`,
	];

	for (const teammate of visibleTeammates) {
		lines.push(`|${pad(renderAgentLine(teammate, bodyWidth), bodyWidth)}|`);
	}
	if (hiddenCount > 0) {
		lines.push(`|${pad(`+ ${hiddenCount} more agents`, bodyWidth)}|`);
	}

	const latest = latestUtterances(teammates, options.expanded ? 2 : 1);
	for (const item of latest) {
		lines.push(`|${pad(`${item.name}: ${item.text}`, bodyWidth)}|`);
	}

	lines.push(`+${"-".repeat(bodyWidth)}+`);
	return lines;
}

export function renderTeamFooterStatus(teammates: PersistedTeammate[]): string | undefined {
	if (teammates.length === 0) return undefined;
	const active = teammates.filter((teammate) => teammate.status === "running").length;
	const summaries = teammates
		.slice(0, 3)
		.map((teammate) => {
			const progress = teammate.liveView?.progress ? ` ${teammate.liveView.progress}` : "";
			return `${teammate.identity.name}:${teammate.status}${progress}`;
		})
		.join(" | ");
	return `team: ${teammates.length} agents${active ? ` (${active} running)` : ""} | ${summaries}`;
}

function renderAgentLine(teammate: PersistedTeammate, width: number): string {
	const liveView = teammate.liveView;
	const nameWidth = 11;
	const roleWidth = 12;
	const stateWidth = 13;
	const taskWidth = Math.max(12, width - nameWidth - roleWidth - stateWidth - 8);
	const marker = statusIcon(teammate.status);
	const name = pad(truncate(teammate.identity.name, nameWidth), nameWidth);
	const role = pad(truncate(teammate.identity.role, roleWidth), roleWidth);
	const state = pad(truncate(formatState(teammate), stateWidth), stateWidth);
	const task = truncate(liveView?.currentTask ?? liveView?.lastUtterance ?? "-", taskWidth);
	return `${marker} ${name} ${role} ${state} ${task}`;
}

function formatState(teammate: PersistedTeammate): string {
	if (teammate.liveView?.blockedOn) return `blocked:${teammate.liveView.blockedOn}`;
	if (teammate.liveView?.progress) return teammate.liveView.progress;
	if (teammate.live?.phase) return teammate.live.toolName ? `${teammate.live.phase}:${teammate.live.toolName}` : teammate.live.phase;
	return teammate.status;
}

function latestUtterances(teammates: PersistedTeammate[], limit: number): Array<{ name: string; text: string; timestamp: number }> {
	return teammates
		.map((teammate) => ({
			name: teammate.identity.name,
			text: singleLine(teammate.liveView?.lastUtterance ?? teammate.live?.preview ?? ""),
			timestamp: teammate.lastActiveAt,
		}))
		.filter((item) => item.text.length > 0)
		.sort((a, b) => b.timestamp - a.timestamp)
		.slice(0, limit)
		.map((item) => ({ ...item, text: truncate(item.text, 74) }));
}

function prioritizeTeammates(teammates: PersistedTeammate[]): PersistedTeammate[] {
	const rank = (teammate: PersistedTeammate): number => {
		if (teammate.status === "running") return 0;
		if (teammate.liveView?.blockedOn || teammate.status === "error") return 1;
		if (teammate.liveView?.progress && teammate.liveView.progress !== "done") return 2;
		return 3;
	};
	return [...teammates].sort((a, b) => rank(a) - rank(b) || b.lastActiveAt - a.lastActiveAt);
}

function statusIcon(status: PersistedTeammate["status"]): string {
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
	}
}

function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - 3))}...`;
}

function singleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function pad(value: string, width: number, fill = " "): string {
	const truncated = truncate(value, width);
	return truncated + fill.repeat(Math.max(0, width - truncated.length));
}
