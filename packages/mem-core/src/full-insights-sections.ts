/**
 * [WHO]: generateParallelFullInsightSections(), FullInsightsSectionPayload
 * [FROM]: Depends on ./llm-json and ./types for structured LLM section generation
 * [TO]: Consumed by full-insights.ts to improve /mem-insights narrative quality
 * [HERE]: packages/mem-core/src/full-insights-sections.ts - Claude-style parallel section generation without copying upstream implementation
 */

import { parseLlmJson } from "./llm-json.js";
import type {
	FullInsightsAtAGlance,
	FullInsightsFeatureToTry,
	FullInsightsFriction,
	FullInsightsProjectArea,
	FullInsightsUsagePattern,
	FullInsightsWin,
	LlmFn,
	MemoryEntry,
	PatternInsight,
	StruggleInsight,
} from "./types.js";

export interface FullInsightsSectionPayload {
	atAGlance?: FullInsightsAtAGlance;
	projectAreaDescriptions?: string[];
	wins?: FullInsightsWin[];
	frictions?: FullInsightsFriction[];
	recommendations?: string[];
	featuresToTry?: FullInsightsFeatureToTry[];
	usagePatterns?: FullInsightsUsagePattern[];
}

export interface FullInsightsSectionContext {
	locale: string;
	stats: {
		totalSessions: number;
		episodes: number;
		work: number;
		knowledge: number;
		lessons: number;
		facets: number;
		aggregateToolCount: number;
		aggregateFileCount: number;
	};
	patterns: PatternInsight[];
	struggles: StruggleInsight[];
	lessons: MemoryEntry[];
	projectAreas: FullInsightsProjectArea[];
	topTools: Array<{ label: string; value: number }>;
	topLanguages: Array<{ label: string; value: number }>;
	topErrors: Array<{ label: string; value: number }>;
}

type SectionName =
	| "project_areas"
	| "wins"
	| "frictions"
	| "recommendations"
	| "features"
	| "usage_patterns";

interface SectionSpec {
	name: SectionName;
	prompt: string;
}

function compactContext(context: FullInsightsSectionContext): Record<string, unknown> {
	return {
		locale: context.locale,
		stats: context.stats,
		projectAreas: context.projectAreas.slice(0, 8).map((area) => ({
			name: area.name,
			sessionCount: area.sessionCount,
			description: area.description,
		})),
		patterns: context.patterns.slice(0, 8).map((pattern) => ({
			trigger: pattern.trigger,
			behavior: pattern.behavior,
			weight: Number(pattern.weight.toFixed(2)),
		})),
		struggles: context.struggles.slice(0, 8).map((struggle) => ({
			problem: struggle.problem,
			resolved: struggle.resolved,
			attempts: struggle.attempts.slice(0, 3),
			solution: struggle.solution,
			weight: Number(struggle.weight.toFixed(2)),
		})),
		lessons: context.lessons.slice(0, 8).map((lesson) => lesson.summary || lesson.detail || lesson.content || ""),
		topTools: context.topTools.slice(0, 8),
		topLanguages: context.topLanguages.slice(0, 8),
		topErrors: context.topErrors.slice(0, 8),
	};
}

function sectionSpecs(locale: string): SectionSpec[] {
	const languageRule =
		locale === "zh"
			? "Write the JSON string values in concise natural Chinese."
			: "Write the JSON string values in concise natural English.";
	return [
		{
			name: "project_areas",
			prompt: `Identify the main project/work areas from this developer memory report.
${languageRule}
Return ONLY valid JSON:
{"descriptions":["one description per provided project area, preserving order"]}`,
		},
		{
			name: "wins",
			prompt: `Find concrete workflows that are working well. Avoid generic praise; use evidence from tools, lessons, resolved struggles, or project areas.
${languageRule}
Return ONLY valid JSON:
{"wins":[{"title":"3-7 word title","description":"2-3 specific sentences"}]}`,
		},
		{
			name: "frictions",
			prompt: `Find recurring friction. Prefer root causes over symptoms and include examples when available.
${languageRule}
Return ONLY valid JSON:
{"frictions":[{"title":"short category","description":"1-2 sentences","examples":["specific example"]}]}`,
		},
		{
			name: "recommendations",
			prompt: `Suggest direct behavior changes. Each recommendation should be actionable enough to try in the next session.
${languageRule}
Return ONLY valid JSON:
{"recommendations":["recommendation sentence"]}`,
		},
		{
			name: "features",
			prompt: `Suggest NanoPencil features or workflows this user should try based on their actual usage. Prefer skills, MCP, hooks, headless commands, subagents, recap, memory, or token-save only when evidence supports it.
${languageRule}
Return ONLY valid JSON:
{"featuresToTry":[{"title":"feature/workflow","oneLiner":"what it does","whyForYou":"why this user should try it","exampleCode":"optional command or config"}]}`,
		},
		{
			name: "usage_patterns",
			prompt: `Suggest reusable prompt/workflow patterns. Make each one copyable and grounded in the reported friction or wins.
${languageRule}
Return ONLY valid JSON:
{"usagePatterns":[{"title":"pattern","summary":"short summary","detail":"how to apply it","pastePrompt":"copyable prompt"}]}`,
		},
	];
}

