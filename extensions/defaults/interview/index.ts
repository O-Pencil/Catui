/**
 * [WHO]: Extension entry with /interview, /grill-me, interview tool registration, renderers, and lightweight before_agent_start hook
 * [FROM]: Depends on core/extensions/types.ts, core/session/session-manager.ts, interview-runtime.ts
 * [TO]: Loaded by core/extensions/loader.ts as extension entry point
 * [HERE]: extensions/defaults/interview - requirement clarification extension
 */

import { type Static, Type } from "@sinclair/typebox";
import { Box, Container, Spacer, Text, visibleWidth, type Component } from "@pencil-agent/tui";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	RegisteredCommand,
} from "../../../core/extensions/types.js";
import type { ReadonlySessionManager } from "../../../core/session/session-manager.js";
import {
	buildInjectionText,
	buildWorkspaceContext,
	getSuggestedInterviewMode,
	hasAmbiguitySignal,
	isLoopManagedPrompt,
	isTaskLikePrompt,
	runInterview,
	runProbe,
	textByLanguage,
	type InterviewMode,
	type MissingSlot,
} from "./interview-runtime.js";

const INTERVIEW_CUSTOM_TYPE = "interview_refined";
const GRILL_CUSTOM_TYPE = "grill_summary";

const CUSTOM_MESSAGE_SAFE_WIDTH = 56;


function getUserTextFromSessionManager(sm: ReadonlySessionManager): string | undefined {
	const entries = sm.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "message") continue;
		const msg = entry.message as unknown as Record<string, unknown>;
		if (msg.role !== "user") continue;
		const content = msg.content;
		if (typeof content === "string") return content;
		if (Array.isArray(content)) {
			const parts = content
				.filter((b: Record<string, unknown>) => b && b.type === "text" && typeof b.text === "string")
				.map((b: Record<string, unknown>) => b.text as string);
			const text = parts.join("\n").trim();
			if (text) return text;
		}
	}
	return undefined;
}

function buildToolResultText(refinedIntent: string): string {
	return refinedIntent;
}

const interviewToolSchema = Type.Object({
	query: Type.String({ description: "The user's original request/intent" }),
	mode: Type.Optional(Type.Union([Type.Literal("clarify"), Type.Literal("grill")], { description: "Clarify missing requirements or grill/stress-test a plan. Defaults to clarify." })),
	maxRounds: Type.Optional(Type.Number({ description: "Max follow-up rounds (default: 3)" })),
	answers: Type.Optional(Type.Record(Type.String(), Type.String())),
});

type InterviewToolInput = Static<typeof interviewToolSchema>;

function normalizeMode(value: unknown): InterviewMode {
	return value === "grill" ? "grill" : "clarify";
}

function maxRoundsForMode(mode: InterviewMode, requested: unknown): number {
	const fallback = mode === "grill" ? 5 : 3;
	return typeof requested === "number" ? Math.max(1, Math.min(5, requested)) : fallback;
}

function customTypeForMode(mode: InterviewMode): string {
	return mode === "grill" ? GRILL_CUSTOM_TYPE : INTERVIEW_CUSTOM_TYPE;
}

function formatMissingSlotsForDetails(slots: MissingSlot[]): Array<{ key: string; question: string; recommendedAnswer?: string }> {
	return slots.map((s) => ({
		key: s.key,
		question: s.question,
		...(s.recommendedAnswer ? { recommendedAnswer: s.recommendedAnswer } : {}),
	}));
}

function buildGrillStartMessage(original: string): string {
	return [
		textByLanguage(original, "Grilling：正在读取项目上下文并生成第一轮追问。", "Grilling: reading project context and preparing the first follow-up."),
		"",
		textByLanguage(original, "初始目标：", "Initial goal:"),
		original,
		"",
		textByLanguage(original, "后续会把已确认内容整理成 Grill Summary。", "Confirmed answers will be turned into a Grill Summary."),
	].join("\n");
}

function buildGrillAnsweredMessage(original: string, slot: MissingSlot, value: string, round: number): string {
	return [
		textByLanguage(original, `Grilling：已确认第 ${round} 个回答，正在生成下一轮追问。`, `Grilling: confirmed answer ${round}; preparing the next follow-up.`),
		"",
		textByLanguage(original, "问题：", "Question:"),
		slot.question,
		"",
		textByLanguage(original, "回答：", "Answer:"),
		value,
	].join("\n");
}

type CustomMessageTheme = {
	bg(key: string, value: string): string;
	fg(key: string, value: string): string;
};

function wrapPlainLineToWidth(line: string, width: number): string[] {
	if (!line) return [""];
	const out: string[] = [];
	let current = "";
	for (const char of line) {
		if (current && visibleWidth(current + char) > width) {
			out.push(current);
			current = char;
		} else {
			current += char;
		}
	}
	if (current) out.push(current);
	return out;
}

