/**
 * [WHO]: createAskUserQuestionTool()
 * [FROM]: 1:1 ported from Claude Code AskUserQuestion tool; depends on ./prompt, ./types, extension types
 * [TO]: Consumed by ./index.ts
 * [HERE]: extensions/builtin/ask-user-question/ask-user-question-tool.ts - tool definition + UI interaction
 */

import type { ExtensionContext, ToolDefinition } from "../../../core/extensions-host/types.js";
import { Container, Text, type Component } from "@pencil-agent/tui";
import type { Theme } from "../../../core/theme-contract.js";
import type { AgentToolResult } from "@pencil-agent/agent-core";
import {
	ASK_USER_QUESTION_TOOL_CHIP_WIDTH,
	ASK_USER_QUESTION_TOOL_PROMPT,
	DESCRIPTION,
} from "./prompt.js";
import {
	AskUserQuestionInputSchema,
	AskUserQuestionOutputSchema,
	type AskUserQuestionInput,
	type AskUserQuestionOutput,
	type Question,
	validateUniqueness,
} from "./types.js";

// ============================================================================
// Result text formatting (1:1 from CC mapToolResultToToolResultBlockParam)
// ============================================================================

function formatResultText(
	answers: Record<string, string>,
	annotations?: Record<string, { preview?: string; notes?: string }>,
): string {
	const pairs = Object.entries(answers)
		.map(([question, answer]) => {
			const ann = annotations?.[question];
			const parts = [`"${question}"="${answer}"`];
			if (ann?.preview) parts.push(`selected preview:\n${ann.preview}`);
			if (ann?.notes) parts.push(`user notes: ${ann.notes}`);
			return parts.join(" ");
		})
		.join(", ");
	return `User has answered your questions: ${pairs}. You can now continue with the user's answers in mind.`;
}

// ============================================================================
// UI helpers
// ============================================================================

function buildOptionDisplayLabel(label: string, description: string): string {
	return `${label} — ${description}`;
}

function extractLabelFromDisplay(displayLabel: string): string {
	const separatorIndex = displayLabel.indexOf(" — ");
	return separatorIndex >= 0 ? displayLabel.substring(0, separatorIndex) : displayLabel;
}

function buildQuestionTitle(question: Question): string {
	const header = `[${question.header.slice(0, ASK_USER_QUESTION_TOOL_CHIP_WIDTH)}]`;
	const lines: string[] = [`${header} ${question.question}`, ""];

	for (const option of question.options) {
		lines.push(`${option.label}: ${option.description}`);
		if (option.preview) {
			lines.push("");
			lines.push("```");
			lines.push(option.preview);
			lines.push("```");
		}
	}

	return lines.join("\n");
}

// ============================================================================
// Single question flow
// ============================================================================

async function askSingleSelect(
	ctx: ExtensionContext,
	question: Question,
): Promise<string> {
	// Simplified title: just the question text (options render as label — description below)
	const header = `[${question.header.slice(0, ASK_USER_QUESTION_TOOL_CHIP_WIDTH)}]`;
	const title = `${header} ${question.question}`;
	const optionLabels = question.options.map((o) => buildOptionDisplayLabel(o.label, o.description));
	optionLabels.push("Other (custom answer)");

	const choice = await ctx.ui.select(title, optionLabels);

	if (choice === undefined) {
		throw new Error(`User declined to answer: "${question.question}"`);
	}

	if (choice === "Other (custom answer)") {
		const customAnswer = await ctx.ui.input(`Custom answer for: ${question.question}`);
		if (customAnswer === undefined) {
			throw new Error(`User declined to answer: "${question.question}"`);
		}
		return customAnswer;
	}

	return extractLabelFromDisplay(choice);
}

async function askMultiSelect(
	ctx: ExtensionContext,
	question: Question,
): Promise<string> {
	const answers: string[] = [];

	for (const option of question.options) {
		const confirmed = await ctx.ui.confirm(
			question.header,
			`Enable: ${option.label} — ${option.description}?`,
		);
		if (confirmed) {
			answers.push(option.label);
		}
	}

	const wantsCustom = await ctx.ui.confirm(question.header, "Add a custom answer?");
	if (wantsCustom) {
		const customAnswer = await ctx.ui.input(`Custom answer for: ${question.question}`);
		if (customAnswer !== undefined && customAnswer.trim().length > 0) {
			answers.push(customAnswer.trim());
		}
	}

	if (answers.length === 0) {
		throw new Error(`User declined to answer: "${question.question}"`);
	}

	return answers.join(", ");
}

