/**
 * [WHO]: Provides interview probe heuristics, workspace context, runProbe(), runInterview(), buildInjectionText()
 * [FROM]: Depends on node:fs/path and core/extensions-host/types.ts for runtime context and UI prompts
 * [TO]: Consumed by extensions/builtin/interview/index.ts for /interview, /grill-me, and interview tool execution
 * [HERE]: extensions/builtin/interview/interview-runtime.ts - model probing and clarification flow boundary
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionContext } from "../../../core/extensions-host/types.js";

export type InterviewMode = "clarify" | "grill";

export type MissingSlot = {
	key: string;
	question: string;
	recommendedAnswer?: string;
	options?: string[];
	allowCustom?: boolean;
};

export type ProbeOutput = {
	completionScore: number;
	refinedIntent: string;
	missingSlots: MissingSlot[];
};

type ProbeCapabilities = {
	hasUI: boolean;
	mode: "interactive" | "nonInteractive";
	cwd?: string;
	model?: { provider?: string; id?: string; name?: string };
};

export type InterviewResult = {
	refinedIntent: string;
	completionScore: number;
	answers: Record<string, string>;
	missingSlotsRemaining: MissingSlot[];
	cancelled: boolean;
};

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

export function isLoopManagedPrompt(prompt: string): boolean {
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

export function hasAmbiguitySignal(prompt: string): boolean {
	const p = prompt.trim();
	if (!p) return false;
	return /(ambiguous|unclear|not sure|unsure|vague|help me think|flesh out|requirements?|clarify|I don't know|我说不清|说不清楚|不确定|没想清楚|需求不清|需求不明确|帮我想|完善需求|梳理需求|澄清|先问我|问我几个问题)/i.test(p);
}

function hasDesignDecisionSignal(prompt: string): boolean {
	const p = prompt.trim();
	if (!p) return false;
	return /(architecture|architectural|design|proposal|plan|trade[- ]?off|migration|integration|workflow|roadmap|方案|架构|设计|规划|计划|取舍|权衡|集成|流程|重构|迁移|路线)/i.test(p);
}

export function detectPromptLanguage(prompt: string): "zh" | "en" {
	return /[\u3400-\u9fff]/.test(prompt) ? "zh" : "en";
}

function languageInstructionForPrompt(prompt: string): string {
	return detectPromptLanguage(prompt) === "zh"
		? "Chinese (中文). Match the user's Chinese phrasing for follow-up questions, options, summaries, and recommended answers."
		: "English. Use natural English for follow-up questions, options, summaries, and recommended answers.";
}

export function textByLanguage(prompt: string, zh: string, en: string): string {
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

export function buildWorkspaceContext(cwd: string | undefined): string {
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

export function isTaskLikePrompt(prompt: string): boolean {
	const p = prompt.trim();
	if (!p) return false;

	const taskVerbPattern =
		/(do|write|implement|develop|design|create|build|make|generate|setup|deploy|construct|fix|optimize|refactor|improve|enhance|output|deliver|plan|specify|explain)/i;
	const outputPattern =
		/(website|portfolio|page|frontend|backend|UI|interface|code|program|script|document|README|PRD|test|unit test|API|database|SQL|feature|requirement|solution|plan|system|platform|app|module|service|component)/i;
	const reviewPattern = /(review|check|analyze|debug|diagnose|investigate)/i;
	const reviewTargetPattern = /(code|error|bug|exception|log|trace|stack|SQL)/i;
	const requestSignalPattern = /(help me|please|can you|could you|I need|I want|would you)/i;

	const hasTaskVerb = taskVerbPattern.test(p);
	const hasOutput = outputPattern.test(p);
	const looksLikeRequest = requestSignalPattern.test(p) || hasOutput;
	if ((hasTaskVerb && looksLikeRequest) || (hasOutput && hasTaskVerb)) return true;
	if (reviewPattern.test(p) && reviewTargetPattern.test(p)) return true;

	return false;
}

function isNonTaskPrompt(prompt: string): boolean {
	const p = prompt.trim();
	if (!p) return false;

	const greetingPattern = /^(hello|hi|hey|good morning|good afternoon|good evening)\b/i;
	const chitchatPattern = /(chat|casual talk|small talk|bored|just chatting|let's talk)/i;
	const memoryPattern = /(do you remember me|remember me|you remember|do you know me|forgot me|who are you)/i;
	const vagueAgreementPattern = /(whatever|anything is fine|up to you|you decide|doesn't matter)/i;

	if (greetingPattern.test(p)) return !isTaskLikePrompt(p);
	if (chitchatPattern.test(p)) return !isTaskLikePrompt(p);
	if (memoryPattern.test(p)) return !isTaskLikePrompt(p);
	if (vagueAgreementPattern.test(p) && !isTaskLikePrompt(p)) return true;
	if (p.length < 20 && !isTaskLikePrompt(p)) return true;

	return false;
}

function isDetailedPrompt(prompt: string): boolean {
	const p = prompt.trim();

	if (hasExplicitGrillIntent(p) || hasAmbiguitySignal(p) || hasDesignDecisionSignal(p)) {
		return false;
	}

	if (p.length > 150) return true;

	const technicalTerms = /(react|vue|angular|node|typescript|javascript|python|rust|go|java|docker|kubernetes|api|rest|graphql|sql|mongodb|redis|aws|gcp|azure|linux|macos|windows)/i;
	if (technicalTerms.test(p)) return true;

	const codeReferences = /(\.\w+|\/\w+|\\w+|\.\w{1,4}\b|`[^`]+`)/;
	if (codeReferences.test(p)) return true;

	const debugPattern = /(review|check|analyze|debug|diagnose|investigate)/i;
	const debugTargetPattern = /(code|error|bug|exception|log|issue|script|program|function|method)/i;
	if (debugPattern.test(p) && debugTargetPattern.test(p)) return true;

	return false;
}

export function getSuggestedInterviewMode(prompt: string): InterviewMode | undefined {
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

function buildProbeContext(input: {
	originalIntent: string;
	answers: Record<string, string>;
	workspaceContext: string;
	capabilities: ProbeCapabilities;
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

export async function runProbe(
	ctx: ExtensionContext,
	mode: InterviewMode,
	originalIntent: string,
	answers: Record<string, string>,
	workspaceContext: string,
	capabilities: ProbeCapabilities,
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

export async function runInterview(
	ctx: ExtensionContext,
	mode: InterviewMode,
	originalIntent: string,
	maxRounds: number,
	initialAnswers: Record<string, string> = {},
	onAnswered?: (slot: MissingSlot, value: string, round: number) => void,
): Promise<InterviewResult> {
	const capabilities: ProbeCapabilities = {
		hasUI: ctx.hasUI,
		mode: ctx.hasUI ? "interactive" : "nonInteractive",
		cwd: ctx.cwd,
		model: ctx.model
			? { provider: ctx.model.provider, id: ctx.model.id, name: (ctx.model as unknown as Record<string, unknown>).name as string | undefined }
			: undefined,
	};
	const answers: Record<string, string> = { ...initialAnswers };
	const workspaceContext = buildWorkspaceContext(ctx.cwd);

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

	if (!finalProbe) {
		ctx.ui.setWorkingMessage?.(
			mode === "grill"
				? textByLanguage(originalIntent, "Grilling：正在整理 summary...", "Grilling: finalizing summary...")
				: textByLanguage(originalIntent, "Interview：正在整理澄清结果...", "Interview: finalizing refined intent..."),
		);
	}
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

export function buildInjectionText(input: {
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
