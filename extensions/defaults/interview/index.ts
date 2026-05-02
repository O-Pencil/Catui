/**
 * [WHO]: Extension with /interview command, interview tool, and lightweight before_agent_start hook
 * [FROM]: Depends on core/extensions/types.ts, core/session/session-manager.ts
 * [TO]: Loaded by core/extensions/loader.ts as extension entry point
 * [HERE]: extensions/defaults/interview - requirement clarification extension
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
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

const INTERVIEW_CUSTOM_TYPE = "interview_refined";
const GRILL_CUSTOM_TYPE = "grill_summary";

type InterviewMode = "clarify" | "grill";
const CUSTOM_MESSAGE_SAFE_WIDTH = 56;

const INTERVIEW_PROBE_SYSTEM_PROMPT = `
You are an "Interview probe" engine that clarifies ambiguous user requests.

Your goals:
1) Estimate how complete the user's request is for immediate execution.
2) Output a completionScore (0..1). Higher means clearer.
3) If critical info is missing (goal/deliverable/constraints/style/acceptance), output missingSlots (highest priority first).
4) Always generate refinedIntent: rewrite the request into an executable specification. If something is unknown, use an explicit placeholder (e.g. "{TBD: ...}").
5) Use the response language specified by the user context. If it says Chinese, write refinedIntent, questions, options, and answers in Chinese. If it says English, write them in English.

Hard requirements:
- Output MUST be a single valid JSON object only. No extra text, no markdown, no code fences.
- JSON fields:
  - completionScore: number (0..1)
  - refinedIntent: string (always present, non-empty)
  - missingSlots: Array<{
      key: string,
      question: string,
      options?: string[],
      allowCustom?: boolean
    }>
- Rules:
  - If the request is already clear enough to start implementing, missingSlots MUST be [], and completionScore MUST be >= 0.8.
  - If the request is a greeting/small-talk/memory check/pure emotion (e.g. "hello", "do you remember me", "chat a bit"), treat it as clear enough: missingSlots MUST be [], completionScore MUST be >= 0.8, and refinedIntent can be a short restatement/response.
  - missingSlots MUST contain at most 3 items.
  - Prefer returning only the single most important missing slot.
  - question MUST be a single concise sentence (no long paragraphs).
  - options, when provided, MUST be short, directly selectable user options.
`.trim();

const INTERVIEW_GRILL_SYSTEM_PROMPT = `
You are a "Grill me" design interviewer that stress-tests a user's plan or request until it is executable.

Your goals:
1) Walk the decision tree one branch at a time.
2) Identify missing decisions, risky assumptions, dependencies, trade-offs, acceptance criteria, and rollback/verification gaps.
3) Ask only the single most valuable next question.
4) For every question, provide your recommended answer so the user can accept or edit it.
5) If a question can be answered from the codebase or runtime context, prefer saying what should be explored instead of asking the user.
6) Always generate refinedIntent as a concise Grill Summary that can feed planning or execution.
7) Use the response language specified by the user context. If it says Chinese, write refinedIntent, questions, options, and recommendedAnswer in Chinese. If it says English, write them in English.
8) Treat provided workspace context as known facts. Do NOT ask the user to restate facts that are present there.

Hard requirements:
- Output MUST be a single valid JSON object only. No extra text, no markdown, no code fences.
- JSON fields:
  - completionScore: number (0..1). Higher means the plan is ready to execute.
  - refinedIntent: string (always present, non-empty). Include confirmed decisions, risks, recommended path, and next step.
  - missingSlots: Array<{
      key: string,
      question: string,
      recommendedAnswer?: string,
      options?: string[],
      allowCustom?: boolean
    }>
- Rules:
  - missingSlots MUST contain at most 3 items.
  - Prefer returning only the single most important missing slot.
  - question MUST be a single concise sentence.
  - recommendedAnswer SHOULD be concrete and directly usable.
  - Do not invent a framework, language, package manager, or platform when workspace context is available. Use the provided package metadata and file layout.
  - If the plan is ready to execute, missingSlots MUST be [], and completionScore MUST be >= 0.8.
`.trim();

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}

function tryParseStrictJsonObject(text: string): unknown | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

const LOOP_PROMPT_PREFIX = "[LOOP:";

function isLoopManagedPrompt(prompt: string): boolean {
	const trimmed = prompt.trim();
	if (!trimmed) return false;

	return (
		trimmed.startsWith(LOOP_PROMPT_PREFIX) ||
		trimmed.includes("Autonomous loop goal:") ||
		trimmed.includes("You are inside a managed loop.")
	);
}

function hasExplicitGrillIntent(prompt: string): boolean {
	const p = prompt.trim();
	if (!p) return false;
	return /(grill me|grill-me|stress[- ]?test|pressure[- ]?test|challenge this|poke holes|拷问|追问我|追问一下|盘问|压测.*方案|方案.*压测|挑战.*方案|把关.*方案)/i.test(p);
}

function hasAmbiguitySignal(prompt: string): boolean {
	const p = prompt.trim();
	if (!p) return false;
	return /(ambiguous|unclear|not sure|unsure|vague|help me think|flesh out|requirements?|clarify|I don't know|我说不清|说不清楚|不确定|没想清楚|需求不清|需求不明确|帮我想|完善需求|梳理需求|澄清|先问我|问我几个问题)/i.test(p);
}

function hasDesignDecisionSignal(prompt: string): boolean {
	const p = prompt.trim();
	if (!p) return false;
	return /(architecture|architectural|design|proposal|plan|trade[- ]?off|migration|integration|workflow|roadmap|方案|架构|设计|规划|计划|取舍|权衡|集成|流程|重构|迁移|路线)/i.test(p);
}

function detectPromptLanguage(prompt: string): "zh" | "en" {
	return /[\u3400-\u9fff]/.test(prompt) ? "zh" : "en";
}

function languageInstructionForPrompt(prompt: string): string {
	return detectPromptLanguage(prompt) === "zh"
		? "Chinese (中文). Match the user's Chinese phrasing for follow-up questions, options, summaries, and recommended answers."
		: "English. Use natural English for follow-up questions, options, summaries, and recommended answers.";
}

function textByLanguage(prompt: string, zh: string, en: string): string {
	return detectPromptLanguage(prompt) === "zh" ? zh : en;
}

function truncateText(text: string, maxLength: number): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}

function readTextIfExists(path: string, maxLength: number): string | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const stats = statSync(path);
		if (!stats.isFile() || stats.size > 250_000) return undefined;
		return truncateText(readFileSync(path, "utf-8"), maxLength);
	} catch {
		return undefined;
	}
}

function buildWorkspaceContext(cwd: string | undefined): string {
	if (!cwd) return "(unavailable)";

	const lines: string[] = [`cwd: ${cwd}`, `projectNameFromPath: ${basename(cwd)}`];
	const packageJsonText = readTextIfExists(join(cwd, "package.json"), 4000);
	if (packageJsonText) {
		try {
			const pkg = JSON.parse(packageJsonText) as {
				name?: string;
				description?: string;
				type?: string;
				bin?: unknown;
				scripts?: Record<string, string>;
				workspaces?: unknown;
				dependencies?: Record<string, string>;
				devDependencies?: Record<string, string>;
			};
			lines.push("[package.json]");
			if (pkg.name) lines.push(`name: ${pkg.name}`);
			if (pkg.description) lines.push(`description: ${pkg.description}`);
			if (pkg.type) lines.push(`type: ${pkg.type}`);
			if (pkg.bin) lines.push(`bin: ${JSON.stringify(pkg.bin)}`);
			if (pkg.workspaces) lines.push(`workspaces: ${JSON.stringify(pkg.workspaces)}`);
			if (pkg.scripts) {
				const scripts = Object.entries(pkg.scripts)
					.slice(0, 12)
					.map(([key, value]) => `${key}=${value}`)
					.join("; ");
				lines.push(`scripts: ${scripts}`);
			}
			const deps = Object.keys(pkg.dependencies ?? {}).slice(0, 30);
			const devDeps = Object.keys(pkg.devDependencies ?? {}).slice(0, 30);
			if (deps.length) lines.push(`dependencies: ${deps.join(", ")}`);
			if (devDeps.length) lines.push(`devDependencies: ${devDeps.join(", ")}`);
		} catch {
			lines.push(`[package.json]\n${packageJsonText}`);
		}
	}

	const readme = readTextIfExists(join(cwd, "README.md"), 1200);
	if (readme) lines.push(`[README excerpt]\n${readme}`);

	const agents = readTextIfExists(join(cwd, "AGENTS.md"), 1200);
	if (agents) lines.push(`[AGENTS excerpt]\n${agents}`);

	try {
		const entries = readdirSync(cwd, { withFileTypes: true })
			.filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist")
			.slice(0, 40)
			.map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
		if (entries.length) lines.push(`[top-level entries]\n${entries.join(", ")}`);
	} catch {
		// best-effort only
	}

	return lines.join("\n");
}

function buildFallbackProbe(mode: InterviewMode, originalIntent: string): ProbeOutput {
	if (mode === "grill") {
		return {
			completionScore: 0.25,
			refinedIntent: textByLanguage(
				originalIntent,
				`原始请求：${originalIntent}\n\nGrill Summary（草稿）：先围绕启动性能优化建立可测量基线、阶段耗时拆分、优化边界和验收标准，再进入实现。`,
				`Original request: ${originalIntent}\n\nGrill Summary (draft): establish measurable startup baselines, phase timing, optimization boundaries, and acceptance criteria before implementation.`,
			),
			missingSlots: [
				{
					key: "measurement-baseline",
					question: textByLanguage(
						originalIntent,
						"这次启动性能优化最先要锁定哪一个可量化目标：冷启动总耗时、阶段耗时拆分，还是交互可用时间？",
						"Which measurable target should this startup optimization lock down first: cold-start total time, phase timing breakdown, or time-to-interactive?",
					),
					recommendedAnswer: textByLanguage(
						originalIntent,
						"先做阶段耗时拆分和冷启动总耗时基线，因为它能证明瓶颈在哪，也能避免只凭主观体感判断优化。",
						"Start with phase timing and cold-start total time baselines because they reveal bottlenecks and prevent subjective optimization claims.",
					),
					allowCustom: true,
				},
				{
					key: "scenario",
					question: textByLanguage(
						originalIntent,
						"启动性能测评要覆盖哪个真实场景：首次启动、已有会话恢复、加载扩展，还是 Gateway 托管创建 Agent？",
						"Which real startup scenario should the benchmark cover: first launch, session restore, extension loading, or Gateway-hosted agent creation?",
					),
					recommendedAnswer: textByLanguage(
						originalIntent,
						"先覆盖 CLI 冷启动和已有会话恢复，再把扩展加载单独拆为阶段指标；Gateway 场景作为后续独立基准。",
						"Cover CLI cold start and session restore first, then split extension loading into a separate phase metric; keep Gateway startup as a later benchmark.",
					),
					allowCustom: true,
				},
				{
					key: "acceptance",
					question: textByLanguage(
						originalIntent,
						"你希望用什么阈值证明优化有效：百分比下降、绝对耗时目标，还是多次运行的统计置信区间？",
						"What threshold should prove the optimization works: percentage reduction, absolute time target, or a confidence interval across repeated runs?",
					),
					recommendedAnswer: textByLanguage(
						originalIntent,
						"用多次运行的 p50/p95 加绝对耗时目标，并保存优化前后的原始结果，避免单次样本误导。",
						"Use repeated-run p50/p95 plus an absolute time target, and preserve raw before/after results to avoid single-sample bias.",
					),
					allowCustom: true,
				},
			],
		};
	}

	return {
		completionScore: 0.25,
		refinedIntent: textByLanguage(
			originalIntent,
			`原始请求：${originalIntent}\n\n缺少关键信息：交付物、约束、验收标准。`,
			`Original request: ${originalIntent}\n\nMissing critical info (TBD): deliverable, constraints, acceptance criteria.`,
		),
		missingSlots: [
			{
				key: "deliverable",
				question: textByLanguage(
					originalIntent,
					"你最终希望交付什么结果，例如代码改动、设计文档、测试脚本还是测评报告？",
					"What is the final deliverable/output you want (e.g., code, doc, tests, script, or report)?",
				),
				allowCustom: true,
			},
			{
				key: "constraints",
				question: textByLanguage(
					originalIntent,
					"有哪些硬约束，例如语言、框架、运行环境、必须复用或必须避免的方案？",
					"Any hard constraints (language/framework/runtime/must-use libraries/things to avoid)?",
				),
				allowCustom: true,
			},
			{
				key: "acceptance",
				question: textByLanguage(
					originalIntent,
					"如何验收这个结果，例如测试、性能目标、输出格式或示例输入输出？",
					"How should we validate/accept the result (tests, performance target, format, sample I/O)?",
				),
				allowCustom: true,
			},
		],
	};
}

/**
 * Check if the prompt looks like a task that might need clarification.
 * This is a SYNCHRONOUS heuristic check - no LLM calls.
 */