// ============================================================================
// renderCall / renderResult (rich TUI display in message flow)
// ============================================================================

function renderCallForAskUserQuestion(args: AskUserQuestionInput, theme: Theme): Component {
	const container = new Container();
	const questions = args.questions ?? [];

	container.addChild(
		new Text(theme.fg("toolTitle", theme.bold("AskUserQuestion")), 0, 0),
	);

	if (questions.length === 0) {
		container.addChild(new Text(theme.fg("toolOutput", "  (no questions)"), 0, 0));
		return container;
	}

	for (const q of questions) {
		container.addChild(new Text("", 0, 0)); // spacer line
		const header = `[${q.header.slice(0, ASK_USER_QUESTION_TOOL_CHIP_WIDTH)}]`;
		container.addChild(
			new Text(theme.fg("accent", theme.bold(header)) + " " + theme.fg("text", q.question), 0, 0),
		);

		for (const opt of q.options) {
			const label = theme.fg("accent", `  ${opt.label}`);
			const desc = theme.fg("muted", ` — ${opt.description}`);
			container.addChild(new Text(label + desc, 0, 0));
		}

		if (q.multiSelect) {
			container.addChild(new Text(theme.fg("muted", "  (multiple selections allowed)"), 0, 0));
		}
	}

	return container;
}

function renderResultForAskUserQuestion(
	result: AgentToolResult<AskUserQuestionOutput | undefined>,
	_options: { expanded: boolean; isPartial: boolean },
	theme: Theme,
): Component {
	const container = new Container();
	const details = result.details;
	const detailsTyped = details;

	if (!detailsTyped) {
		const textOut = result.content
			?.filter((c) => c.type === "text")
			.map((c: any) => c.text)
			.join("\n");
		if (textOut) {
			container.addChild(new Text(theme.fg("toolOutput", textOut), 0, 0));
		}
		return container;
	}

	const { answers } = detailsTyped;
	for (const [question, answer] of Object.entries(answers)) {
		const qLine = theme.fg("muted", "Q: ") + theme.fg("text", question);
		container.addChild(new Text(qLine, 0, 0));
		const aLine = theme.fg("muted", "A: ") + theme.fg("success", answer);
		container.addChild(new Text(aLine, 0, 0));
		container.addChild(new Text("", 0, 0)); // spacer
	}

	return container;
}

// ============================================================================
// Tool definition
// ============================================================================

export function createAskUserQuestionTool(): ToolDefinition<typeof AskUserQuestionInputSchema, AskUserQuestionOutput> {
	return {
		name: "AskUserQuestion",
		label: "AskUserQuestion",
		description: DESCRIPTION,
		parameters: AskUserQuestionInputSchema,
		isConcurrencySafe: true,
		guidance: ASK_USER_QUESTION_TOOL_PROMPT,

		validateInput(params: AskUserQuestionInput): string | void {
			const error = validateUniqueness(params.questions);
			if (error) return error;
		},

		renderCall: renderCallForAskUserQuestion,
		renderResult: renderResultForAskUserQuestion,

		async execute(
			_toolCallId: string,
			input: AskUserQuestionInput,
			_signal?: AbortSignal,
			_onUpdate?: unknown,
			ctx?: ExtensionContext,
		) {
			if (!ctx?.hasUI) {
				throw new Error("AskUserQuestion requires an interactive UI session.");
			}

			const { questions } = input;
			const answers: Record<string, string> = {};
			const annotations: Record<string, { preview?: string; notes?: string }> = {};

			for (const question of questions) {
				const isMulti = question.multiSelect === true;
				const answer = isMulti
					? await askMultiSelect(ctx, question)
					: await askSingleSelect(ctx, question);
				answers[question.question] = answer;
			}

			const output: AskUserQuestionOutput = { questions, answers, annotations };
			const resultText = formatResultText(answers, annotations);

			return {
				content: [{ type: "text" as const, text: resultText }],
				details: output,
			};
		},
	};
}
