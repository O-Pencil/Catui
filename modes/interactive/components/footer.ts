/**
 * [WHO]: FooterComponent, renderContextProgressBar()
 * [FROM]: Depends on @catui/tui, ../theme/theme.js
 * [TO]: Consumed by modes/interactive/components/index.ts, modes/interactive/interactive-mode.ts
 * [HERE]: modes/interactive/components/footer.ts - status bar footer and shared context progress rendering
 */

import { type Component, createNextComponent, NextText, truncateToWidth, visibleWidth } from "@catui/tui";
import type { AgentSession } from "../../../core/runtime/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../footer-data-provider.js";
import { theme } from "../theme/theme.js";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts (similar to web-ui)
 */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function renderFooterLine(line: string, width: number): string {
	return createNextComponent(NextText({ children: line })).render(width)[0] ?? "";
}

export function renderContextProgressBar(contextPercent: number, barWidth = 12): string {
	const safeBarWidth = Math.max(0, Math.floor(barWidth));
	const finitePercent = Number.isFinite(contextPercent) ? contextPercent : 0;
	const clampedPercent = Math.min(100, Math.max(0, finitePercent));
	const filled = Math.min(safeBarWidth, Math.max(0, Math.round((clampedPercent / 100) * safeBarWidth)));
	const empty = Math.max(0, safeBarWidth - filled);
	const fillColor = finitePercent > 90 ? "error" : finitePercent > 70 ? "warning" : "success";
	return theme.fg("dim", "[") +
		theme.fg(fillColor, "█".repeat(filled)) +
		theme.fg("dim", "░".repeat(empty)) +
		theme.fg("dim", "]");
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;
	private showTokenStats = true;

	constructor(
		private session: AgentSession,
		private footerData: ReadonlyFooterDataProvider,
		showTokenStats = true,
	) {
		this.showTokenStats = showTokenStats;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	setShowTokenStats(enabled: boolean): void {
		this.showTokenStats = enabled;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	render(width: number): string[] {
		const state = this.session.state;

		// Calculate cumulative usage from current branch only (getBranch, not getEntries)
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const entry of this.session.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				totalInput += entry.message.usage.input;
				totalOutput += entry.message.usage.output;
				totalCacheRead += entry.message.usage.cacheRead;
				totalCacheWrite += entry.message.usage.cacheWrite;
				totalCost += entry.message.usage.cost.total;
			}
		}

		// Calculate context usage from session (handles compaction correctly).
		const contextUsage = this.session.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// --- Left side: pwd (git branch) (session) ---
		let pwd = this.session.cwd;
		const home = process.env.HOME || process.env.USERPROFILE;
		if (home && pwd.startsWith(home)) {
			pwd = `~${pwd.slice(home.length)}`;
		}
		const branch = this.footerData.getGitBranch();
		if (branch) {
			pwd = `${pwd} (${branch})`;
		}
		const sessionName = this.session.sessionManager.getSessionName();
		if (sessionName) {
			pwd = `${pwd} • ${sessionName}`;
		}

		// --- Middle: token stats + context ---
		const statsParts: string[] = [];
		if (this.showTokenStats) {
			if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
			if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
			const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
			if (totalCost || usingSubscription) {
				const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
				statsParts.push(costStr);
			}
		}
		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const contextTokens = contextUsage?.tokens ?? null;
		let contextBar = "";
		if (width > 80 && contextPercentValue > 0 && contextPercent !== "?") {
			contextBar = `${renderContextProgressBar(contextPercentValue)} `;
		}
		const contextPercentDisplay =
			contextPercent === "?" || contextTokens === null
				? `${contextBar}?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${contextBar}${contextPercent}% ${formatTokens(contextTokens ?? 0)}/${formatTokens(contextWindow)}${autoIndicator}`;
		if (contextPercentValue > 90) {
			statsParts.push(theme.fg("error", contextPercentDisplay));
		} else {
			statsParts.push(contextPercentDisplay);
		}
		const statsStr = statsParts.join(" ");

		// --- Right side: model name + thinking level ---
		const modelName = state.model?.id || "no-model";
		let rightSide = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			rightSide = thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
		}
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			rightSide = `(${state.model!.provider}) ${rightSide}`;
		}

		// --- Extension statuses (inline, only if space permits) ---
		let extStr = "";
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			extStr = sortedStatuses.join(" ");
		}

		// --- Assemble single line: left | stats | right | ext ---
		const sep = theme.fg("dim", " · ");
		const sepWidth = 3;

		// Plain text widths (strip ANSI for layout calculation)
		const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
		const pwdWidth = pwd.length;
		const statsWidth = stripAnsi(statsStr).length;
		const rightWidth = stripAnsi(rightSide).length;
		const extWidth = extStr.length;

		// Try full layout: pwd · stats · right · ext
		const extPart = extStr ? sep + extStr : "";
		const fullNeeded = pwdWidth + sepWidth + statsWidth + sepWidth + rightWidth + (extStr ? sepWidth + extWidth : 0);
		if (fullNeeded <= width) {
			const padding = " ".repeat(Math.max(0, width - fullNeeded));
			const line = theme.fg("dim", pwd) + sep + statsStr + sep + theme.fg("dim", rightSide) + extPart + padding;
			return [renderFooterLine(line, width)];
		}

		// Try without ext: pwd · stats · right
		const noExtNeeded = pwdWidth + sepWidth + statsWidth + sepWidth + rightWidth;
		if (noExtNeeded <= width) {
			const padding = " ".repeat(Math.max(0, width - noExtNeeded));
			const line = theme.fg("dim", pwd) + sep + statsStr + sep + theme.fg("dim", rightSide) + padding;
			return [renderFooterLine(line, width)];
		}

		// Try without right side: pwd · stats · ext
		const partialNeeded = pwdWidth + sepWidth + statsWidth + (extStr ? sepWidth + extWidth : 0);
		if (partialNeeded <= width) {
			const padding = " ".repeat(Math.max(0, width - partialNeeded));
			const line = theme.fg("dim", pwd) + sep + statsStr + extPart + padding;
			return [renderFooterLine(line, width)];
		}

		// Try just pwd · stats
		const minimalNeeded = pwdWidth + sepWidth + statsWidth;
		if (minimalNeeded <= width) {
			const padding = " ".repeat(Math.max(0, width - minimalNeeded));
			const line = theme.fg("dim", pwd) + sep + statsStr + padding;
			return [renderFooterLine(line, width)];
		}

		// Truncation fallback: truncate pwd to fit everything
		const availableForPwd = Math.max(10, width - sepWidth - statsWidth - sepWidth - Math.min(rightWidth, 10));
		const truncatedPwd = pwd.length > availableForPwd
			? pwd.slice(0, availableForPwd - 1) + "…"
			: pwd;
		const remaining = width - truncatedPwd.length - sepWidth - statsWidth;
		// Only re-attach the right side (model name) when it genuinely fits; the
		// previous `remaining > sepWidth + 3` check let a long model name overflow
		// past `width` because the full rightSide was appended regardless of room.
		if (remaining >= sepWidth + rightWidth) {
			const padding = " ".repeat(Math.max(0, remaining - sepWidth - rightWidth));
			const line = theme.fg("dim", truncatedPwd) + sep + statsStr + sep + theme.fg("dim", rightSide) + padding;
			return [renderFooterLine(truncateToWidth(line, width, "…"), width)];
		}
		const padding = " ".repeat(Math.max(0, width - truncatedPwd.length - sepWidth - statsWidth));
		const line = theme.fg("dim", truncatedPwd) + sep + statsStr + padding;
		return [renderFooterLine(truncateToWidth(line, width, "…"), width)];
	}
}
