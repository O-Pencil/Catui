/**
 * [WHO]: FooterComponent, renderContextProgressBar()
 * [FROM]: Depends on @pencil-agent/tui, ../theme/theme.js
 * [TO]: Consumed by modes/interactive/components/index.ts, modes/interactive/interactive-mode.ts
 * [HERE]: modes/interactive/components/footer.ts - status bar footer and shared context progress rendering
 */

import { type Component, truncateToWidth, visibleWidth } from "@pencil-agent/tui";
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
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// Replace home directory with ~
		let pwd = this.session.cwd;
		const home = process.env.HOME || process.env.USERPROFILE;
		if (home && pwd.startsWith(home)) {
			pwd = `~${pwd.slice(home.length)}`;
		}

		// Add git branch if available
		const branch = this.footerData.getGitBranch();
		if (branch) {
			pwd = `${pwd} (${branch})`;
		}

		// Add session name if set
		const sessionName = this.session.sessionManager.getSessionName();
		if (sessionName) {
			pwd = `${pwd} • ${sessionName}`;
		}

		// Truncate path if too long to fit width
		if (pwd.length > width) {
			const half = Math.floor(width / 2) - 2;
			if (half > 1) {
				const start = pwd.slice(0, half);
				const end = pwd.slice(-(half - 1));
				pwd = `${start}...${end}`;
			} else {
				pwd = pwd.slice(0, Math.max(1, width));
			}
		}

		// Build stats line
		const statsParts: string[] = [];

		// Token stats (can be hidden via showTokenStats setting)
		if (this.showTokenStats) {
			// Input/Output tokens with arrows
			if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
			if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);

			// Show cost with "(sub)" indicator if using OAuth subscription
			const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
			if (totalCost || usingSubscription) {
				const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
				statsParts.push(costStr);
			}
		}

		// Context percentage (always shown - it's useful)
		let contextPercentStr: string;
		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		// Use contextUsage.tokens (current context size) when available; totalUsed is cumulative consumption
		const contextTokens = contextUsage?.tokens ?? null;
		// Build progress bar for context usage (only on wide terminals)
		let contextBar = "";
		if (width > 80 && contextPercentValue > 0 && contextPercent !== "?") {
			contextBar = `${renderContextProgressBar(contextPercentValue)} `;
		}
		const contextPercentDisplay =
			contextPercent === "?" || contextTokens === null
				? `${contextBar}?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${contextBar}${contextPercent}% ${formatTokens(contextTokens ?? 0)}/${formatTokens(contextWindow)}${autoIndicator}`;
		if (contextPercentValue > 90) {
			contextPercentStr = theme.fg("error", contextPercentDisplay);
		} else {
			contextPercentStr = contextPercentDisplay;
		}
		statsParts.push(contextPercentStr);

		let statsLeft = statsParts.join(" ");

		// Add model name on the right side, plus thinking level if model supports it
		const modelName = state.model?.id || "no-model";

		let statsLeftWidth = visibleWidth(statsLeft);

		// If statsLeft is too wide, truncate it
		if (statsLeftWidth > width) {
			// Truncate statsLeft to fit width (no room for right side)
			const plainStatsLeft = statsLeft.replace(/\x1b\[[0-9;]*m/g, "");
			statsLeft = `${plainStatsLeft.substring(0, width - 3)}...`;
			statsLeftWidth = visibleWidth(statsLeft);
		}

		// Calculate available space for padding (minimum 2 spaces between stats and model)
		const minPadding = 2;

		// Add thinking level indicator if model supports reasoning
		let rightSideWithoutProvider = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			rightSideWithoutProvider =
				thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
		}

		// Prepend the provider in parentheses if there are multiple providers and there's enough room
		let rightSide = rightSideWithoutProvider;
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			rightSide = `(${state.model!.provider}) ${rightSideWithoutProvider}`;
			if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
				// Too wide, fall back
				rightSide = rightSideWithoutProvider;
			}
		}

		const rightSideWidth = visibleWidth(rightSide);
		const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

		let statsLine: string;
		if (totalNeeded <= width) {
			// Both fit - add padding to right-align model
			const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
			statsLine = statsLeft + padding + rightSide;
		} else {
			// Need to truncate right side
			const availableForRight = width - statsLeftWidth - minPadding;
			if (availableForRight > 3) {
				// Truncate to fit (strip ANSI codes for length calculation, then truncate raw string)
				const plainRightSide = rightSide.replace(/\x1b\[[0-9;]*m/g, "");
				const truncatedPlain = plainRightSide.substring(0, availableForRight);
				// For simplicity, just use plain truncated version (loses color, but fits)
				const padding = " ".repeat(width - statsLeftWidth - truncatedPlain.length);
				statsLine = statsLeft + padding + truncatedPlain;
			} else {
				// Not enough space for right side at all
				statsLine = statsLeft;
			}
		}

		// Apply dim to each part separately. statsLeft may contain color codes (for context %)
		// that end with a reset, which would clear an outer dim wrapper. So we dim the parts
		// before and after the colored section independently.
		const dimStatsLeft = theme.fg("dim", statsLeft);
		const remainder = statsLine.slice(statsLeft.length); // padding + rightSide
		const dimRemainder = theme.fg("dim", remainder);

		const lines = [theme.fg("dim", pwd), dimStatsLeft + dimRemainder];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