function renderSafeCustomMessage(message: { content?: unknown }, theme: CustomMessageTheme): Component {
	const text =
		typeof message.content === "string"
			? message.content
			: Array.isArray(message.content)
				? message.content
						.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
						.map((part) => part.text)
						.join("\n")
				: JSON.stringify(message.content ?? "");

	const safeText = text
		.split(/\r?\n/)
		.flatMap((line) => wrapPlainLineToWidth(line, CUSTOM_MESSAGE_SAFE_WIDTH))
		.slice(0, 80)
		.join("\n");

	const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
	box.addChild(new Text(theme.fg("customMessageText", safeText), 0, 0));
	const container = new Container();
	container.addChild(new Spacer(1));
	container.addChild(box);
	return container;
}

async function runInterviewCommand(
	api: ExtensionAPI,
	args: string,
	ctx: ExtensionCommandContext,
	mode: InterviewMode,
): Promise<void> {
	const original = (args || "").trim() || getUserTextFromSessionManager(ctx.sessionManager) || "";
	if (!original) {
		ctx.ui.notify(`${mode === "grill" ? "Grill" : "Interview"}: no request found to clarify`, "warning");
		return;
	}

	try {
		if (mode === "grill") {
			api.sendMessage({
				customType: GRILL_CUSTOM_TYPE,
				content: buildGrillStartMessage(original),
				display: true,
				details: { mode, phase: "start", original_intent: original },
			});
		}
		ctx.ui.setWorkingMessage?.(
			mode === "grill"
				? textByLanguage(original, "Grilling：正在读取项目上下文并准备第一轮追问...", "Grilling: reading project context and preparing the first follow-up...")
				: "Interview: reading context and preparing clarification...",
		);
		const { refinedIntent, completionScore, answers, missingSlotsRemaining, cancelled } = await runInterview(
			ctx,
			mode,
			original,
			maxRoundsForMode(mode, undefined),
			{},
			mode === "grill"
				? (slot, value, round) => {
						api.sendMessage({
							customType: GRILL_CUSTOM_TYPE,
							content: buildGrillAnsweredMessage(original, slot, value, round),
							display: true,
							details: { mode, phase: "answered", round, key: slot.key, answer: value },
						});
					}
				: undefined,
		);
		if (cancelled) {
			ctx.ui.notify(mode === "grill" ? "Exited grill mode. No summary was generated and no follow-up turn was started." : "Interview cancelled. No refined intent was generated.", "info");
			return;
		}

		ctx.ui.setWorkingMessage?.(mode === "grill" ? textByLanguage(original, "Grilling：正在整理 summary 并准备下一轮...", "Grilling: writing summary for the next turn...") : "Interview: writing refined intent...");
		const injectionText = buildInjectionText({
			mode,
			originalIntent: original,
			refinedIntent,
			completionScore,
			answers,
			missingSlotsRemaining,
		});

		api.sendMessage(
			{
				customType: customTypeForMode(mode),
				content: injectionText,
				display: true,
				details: {
					mode,
					original_intent: original,
					refined_intent: refinedIntent,
					completion_score: completionScore,
					answers,
					missing_slots: formatMissingSlotsForDetails(missingSlotsRemaining),
				},
			},
			{ triggerTurn: true },
		);
	} finally {
		ctx.ui.setWorkingMessage?.();
	}
}

