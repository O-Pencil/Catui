/**
 * [WHO]: Provides detectGrubLocale(), grubText(), type GrubLocale for localized /grub prompts and TUI messages
 * [FROM]: Depends on core/i18n locale type
 * [TO]: Consumed by grub-controller.ts, grub-parser.ts, index.ts for user-language-aware Grub UX
 * [HERE]: extensions/defaults/grub/grub-i18n.ts - small locale helper scoped to the Grub extension
 */

import type { Locale } from "../../../core/i18n/index.js";

export type GrubLocale = Locale;

export function detectGrubLocale(text: string, fallback: Locale = "en"): GrubLocale {
	if (hasCjk(text)) return "zh";
	return fallback;
}

export function languageName(locale: GrubLocale): string {
	return locale === "zh" ? "中文" : "English";
}

export function grubText(locale: GrubLocale): (typeof GRUB_TEXT)[GrubLocale] {
	return GRUB_TEXT[locale];
}

function hasCjk(text: string): boolean {
	return /[\u3400-\u9fff]/.test(text);
}

const GRUB_TEXT = {
	en: {
		prefix: "[Grub]",
		missingGoal: "Missing grub goal.",
		usage: [
			"[Grub] Usage:",
			"  /grub <goal> [--max-iter N] [--max-fail N]   Start an autonomous digging task",
			"  /grub status [--json]                        Show the active or last finished task",
			"  /grub resume                                 Resume an adopted task from disk",
			"  /grub stop                                   Stop the active task",
			"",
			"[Grub] Harness artifacts under .grub/<task-id>/:",
			"  feature-list.json   structured features (agent may only flip passes/evidence)",
			"  progress-log.md     append-only progress notes",
			"  init.sh             per-iteration get-bearings + smoke script",
			"  state.json          durable GrubController state (for cross-session resume)",
			"",
			"[Grub] The agent keeps iterating until it reports complete, reports blocked,",
			"or hits a safety limit (iterations / consecutive failures). Declaring complete",
			"is rejected unless every feature in feature-list.json has passes:true.",
		],
		activeTask: "Active task",
		lastTask: "Last task",
		status: "Status",
		phase: "Phase",
		goal: "Goal",
		started: "Started",
		updated: "Updated",
		currentIteration: "Current iteration",
		completedIterations: "Completed iterations",
		awaitingResult: "Awaiting result",
		yes: "yes",
		no: "no",
		consecutiveFailures: "Consecutive failures",
		maxIterations: "Max iterations",
		harnessDir: "Harness dir",
		featureList: "Feature list",
		progressLog: "Progress log",
		initScript: "Init script",
		stateFile: "State file",
		featuresPassing: (passing: number, total: number) => `Features: ${passing}/${total} passing`,
		lastSummary: "Last summary",
		lastNextStep: "Last next step",
		lastError: "Last error",
		noActive: "No grub task is active.",
		noStarted: "No grub task has been started in this session.",
		decision: "Decision",
		summary: "Summary",
		nextStep: "Next step",
		resumeSummary: (id: string, iteration: number, phase: string) =>
			`[Grub] Resumed task ${id} at iteration ${iteration} (${phase}).`,
		resumeHint: "Use /grub status to inspect, /grub resume to continue dispatch, or /grub stop to abandon.",
		startingIteration: (iteration: number, id: string) => `[Grub] Starting iteration ${iteration} for ${id}.`,
		startedTask: (id: string) => `[Grub] Started autonomous grub task ${id}.`,
		initPhase: "Init phase: expand feature-list.json / init.sh / progress-log.md before broad implementation.",
		safetyLimits: (maxIterations: number, maxFailures: number) =>
			`Safety limits: ${maxIterations} iterations, ${maxFailures} consecutive failures.`,
		resuming: (id: string) => `[Grub] Resuming dispatch for task ${id}.`,
		stopped: (id: string) => `[Grub] Stopped grub task ${id}.`,
		noActiveRunning: "No active grub task is running.",
		noPersisted: "No adopted or persisted grub task to resume.",
		failedResume: (id: string, message: string) => `[Grub] Failed to resume task ${id}: ${message}`,
		failedAdopt: (message: string) => `[Grub] Failed to adopt task: ${message}`,
		failedNoAssistant: "Grub run ended without an assistant message.",
		iterationFailedRetry: (iteration: number | undefined) => `[Grub] Iteration failed. Retrying iteration ${iteration}.`,
		invalidLoopState: "Assistant response did not include a valid <loop-state> block.",
		invalidLoopRetry: (iteration: number | undefined) =>
			`[Grub] Missing or invalid loop-state block. Retrying iteration ${iteration}.`,
		prematureComplete: (reason: string) => `[Grub] Rejected premature complete: ${reason}. Continuing.`,
		harnessCreated: "- Harness created by /grub.",
		structuredFeatureNote: "- Structured feature list lives in feature-list.json; only passes/evidence may change.",
		initScriptNote: "- init.sh performs get-bearings + smoke before every iteration.",
		iterationsHeading: "## Iterations",
		appendIterationNote: "- (append one short entry per iteration with verification evidence)",
		progressLogTitle: (id: string) => `# Progress Log (${id})`,
		initializationHeading: "## Initialization",
	},
	zh: {
		prefix: "[Grub]",
		missingGoal: "缺少 grub 目标。",
		usage: [
			"[Grub] 用法：",
			"  /grub <目标> [--max-iter N] [--max-fail N]   启动一个自主长任务",
			"  /grub status [--json]                        查看当前或最近结束的任务",
			"  /grub resume                                 继续磁盘中恢复的任务",
			"  /grub stop                                   停止当前任务",
			"",
			"[Grub] 任务产物位于 .grub/<task-id>/：",
			"  feature-list.json   结构化功能清单（agent 只能修改 passes/evidence）",
			"  progress-log.md     追加式进度记录",
			"  init.sh             每轮开始前的环境定位和烟测脚本",
			"  state.json          持久化控制器状态（用于跨会话恢复）",
			"",
			"[Grub] agent 会持续迭代，直到完成、阻塞、用户停止，或触发安全上限。",
			"只有 feature-list.json 中所有功能都 passes:true 时，才允许声明完成。",
		],
		activeTask: "当前任务",
		lastTask: "最近任务",
		status: "状态",
		phase: "阶段",
		goal: "目标",
		started: "开始时间",
		updated: "更新时间",
		currentIteration: "当前轮次",
		completedIterations: "已完成轮次",
		awaitingResult: "等待结果",
		yes: "是",
		no: "否",
		consecutiveFailures: "连续失败",
		maxIterations: "最大轮次",
		harnessDir: "Harness 目录",
		featureList: "功能清单",
		progressLog: "进度日志",
		initScript: "初始化脚本",
		stateFile: "状态文件",
		featuresPassing: (passing: number, total: number) => `功能进度：${passing}/${total} 已通过`,
		lastSummary: "上次总结",
		lastNextStep: "下一步",
		lastError: "最近错误",
		noActive: "当前没有 grub 任务。",
		noStarted: "本会话还没有启动 grub 任务。",
		decision: "决策",
		summary: "总结",
		nextStep: "下一步",
		resumeSummary: (id: string, iteration: number, phase: string) =>
			`[Grub] 已恢复任务 ${id}，当前第 ${iteration} 轮（${phase}）。`,
		resumeHint: "可用 /grub status 查看，/grub resume 继续派发，或 /grub stop 放弃。",
		startingIteration: (iteration: number, id: string) => `[Grub] 开始任务 ${id} 的第 ${iteration} 轮。`,
		startedTask: (id: string) => `[Grub] 已启动自主任务 ${id}。`,
		initPhase: "初始化阶段：先完善 feature-list.json / init.sh / progress-log.md，再开始大范围实现。",
		safetyLimits: (maxIterations: number, maxFailures: number) =>
			`安全上限：最多 ${maxIterations} 轮，连续失败 ${maxFailures} 次后停止。`,
		resuming: (id: string) => `[Grub] 继续派发任务 ${id}。`,
		stopped: (id: string) => `[Grub] 已停止任务 ${id}。`,
		noActiveRunning: "当前没有正在运行的 grub 任务。",
		noPersisted: "没有可恢复的 grub 任务。",
		failedResume: (id: string, message: string) => `[Grub] 恢复任务 ${id} 失败：${message}`,
		failedAdopt: (message: string) => `[Grub] 接管任务失败：${message}`,
		failedNoAssistant: "Grub 本轮结束时没有 assistant 消息。",
		iterationFailedRetry: (iteration: number | undefined) => `[Grub] 本轮失败，准备重试第 ${iteration} 轮。`,
		invalidLoopState: "Assistant 回复缺少有效的 <loop-state> 块。",
		invalidLoopRetry: (iteration: number | undefined) => `[Grub] 缺少或无效的 loop-state，准备重试第 ${iteration} 轮。`,
		prematureComplete: (reason: string) => `[Grub] 拒绝过早完成：${reason}。继续执行。`,
		harnessCreated: "- Harness 由 /grub 创建。",
		structuredFeatureNote: "- 结构化功能清单位于 feature-list.json；后续只能修改 passes/evidence。",
		initScriptNote: "- 每轮开始前由 init.sh 执行环境定位和烟测。",
		iterationsHeading: "## 迭代记录",
		appendIterationNote: "- （每轮追加一条简短记录，包含验证证据）",
		progressLogTitle: (id: string) => `# 进度日志（${id}）`,
		initializationHeading: "## 初始化",
	},
} as const;
