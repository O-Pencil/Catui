/**
 * [WHO]: Provides enforceToolResultBatchSize() for bounded tool-result batches.
 * [FROM]: Depends on @pencil-agent/ai ToolResultMessage/TextContent shapes.
 * [TO]: Consumed by standard and structured-adaptive agent loops before appending tool results.
 * [HERE]: packages/agent-core/src/agent-loop-tool-results.ts within agent-core; shared tool-result budget policy.
 */

import type { TextContent, ToolResultMessage } from "@pencil-agent/ai";

export function enforceToolResultBatchSize(
	toolResults: ToolResultMessage[],
	maxChars: number | undefined,
): ToolResultMessage[] {
	if (!maxChars || maxChars <= 0 || toolResults.length === 0) {
		return toolResults;
	}

	const limit = Math.floor(maxChars);
	let currentTotal = sumToolResultTextChars(toolResults);
	if (currentTotal <= limit) {
		return toolResults;
	}

	const next = [...toolResults];
	const ranked = toolResults
		.map((result, index) => ({
			index,
			size: sumTextContentChars(result.content),
			isError: result.isError,
		}))
		.filter((candidate) => candidate.size > 0)
		.sort((a, b) => {
			if (a.isError !== b.isError) return a.isError ? 1 : -1;
			return b.size - a.size || a.index - b.index;
		});

	for (const candidate of ranked) {
		if (currentTotal <= limit) break;
		const reductionNeeded = currentTotal - limit;
		const targetSize = Math.max(0, candidate.size - reductionNeeded);
		const truncated = truncateToolResultToTextChars(next[candidate.index]!, targetSize, limit);
		next[candidate.index] = truncated.result;
		currentTotal = currentTotal - candidate.size + truncated.textChars;
	}

	return next;
}

function truncateToolResultToTextChars(
	result: ToolResultMessage,
	targetChars: number,
	maxToolResultBatchSizeChars: number,
): { result: ToolResultMessage; textChars: number } {
	const originalTextChars = sumTextContentChars(result.content);
	if (originalTextChars <= targetChars) {
		return { result, textChars: originalTextChars };
	}

	const note = `[Tool result truncated by batch budget: original ${originalTextChars} chars.]`;
	let nextText = "";
	if (targetChars > 0) {
		if (targetChars <= note.length) {
			nextText = note.slice(0, targetChars);
		} else {
			const suffix = `\n\n${note}`;
			const bodyBudget = Math.max(0, targetChars - suffix.length);
			nextText = `${flattenTextContent(result.content).slice(0, bodyBudget)}${suffix}`;
		}
	}

	let hasWrittenText = false;
	const content = result.content.map((part) => {
		if (part.type !== "text") return part;
		if (hasWrittenText) {
			return { ...part, text: "" } satisfies TextContent;
		}
		hasWrittenText = true;
		return { ...part, text: nextText } satisfies TextContent;
	});
	if (!hasWrittenText) {
		content.push({ type: "text", text: nextText });
	}

	return {
		result: {
			...result,
			content,
			details: {
				...(typeof result.details === "object" && result.details !== null ? result.details : {}),
				truncationReason: "tool_result_batch_budget",
				originalTextChars,
				retainedTextChars: nextText.length,
				maxToolResultBatchSizeChars,
			},
		},
		textChars: nextText.length,
	};
}

function sumToolResultTextChars(toolResults: ToolResultMessage[]): number {
	return toolResults.reduce((total, result) => total + sumTextContentChars(result.content), 0);
}

function sumTextContentChars(content: ToolResultMessage["content"]): number {
	return content.reduce((total, part) => total + (part.type === "text" ? part.text.length : 0), 0);
}

function flattenTextContent(content: ToolResultMessage["content"]): string {
	return content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("");
}