async function generateSection(
	spec: SectionSpec,
	contextJson: string,
	llmFn: LlmFn,
): Promise<{ name: SectionName; result: Record<string, unknown> | null }> {
	try {
		const raw = await llmFn(
			"You write structured developer usage insights. Output only valid JSON matching the requested schema.",
			`${spec.prompt}\n\nDATA:\n${contextJson}`,
		);
		const parsed = parseLlmJson<Record<string, unknown>>(raw);
		return { name: spec.name, result: parsed && typeof parsed === "object" ? parsed : null };
	} catch {
		return { name: spec.name, result: null };
	}
}

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
	return items.length ? items : undefined;
}

function asWins(value: unknown): FullInsightsWin[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const wins = value
		.map((item) => item as Partial<FullInsightsWin>)
		.filter((item) => typeof item.title === "string" && typeof item.description === "string")
		.map((item) => ({ title: item.title!, description: item.description! }));
	return wins.length ? wins : undefined;
}

function asFrictions(value: unknown): FullInsightsFriction[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const frictions = value
		.map((item) => item as Partial<FullInsightsFriction>)
		.filter((item) => typeof item.title === "string" && typeof item.description === "string")
		.map((item) => ({
			title: item.title!,
			description: item.description!,
			examples: Array.isArray(item.examples)
				? item.examples.filter((example): example is string => typeof example === "string")
				: undefined,
		}));
	return frictions.length ? frictions : undefined;
}

function asFeatures(value: unknown): FullInsightsFeatureToTry[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const features = value
		.map((item) => item as Partial<FullInsightsFeatureToTry>)
		.filter((item) => typeof item.title === "string" && typeof item.oneLiner === "string" && typeof item.whyForYou === "string")
		.map((item) => ({
			title: item.title!,
			oneLiner: item.oneLiner!,
			whyForYou: item.whyForYou!,
			exampleCode: typeof item.exampleCode === "string" ? item.exampleCode : undefined,
		}));
	return features.length ? features : undefined;
}

function asUsagePatterns(value: unknown): FullInsightsUsagePattern[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const patterns = value
		.map((item) => item as Partial<FullInsightsUsagePattern>)
		.filter((item) => typeof item.title === "string" && typeof item.summary === "string" && typeof item.detail === "string")
		.map((item) => ({
			title: item.title!,
			summary: item.summary!,
			detail: item.detail!,
			pastePrompt: typeof item.pastePrompt === "string" ? item.pastePrompt : undefined,
		}));
	return patterns.length ? patterns : undefined;
}

function mergeSectionPayload(results: Array<{ name: SectionName; result: Record<string, unknown> | null }>): FullInsightsSectionPayload {
	const payload: FullInsightsSectionPayload = {};
	for (const { name, result } of results) {
		if (!result) continue;
		if (name === "project_areas") payload.projectAreaDescriptions = asStringArray(result.descriptions);
		if (name === "wins") payload.wins = asWins(result.wins);
		if (name === "frictions") payload.frictions = asFrictions(result.frictions);
		if (name === "recommendations") payload.recommendations = asStringArray(result.recommendations);
		if (name === "features") payload.featuresToTry = asFeatures(result.featuresToTry);
		if (name === "usage_patterns") payload.usagePatterns = asUsagePatterns(result.usagePatterns);
	}
	return payload;
}

async function generateAtAGlance(
	contextJson: string,
	sections: FullInsightsSectionPayload,
	llmFn: LlmFn,
	locale: string,
): Promise<FullInsightsAtAGlance | undefined> {
	const languageRule =
		locale === "zh"
			? "Write concise natural Chinese."
			: "Write concise natural English.";
	try {
		const raw = await llmFn(
			"You write executive summaries for developer usage reports. Output only valid JSON.",
			`${languageRule}
Synthesize the section outputs into four short, candid coaching blurbs.
Return ONLY valid JSON:
{"working":"what is working","hindering":"what is hindering","quickWins":"quick wins to try","ambitious":"ambitious workflows to prepare for"}

BASE DATA:
${contextJson}

SECTION OUTPUTS:
${JSON.stringify(sections, null, 2)}`,
		);
		const parsed = parseLlmJson<Partial<FullInsightsAtAGlance>>(raw);
		if (
			typeof parsed?.working === "string" &&
			typeof parsed.hindering === "string" &&
			typeof parsed.quickWins === "string" &&
			typeof parsed.ambitious === "string"
		) {
			return {
				working: parsed.working,
				hindering: parsed.hindering,
				quickWins: parsed.quickWins,
				ambitious: parsed.ambitious,
			};
		}
	} catch {
		// Keep caller fallbacks.
	}
	return undefined;
}

export async function generateParallelFullInsightSections(
	context: FullInsightsSectionContext,
	llmFn: LlmFn,
): Promise<FullInsightsSectionPayload> {
	const contextJson = JSON.stringify(compactContext(context), null, 2);
	const results = await Promise.all(sectionSpecs(context.locale).map((spec) => generateSection(spec, contextJson, llmFn)));
	const payload = mergeSectionPayload(results);
	const atAGlance = await generateAtAGlance(contextJson, payload, llmFn, context.locale);
	if (atAGlance) payload.atAGlance = atAGlance;
	return payload;
}
