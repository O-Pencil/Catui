/**
 * [WHO]: Provides renderTeamDashboard(), renderTeamFooterStatus()
 * [FROM]: Depends on ./team-types and ./team-psyche formatting helpers
 * [TO]: Consumed by index.ts to render /team:dashboard widget and footer status text
 * [HERE]: extensions/defaults/team/team-dashboard.ts - lightweight text dashboard for AgentTeam state
 */

import type { PersistedTeammate, PsycheWeights } from "./team-types.js";

export function renderTeamDashboard(teammates: PersistedTeammate[], width = 80): string[] {
	if (teammates.length === 0) return ["Team Dashboard: no teammates"];

	const outerWidth = Math.max(60, Math.min(width, 120));
	const cardWidth = outerWidth >= 110 ? Math.floor((outerWidth - 5) / 2) : outerWidth - 2;
	const cards = teammates.map((teammate) => renderTeammateCard(teammate, cardWidth));
	const lines = [`╭─ Team Dashboard ${"─".repeat(Math.max(0, outerWidth - 19))}╮`];

	if (outerWidth >= 110) {
		for (let i = 0; i < cards.length; i += 2) {
			const left = cards[i] ?? [];
			const right = cards[i + 1] ?? [];
			const height = Math.max(left.length, right.length);
			for (let row = 0; row < height; row++) {
				const leftLine = left[row] ?? " ".repeat(cardWidth);
				const rightLine = right[row] ?? " ".repeat(cardWidth);
				lines.push(`│ ${leftLine} ${rightLine} │`);
			}
		}
	} else {
		for (const card of cards) {
			for (const line of card) {
				lines.push(`│ ${line} │`);
			}
		}
	}

	lines.push(`╰${"─".repeat(Math.max(0, outerWidth - 2))}╯`);
	return lines;
}

export function renderTeamFooterStatus(teammates: PersistedTeammate[]): string | undefined {
	if (teammates.length === 0) return undefined;
	const active = teammates.filter((teammate) => teammate.status === "running").length;
	const summaries = teammates
		.slice(0, 3)
		.map((teammate) => {
			const harness = teammate.harness;
			const progress = harness?.enabled ? ` ${harness.phase} ${harness.passedFeatures}/${harness.totalFeatures}` : "";
			return `${teammate.identity.name}:${teammate.status}${progress}`;
		})
		.join(" | ");
	return `team: ${teammates.length} agents${active ? ` (${active} running)` : ""} | ${summaries}`;
}

function renderTeammateCard(teammate: PersistedTeammate, width: number): string[] {
	const harness = teammate.harness;
	const phase = harness?.enabled ? harness.phase : "-";
	const progress = harness?.enabled ? `${harness.passedFeatures}/${harness.totalFeatures}` : "-";
	const feature = harness?.currentFeature ?? "none";
	const percent = harness?.enabled && harness.totalFeatures > 0 ? harness.passedFeatures / harness.totalFeatures : 0;
	const live = teammate.live;
	const title = `${teammate.identity.name} (${teammate.identity.role})`;
	const inner = Math.max(20, width - 2);

	return [
		`┌${pad(` ${truncate(title, inner - 2)} `, inner, "─")}┐`,
		`│${pad(`${statusIcon(teammate.status)} ${teammate.status}  mode:${teammate.mode}  phase:${phase}`, inner)}│`,
		`│${pad(`live: ${live ? `${live.phase}${live.toolName ? `:${live.toolName}` : ""}` : "idle"}`, inner)}│`,
		`│${pad(renderPsycheBar(teammate.psyche), inner)}│`,
		`│${pad(`feature: [${progress}] ${truncate(feature, Math.max(8, inner - 17))}`, inner)}│`,
		`│${pad(`progress: ${renderProgressBar(percent, Math.max(8, inner - 15))}`, inner)}│`,
		...(live?.preview ? [`│${pad(`stream: ${truncate(singleLine(live.preview), Math.max(8, inner - 8))}`, inner)}│`] : []),
		`└${"─".repeat(inner)}┘`,
	];
}

function renderPsycheBar(weights: PsycheWeights | undefined): string {
	if (!weights) return "psyche: unavailable";
	return `psyche: Id${bar(weights.id)} Eg${bar(weights.ego)} Se${bar(weights.superego)}`;
}

function bar(value: number): string {
	const filled = Math.round(Math.max(0, Math.min(10, value)));
	return `${"#".repeat(filled)}${"-".repeat(10 - filled)}`;
}

function renderProgressBar(percent: number, width: number): string {
	const bounded = Math.max(0, Math.min(1, percent));
	const filled = Math.round(bounded * width);
	return `${"#".repeat(filled)}${"-".repeat(width - filled)} ${Math.round(bounded * 100)}%`;
}

function statusIcon(status: PersistedTeammate["status"]): string {
	switch (status) {
		case "idle":
			return "○";
		case "running":
			return "●";
		case "stopped":
			return "◐";
		case "error":
			return "x";
		case "terminated":
			return "⊗";
	}
}

function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function singleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function pad(value: string, width: number, fill = " "): string {
	const truncated = truncate(value, width);
	return truncated + fill.repeat(Math.max(0, width - truncated.length));
}