function isTaskLikePrompt(prompt: string): boolean {
	const p = prompt.trim();
	if (!p) return false;

	// Clear task intent (verbs / outcomes).
	const taskVerbPattern =
		/(do|write|implement|develop|design|create|build|make|generate|setup|deploy|construct|fix|optimize|refactor|improve|enhance|output|deliver|plan|specify|explain)/i;
	const outputPattern =
		/(website|portfolio|page|frontend|backend|UI|interface|code|program|script|document|README|PRD|test|unit test|API|database|SQL|feature|requirement|solution|plan|system|platform|app|module|service|component)/i;

	// "review/debug" intent e.g. "help me review this code/error"
	const reviewPattern = /(review|check|analyze|debug|diagnose|investigate)/i;
	const reviewTargetPattern = /(code|error|bug|exception|log|trace|stack|SQL)/i;

	// Request signals are often used with task verbs, but keep them optional.
	const requestSignalPattern = /(help me|please|can you|could you|I need|I want|would you)/i;

	const hasTaskVerb = taskVerbPattern.test(p);
	const hasOutput = outputPattern.test(p);

	// Combined heuristics reduce false positives from greetings/chitchat.
	const looksLikeRequest = requestSignalPattern.test(p) || hasOutput;
	if ((hasTaskVerb && looksLikeRequest) || (hasOutput && hasTaskVerb)) return true;

	// Special case: review/debug without explicit task verb.
	if (reviewPattern.test(p) && reviewTargetPattern.test(p)) return true;

	return false;
}