export default async function interviewExtension(api: ExtensionAPI) {
	api.registerMessageRenderer(INTERVIEW_CUSTOM_TYPE, (message, _options, theme) => renderSafeCustomMessage(message, theme));
	api.registerMessageRenderer(GRILL_CUSTOM_TYPE, (message, _options, theme) => renderSafeCustomMessage(message, theme));

	// Register /interview command for manual clarification
	api.registerCommand("interview", {
		description: "Turn a rough request into clear next steps.",
		handler: async (args: string, ctx: ExtensionCommandContext) => runInterviewCommand(api, args, ctx, "clarify"),
	} satisfies Omit<RegisteredCommand, "name">);

	api.registerCommand("grill-me", {
		description: "Challenge a plan with focused follow-up questions.",
		handler: async (args: string, ctx: ExtensionCommandContext) => runInterviewCommand(api, args, ctx, "grill"),
	} satisfies Omit<RegisteredCommand, "name">);

	// Register interview tool for Agent to call when needed
	api.registerTool({
		name: "interview",
		label: "Interview Clarifier",
		description:
			"When a task request is ambiguous, clarify goal/constraints/style/acceptance, or use mode=grill to stress-test a plan/design with one-question-at-a-time follow-ups and recommended answers.",
		parameters: interviewToolSchema,
		guidance:
			"Use mode=clarify for missing critical details (goal/deliverable/constraints/style/acceptance). Use mode=grill when the user asks to be grilled, says the requirement is unclear, or presents a plan/design/architecture that needs stress-testing. Do not use it for greetings/small talk/memory checks. If an interview_refined or grill_summary custom message is already present, do not repeat clarification.",
		async execute(_toolCallId, params: InterviewToolInput, _signal, _onUpdate, ctx: ExtensionContext) {
			const query = params.query;
			const mode = normalizeMode(params.mode);
			const maxRounds = maxRoundsForMode(mode, params.maxRounds);
			const answersFromModel = (params.answers ?? {}) as Record<string, string>;

			// Start from provided answers (if any) then allow extra clarifications.
			const answers = { ...answersFromModel };
			const capabilities = {
				hasUI: ctx.hasUI,
				mode: ctx.hasUI ? ("interactive" as const) : ("nonInteractive" as const),
				cwd: ctx.cwd,
				model: ctx.model
					? { provider: ctx.model.provider, id: ctx.model.id, name: (ctx.model as unknown as Record<string, unknown>).name as string | undefined }
					: undefined,
			};

			if (isLoopManagedPrompt(query)) {
				return {
					content: [{ type: "text", text: query }],
					details: {
						mode,
						original_intent: query,
						refined_intent: query,
						completion_score: 1,
						answers,
						missing_slots: [],
					},
				};
			}

			// UI mode guard: prevent the model from triggering interactive interview for non-task prompts.
			if (ctx.hasUI && mode === "clarify" && !isTaskLikePrompt(query) && !hasAmbiguitySignal(query)) {
				return {
					content: [{ type: "text", text: query }],
					details: {
						mode,
						original_intent: query,
						refined_intent: query,
						completion_score: 1,
						answers,
						missing_slots: [],
					},
				};
			}

			// Non-UI / fallback: probe-only.
			if (!ctx.hasUI) {
				const probe = await runProbe(ctx, mode, query, answers, buildWorkspaceContext(ctx.cwd), capabilities);
				return {
					content: [{ type: "text", text: buildToolResultText(probe.refinedIntent) }],
					details: {
						mode,
						original_intent: query,
						refined_intent: probe.refinedIntent,
						completion_score: probe.completionScore,
						answers,
						missing_slots: formatMissingSlotsForDetails(probe.missingSlots),
					},
				};
			}

			// UI mode: ask sequentially, using already-provided answers as starting point.
			const {
				refinedIntent,
				completionScore,
				answers: resolvedAnswers,
				missingSlotsRemaining,
				cancelled,
			} = await runInterview(
				ctx,
				mode,
				query,
				maxRounds,
				answers,
			);
			if (cancelled) {
				return {
					content: [
						{
							type: "text",
							text: mode === "grill" ? "Grill cancelled by user. No summary generated." : "Interview cancelled by user. No refined intent generated.",
						},
					],
					details: {
						mode,
						original_intent: query,
						cancelled: true,
					},
				};
			}

			const injectionText = buildInjectionText({
				mode,
				originalIntent: query,
				refinedIntent,
				completionScore,
				answers: resolvedAnswers,
				missingSlotsRemaining,
			});

			return {
				content: [{ type: "text", text: injectionText }],
				details: {
					mode,
					original_intent: query,
					refined_intent: refinedIntent,
					completion_score: completionScore,
					answers: resolvedAnswers,
					missing_slots: formatMissingSlotsForDetails(missingSlotsRemaining),
				},
			};
		},
	});

	// ============================================================================
	// CRITICAL: before_agent_start hook - SYNCHRONOUS ONLY
	// ============================================================================
	//
	// This hook MUST be fast (<10ms). NO LLM calls, NO UI interactions.
	// If interview might be beneficial, return a lightweight hint and let the Agent
	// decide whether to call the interview tool.
	//
	// Previous implementation had race conditions:
	// - runProbe() is async LLM call (1-5 seconds)
	// - ctx.ui.confirm() blocks waiting for user
	// - These could complete AFTER the agent started, causing surprise popups
	//
	api.on("before_agent_start", async (event: BeforeAgentStartEvent, _ctx: ExtensionContext): Promise<BeforeAgentStartEventResult | undefined> => {
		const original = event.prompt?.trim();
		if (!original) return undefined;

		// FAST SYNCHRONOUS CHECK ONLY - no async operations
		const suggestedMode = getSuggestedInterviewMode(original);
		if (!suggestedMode) {
			return undefined;
		}

		// Return a lightweight system prompt hint.
		// Let the Agent decide whether to call the interview tool.
		// This is non-blocking and won't cause race conditions.
		if (suggestedMode === "grill") {
			return {
				appendSystemPrompt: `
[Grill Hint]
The user's request appears to need active requirement grilling or design stress-testing. Before implementation, strongly consider using the 'interview' tool with mode="grill" to ask one high-value follow-up question at a time, include your recommended answer, and produce a Grill Summary. If the prompt already contains enough concrete decisions, risks, dependencies, and acceptance criteria, proceed directly.
`.trim(),
			};
		}

		return {
			appendSystemPrompt: `
[Interview Hint]
The user's request may benefit from clarification. If the request seems ambiguous or missing critical details (goal/deliverable/constraints/acceptance criteria), consider using the 'interview' tool with mode="clarify" to interactively clarify before proceeding. If the request is already clear enough to start implementing, proceed directly without clarification.
`.trim(),
		};
	});
}
