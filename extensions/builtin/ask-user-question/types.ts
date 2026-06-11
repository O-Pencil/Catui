/**
 * [WHO]: QuestionOption, Question, AskUserQuestionInput, AskUserQuestionOutput, schema definitions
 * [FROM]: 1:1 ported from Claude Code AskUserQuestion Zod schemas → TypeBox
 * [TO]: Consumed by ./ask-user-question-tool.ts
 * [HERE]: extensions/builtin/ask-user-question/types.ts - TypeBox schemas for AskUserQuestion tool
 */

import { type Static, Type } from "@sinclair/typebox";

// ============================================================================
// Option schema
// ============================================================================

export const QuestionOptionSchema = Type.Object({
	label: Type.String({
		description:
			"The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.",
	}),
	description: Type.String({
		description:
			"Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
	}),
	preview: Type.Optional(
		Type.String({
			description:
				"Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format.",
		}),
	),
});

export type QuestionOption = Static<typeof QuestionOptionSchema>;

// ============================================================================
// Question schema
// ============================================================================

export const QuestionSchema = Type.Object({
	question: Type.String({
		description:
			'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
	}),
	header: Type.String({
		description:
			'Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".',
	}),
	options: Type.Array(QuestionOptionSchema, {
		minItems: 2,
		maxItems: 4,
		description:
			"The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically.",
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			default: false,
			description:
				"Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
		}),
	),
});

export type Question = Static<typeof QuestionSchema>;

// ============================================================================
// Annotations schema
// ============================================================================

const AnnotationEntrySchema = Type.Object({
	preview: Type.Optional(
		Type.String({
			description: "The preview content of the selected option, if the question used previews.",
		}),
	),
	notes: Type.Optional(
		Type.String({
			description: "Free-text notes the user added to their selection.",
		}),
	),
});

export const AnnotationsSchema = Type.Optional(
	Type.Record(Type.String(), AnnotationEntrySchema, {
		description:
			"Optional per-question annotations from the user (e.g., notes on preview selections). Keyed by question text.",
	}),
);

export type Annotations = Static<typeof AnnotationsSchema>;

// ============================================================================
// Input schema
// ============================================================================

export const AskUserQuestionInputSchema = Type.Object({
	questions: Type.Array(QuestionSchema, {
		minItems: 1,
		maxItems: 4,
		description: "Questions to ask the user (1-4 questions)",
	}),
	answers: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description: "User answers collected by the permission component",
		}),
	),
	annotations: AnnotationsSchema,
	metadata: Type.Optional(
		Type.Object(
			{
				source: Type.Optional(
					Type.String({
						description:
							'Optional identifier for the source of this question (e.g., "remember" for /remember command). Used for analytics tracking.',
					}),
				),
			},
			{
				description:
					"Optional metadata for tracking and analytics purposes. Not displayed to user.",
			},
		),
	),
});

export type AskUserQuestionInput = Static<typeof AskUserQuestionInputSchema>;

// ============================================================================
// Output schema
// ============================================================================

export const AskUserQuestionOutputSchema = Type.Object({
	questions: Type.Array(QuestionSchema, {
		description: "The questions that were asked",
	}),
	answers: Type.Record(Type.String(), Type.String(), {
		description:
			"The answers provided by the user (question text -> answer string; multi-select answers are comma-separated)",
	}),
	annotations: AnnotationsSchema,
});

export type AskUserQuestionOutput = Static<typeof AskUserQuestionOutputSchema>;

// ============================================================================
// Uniqueness validation
// ============================================================================

export function validateUniqueness(questions: Question[]): string | null {
	const questionTexts = questions.map((q) => q.question);
	if (questionTexts.length !== new Set(questionTexts).size) {
		return "Question texts must be unique, option labels must be unique within each question";
	}
	for (const q of questions) {
		const labels = q.options.map((o) => o.label);
		if (labels.length !== new Set(labels).size) {
			return "Question texts must be unique, option labels must be unique within each question";
		}
	}
	return null;
}