function isNonTaskPrompt(prompt: string): boolean {
	const p = prompt.trim();
	if (!p) return false;

	// Greetings / small talk.
	const greetingPattern = /^(hello|hi|hey|good morning|good afternoon|good evening)\b/i;
	const chitchatPattern = /(chat|casual talk|small talk|bored|just chatting|let's talk)/i;

	// Memory / identity checks.
	const memoryPattern = /(do you remember me|remember me|you remember|do you know me|forgot me|who are you)/i;

	// Generic "whatever" agreement without a concrete deliverable.
	const vagueAgreementPattern = /(whatever|anything is fine|up to you|you decide|doesn't matter)/i;

	// If it matches a non-task pattern AND it's not task-like, treat it as non-task.
	if (greetingPattern.test(p)) return !isTaskLikePrompt(p);
	if (chitchatPattern.test(p)) return !isTaskLikePrompt(p);
	if (memoryPattern.test(p)) return !isTaskLikePrompt(p);
	if (vagueAgreementPattern.test(p) && !isTaskLikePrompt(p)) return true;

	// Keep "very short" from triggering interview, but we can still classify short non-task messages as non-task.
	if (p.length < 20 && !isTaskLikePrompt(p)) return true;

	return false;
}

/**
 * Check if the prompt is detailed enough that it probably doesn't need clarification.
 * Longer prompts with technical details are likely self-sufficient.
 */
function isDetailedPrompt(prompt: string): boolean {
	const p = prompt.trim();

	if (hasExplicitGrillIntent(p) || hasAmbiguitySignal(p) || hasDesignDecisionSignal(p)) {
		return false;
	}

	// Prompts over 150 characters likely have enough context
	if (p.length > 150) return true;

	// Contains specific technical terms that indicate clarity
	const technicalTerms = /(react|vue|angular|node|typescript|javascript|python|rust|go|java|docker|kubernetes|api|rest|graphql|sql|mongodb|redis|aws|gcp|azure|linux|macos|windows)/i;
	if (technicalTerms.test(p)) return true;

	// Contains file paths or code references
	const codeReferences = /(\.\w+|\/\w+|\\w+|\.\w{1,4}\b|`[^`]+`)/;
	if (codeReferences.test(p)) return true;

	// Debug/review requests - user will provide code/error context
	// e.g., "help me review this code", "check this error", "debug this"
	const debugPattern = /(review|check|analyze|debug|diagnose|investigate)/i;
	const debugTargetPattern = /(code|error|bug|exception|log|issue|script|program|function|method)/i;
	if (debugPattern.test(p) && debugTargetPattern.test(p)) return true;

	return false;
}

function getSuggestedInterviewMode(prompt: string): InterviewMode | undefined {
	if (process.env.NANOPENCIL_JUST_SWITCHED_PERSONA === "true") {
		return undefined;
	}

	if (isLoopManagedPrompt(prompt)) {
		return undefined;
	}

	if (hasExplicitGrillIntent(prompt)) {
		return "grill";
	}

	if (isNonTaskPrompt(prompt)) return undefined;

	if (hasAmbiguitySignal(prompt)) {
		return hasDesignDecisionSignal(prompt) ? "grill" : "clarify";
	}

	if (hasDesignDecisionSignal(prompt) && isTaskLikePrompt(prompt)) {
		return "grill";
	}

	if (isDetailedPrompt(prompt)) return undefined;

	return isTaskLikePrompt(prompt) ? "clarify" : undefined;
}

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

type MissingSlot = {
	key: string;
	question: string;
	recommendedAnswer?: string;
	options?: string[];
	allowCustom?: boolean;
};

type ProbeOutput = {
	completionScore: number;
	refinedIntent: string;
	missingSlots: MissingSlot[];
};

function buildProbeContext(input: {
	originalIntent: string;
	answers: Record<string, string>;
	workspaceContext: string;
	capabilities: {
		hasUI: boolean;
		mode: "interactive" | "nonInteractive";
		cwd?: string;
		model?: { provider?: string; id?: string; name?: string };
	};
}): string {
	return [
		"[Original request]",
		input.originalIntent,
		"",
		"[Response language]",
		languageInstructionForPrompt(input.originalIntent),
		"",
		"[Workspace context]",
		input.workspaceContext,
		"",
		"[Known answers (JSON)]",
		JSON.stringify(input.answers),
		"",
		"[Runtime capabilities (JSON)]",
		JSON.stringify(input.capabilities),
	].join("\n").trim();
}

function normalizeMissingSlots(raw: unknown): MissingSlot[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const out: MissingSlot[] = [];
	for (const s of raw) {
		if (!s || typeof s !== "object") continue;
		const key = typeof (s as Record<string, unknown>).key === "string" ? String((s as Record<string, unknown>).key).trim() : "";
		const question = typeof (s as Record<string, unknown>).question === "string" ? String((s as Record<string, unknown>).question).trim() : "";
		if (!key || !question) continue;
		if (seen.has(key)) continue;
		seen.add(key);
		const recommendedAnswer =
			typeof (s as Record<string, unknown>).recommendedAnswer === "string"
				? String((s as Record<string, unknown>).recommendedAnswer).trim()
				: undefined;
		const options =
			Array.isArray((s as Record<string, unknown>).options) && (s as Record<string, unknown>).options
				? ((s as Record<string, unknown>).options as unknown[]).map((v: unknown) => String(v).trim()).filter(Boolean).slice(0, 6)
				: undefined;
		const allowCustom = typeof (s as Record<string, unknown>).allowCustom === "boolean" ? (s as Record<string, unknown>).allowCustom : undefined;
		out.push({
			key: key.slice(0, 40),
			question: question.slice(0, 220),
			recommendedAnswer: recommendedAnswer ? recommendedAnswer.slice(0, 500) : undefined,
			options: options as string[] | undefined,
			allowCustom: allowCustom as boolean | undefined,
		});
		if (out.length >= 3) break;
	}
	return out;
}

function coerceProbeOutput(parsed: unknown, fallback: ProbeOutput): ProbeOutput {
	if (!parsed || typeof parsed !== "object") return fallback;
	const p = parsed as Record<string, unknown>;

	let completionScore = clamp01(typeof p.completionScore === "number" ? p.completionScore : fallback.completionScore);
	let refinedIntent =
		typeof p.refinedIntent === "string" && p.refinedIntent.toString().trim() ? p.refinedIntent.toString().trim() : fallback.refinedIntent;
	let missingSlots = normalizeMissingSlots(p.missingSlots);

	// Consistency guards:
	if (completionScore < 0.8 && missingSlots.length === 0) {
		missingSlots = fallback.missingSlots;
		completionScore = Math.min(0.6, completionScore || 0.6);
	}
	if (completionScore >= 0.8 && missingSlots.length > 0) {
		missingSlots = [];
	}
	if (!refinedIntent.trim()) refinedIntent = fallback.refinedIntent;

	return { completionScore, refinedIntent, missingSlots };
}

async function runProbe(
	ctx: ExtensionContext,
	mode: InterviewMode,
	originalIntent: string,
	answers: Record<string, string>,
	workspaceContext: string,
	capabilities: {
		hasUI: boolean;
		mode: "interactive" | "nonInteractive";
		cwd?: string;
		model?: { provider?: string; id?: string; name?: string };
	},
): Promise<ProbeOutput> {
	const userMessage = buildProbeContext({ originalIntent, answers, workspaceContext, capabilities });
	const raw = await ctx.completeSimple(mode === "grill" ? INTERVIEW_GRILL_SYSTEM_PROMPT : INTERVIEW_PROBE_SYSTEM_PROMPT, userMessage);
	const fallback = buildFallbackProbe(mode, originalIntent);

	if (!raw) return fallback;

	const parsed = tryParseStrictJsonObject(raw);
	return coerceProbeOutput(parsed, fallback);
}

async function askSlotWithUI(ctx: ExtensionContext, mode: InterviewMode, round: number, slot: MissingSlot): Promise<string | undefined> {
	const isZh = detectPromptLanguage(slot.question) === "zh" || detectPromptLanguage(slot.recommendedAnswer ?? "") === "zh";
	const prefix = mode === "grill"
		? isZh ? "Grill 追问" : "Grill follow-up"
		: isZh ? "需求澄清" : "Interview clarification";
	const recommendation = slot.recommendedAnswer ? `\n${isZh ? "建议回答" : "Recommended"}: ${slot.recommendedAnswer}` : "";
	const title = `${prefix} (${round}): ${slot.question}${recommendation}`;

	if (slot.recommendedAnswer && ctx.hasUI) {
		const useRecommended = isZh ? "使用建议回答" : "Use recommended answer";
		const custom = isZh ? "自定义回答" : "Custom answer";
		const choice = await ctx.ui.select(title, [useRecommended, custom]);
		if (!choice) return undefined;
		if (choice === useRecommended) return slot.recommendedAnswer;
		const v = await ctx.ui.input(
			isZh ? `输入自定义回答：${slot.key}（Enter 提交，Esc 取消）` : `Enter a custom answer: ${slot.key} (Enter to submit, Esc to cancel)`,
			isZh ? "请输入你的自定义回答" : "Type your custom answer",
		);
		return v?.trim();
	}

	if (slot.options && slot.options.length > 0 && ctx.hasUI) {
		const options = [...slot.options];
		const allowCustom = slot.allowCustom === true;
		const customIndex = allowCustom ? options.length : -1;
		const customOption = isZh ? "其他（自定义）" : "Other (custom)";
		if (allowCustom) options.push(customOption);

		const choice = await ctx.ui.select(title, options);
		if (!choice) return undefined;
		if (slot.recommendedAnswer && choice === `${isZh ? "使用建议回答" : "Use recommended"}: ${slot.recommendedAnswer}`) {
			return slot.recommendedAnswer;
		}
		if (customIndex !== -1 && choice === customOption) {
			const v = await ctx.ui.input(isZh ? `输入自定义回答：${slot.key}` : `Enter a custom answer: ${slot.key}`, slot.question);
			return v?.trim();
		}
		return choice.trim();
	}

	if (!ctx.hasUI) return undefined;
	const v = await ctx.ui.input(title, slot.question);
	return v?.trim();
}

type InterviewResult = {
	refinedIntent: string;
	completionScore: number;
	answers: Record<string, string>;
	missingSlotsRemaining: MissingSlot[];
	cancelled: boolean;
};

async function runInterview(
	ctx: ExtensionContext,
	mode: InterviewMode,
	originalIntent: string,
	maxRounds: number,
	initialAnswers: Record<string, string> = {},
	onAnswered?: (slot: MissingSlot, value: string, round: number) => void,
): Promise<InterviewResult> {
	const capabilities = {
		hasUI: ctx.hasUI,
		mode: ctx.hasUI ? ("interactive" as const) : ("nonInteractive" as const),
		cwd: ctx.cwd,
		model: ctx.model
			? { provider: ctx.model.provider, id: ctx.model.id, name: (ctx.model as unknown as Record<string, unknown>).name as string | undefined }
			: undefined,
	};
	const answers: Record<string, string> = { ...initialAnswers };
	const workspaceContext = buildWorkspaceContext(ctx.cwd);

	// Non-UI mode: probe only once (best-effort).
	if (!ctx.hasUI) {
		const probe = await runProbe(ctx, mode, originalIntent, answers, workspaceContext, capabilities);
		return {
			refinedIntent: probe.refinedIntent,
			completionScore: probe.completionScore,
			answers,
			missingSlotsRemaining: probe.missingSlots,
			cancelled: false,
		};
	}

	let finalProbe: ProbeOutput | undefined;
	for (let i = 1; i <= maxRounds; i++) {
		ctx.ui.setWorkingMessage?.(
			mode === "grill"
				? textByLanguage(originalIntent, `Grilling：正在生成第 ${i} 个追问...`, `Grilling: analyzing follow-up (${i})...`)
				: textByLanguage(originalIntent, `Interview：正在生成第 ${i} 个澄清问题...`, `Interview: analyzing follow-up (${i})...`),
		);
		let probe: ProbeOutput;
		try {
			probe = await runProbe(ctx, mode, originalIntent, answers, workspaceContext, capabilities);
		} finally {
			ctx.ui.setWorkingMessage?.();
		}
		finalProbe = probe;

		const slot = probe.missingSlots.find((candidate) => answers[candidate.key] === undefined);
		if (!slot || probe.completionScore >= 0.8) break;

		ctx.ui.setWorkingMessage?.(`${mode === "grill" ? "Grill" : "Interview"}: asking follow-up (${i})...`);
		const value = await askSlotWithUI(ctx, mode, i, slot);
		ctx.ui.setWorkingMessage?.();

		if (!value) {
			return {
				refinedIntent: finalProbe.refinedIntent,
				completionScore: finalProbe.completionScore,
				answers,
				missingSlotsRemaining: finalProbe.missingSlots,
				cancelled: true,
			};
		}
		answers[slot.key] = value;
		onAnswered?.(slot, value, i);
	}

	// If we broke early or still missing, run one last probe for best refinedIntent.
	if (!finalProbe) ctx.ui.setWorkingMessage?.(mode === "grill" ? textByLanguage(originalIntent, "Grilling：正在整理 summary...", "Grilling: finalizing summary...") : textByLanguage(originalIntent, "Interview：正在整理澄清结果...", "Interview: finalizing refined intent..."));
	let ensureProbe: ProbeOutput;
	try {
		ensureProbe = finalProbe ?? (await runProbe(ctx, mode, originalIntent, answers, workspaceContext, capabilities));
	} finally {
		if (!finalProbe) ctx.ui.setWorkingMessage?.();
	}
	const missingSlotsRemaining = ensureProbe.missingSlots.filter((s) => answers[s.key] === undefined);

	return {
		refinedIntent: ensureProbe.refinedIntent,
		completionScore: ensureProbe.completionScore,
		answers,
		missingSlotsRemaining,
		cancelled: false,
	};
}

function buildInjectionText(input: {
	mode?: InterviewMode;
	originalIntent: string;
	refinedIntent: string;
	completionScore: number;
	answers: Record<string, string>;
	missingSlotsRemaining: MissingSlot[];
}): string {
	const answeredKeys = Object.keys(input.answers);
	const remainingKeys = input.missingSlotsRemaining.map((s) => s.key);

	const answersLines =
		answeredKeys.length > 0
			? answeredKeys.map((k) => `- ${k}: ${input.answers[k]}`).join("\n")
			: "(none)";
	const remainingLines =
		remainingKeys.length > 0
			? input.missingSlotsRemaining
					.map((slot) => `- ${slot.key}: ${slot.question}${slot.recommendedAnswer ? `\n  Recommended: ${slot.recommendedAnswer}` : ""}`)
					.join("\n")
			: "(none)";
	const isGrill = input.mode === "grill";

	return [
		isGrill ? "[Grill Summary]" : "[Interview Refined Intent]",
		`completionScore: ${input.completionScore.toFixed(2)}`,
		"",
		"[Original request]",
		input.originalIntent,
		"",
		isGrill ? "[Recommended plan after grilling]" : "[Refined intent]",
		input.refinedIntent,
		"",
		"[Answered]",
		answersLines,
		"",
		"[Still TBD]",
		remainingLines,
		"",
		isGrill
			? "Use the Grill Summary above as the decision log and risk checklist for planning, /grub initialization, /loop follow-up checks, or execution."
			: "Use the refinedIntent above as the single source of truth for planning and execution.",
	].join("\n");
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
		description: "Clarify an ambiguous request and inject a refined intent.",
		handler: async (args: string, ctx: ExtensionCommandContext) => runInterviewCommand(api, args, ctx, "clarify"),
	} satisfies Omit<RegisteredCommand, "name">);

	api.registerCommand("grill-me", {
		description: "Stress-test a plan or unclear request with one-question-at-a-time follow-ups and recommended answers.",
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
