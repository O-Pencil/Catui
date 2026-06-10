/**
 * [WHO]: teachFormat - formatting utilities for teach extension
 * [FROM]: Depends on teach-types.ts for type definitions
 * [TO]: Consumed by index.ts for rendering teach messages
 * [HERE]: extensions/builtin/teach/teach-format.ts - output formatting for teach extension
 */

import type { Source, TeachResult } from "./teach-types.js";

/**
 * Format a teach result for display
 */
export function formatTeachResult(result: TeachResult): string {
	switch (result.type) {
		case "question":
			return formatQuestion(result);
		case "lesson":
			return formatLesson(result);
		case "complete":
			return formatComplete(result);
		case "error":
			return formatError(result);
		case "info":
			return formatInfo(result);
		default:
			return result.message;
	}
}

/**
 * Format a question
 */
function formatQuestion(result: TeachResult): string {
	return result.message;
}

/**
 * Format a lesson
 */
function formatLesson(result: TeachResult): string {
	const lines: string[] = [];

	if (result.content) {
		lines.push(result.content);
	}

	if (result.message) {
		lines.push("");
		lines.push(result.message);
	}

	return lines.join("\n");
}

/**
 * Format completion message
 */
function formatComplete(result: TeachResult): string {
	return [
		"---",
		"",
		result.message,
		"",
		result.content ?? "",
		"---",
	].join("\n");
}

/**
 * Format error message
 */
function formatError(result: TeachResult): string {
	return `❌ **Error**: ${result.message}`;
}

/**
 * Format info message
 */
function formatInfo(result: TeachResult): string {
	return result.message;
}

/**
 * Format source citation
 */
export function formatSource(source: Source, locale: "en" | "zh" = "en"): string {
	const confidenceLabel = locale === "zh" ? "置信度" : "Confidence";
	const confidenceStars = "⭐".repeat(source.confidence);

	return `[${source.name}](${source.url}) - ${confidenceLabel}: ${confidenceStars}`;
}

/**
 * Format multiple sources
 */
export function formatSources(sources: Source[], locale: "en" | "zh" = "en"): string {
	if (sources.length === 0) {
		return "";
	}

	const sourceLabel = locale === "zh" ? "来源验证" : "Source Verification";
	const lines: string[] = [
		"---",
		"",
		`**${sourceLabel}**:`,
	];

	for (const source of sources) {
		lines.push(`- ${formatSource(source, locale)}`);
	}

	return lines.join("\n");
}

/**
 * Format glossary entry
 */
export function formatGlossaryEntry(term: string, definition: string): string {
	return `**${term}**: ${definition}`;
}

/**
 * Format progress indicator
 */
export function formatProgress(current: number, total: number): string {
	const percentage = Math.round((current / total) * 100);
	const filled = Math.round(percentage / 10);
	const empty = 10 - filled;

	return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${percentage}%`;
}

/**
 * Format learning style options
 */
export function formatLearningStyleOptions(): string {
	return [
		"| # | Style | Duration | Best For |",
		"|---|-------|----------|----------|",
		"| 1 | Quick Overview | 10-15 min | Just the essentials |",
		"| 2 | Deep Dive | 30-60 min | Comprehensive understanding |",
		"| 3 | Focused Skill | 20-30 min | Master one specific thing |",
		"| 4 | Holistic | Multiple sessions | Become an expert |",
	].join("\n");
}

/**
 * Format mission summary
 */
export function formatMissionSummary(
	why: string,
	successCriteria: string[],
	constraints: string[],
	outOfScope: string[],
): string {
	const lines: string[] = [
		"### 📋 Mission Summary",
		"",
		`**Why**: ${why}`,
		"",
		"**Success looks like**:",
	];

	for (const criteria of successCriteria) {
		lines.push(`- ${criteria}`);
	}

	if (constraints.length > 0) {
		lines.push("");
		lines.push("**Constraints**:");
		for (const constraint of constraints) {
			lines.push(`- ${constraint}`);
		}
	}

	if (outOfScope.length > 0) {
		lines.push("");
		lines.push("**Out of scope**:");
		for (const item of outOfScope) {
			lines.push(`- ${item}`);
		}
	}

	return lines.join("\n");
}
