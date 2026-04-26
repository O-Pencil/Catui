/**
 * [WHO]: GrubController - drives autonomous iterative tasks with durable state and completion validation
 * [FROM]: Depends on node:crypto, node:path, ./grub-types, ./grub-persistence, ./grub-feature-list
 * [TO]: Consumed by extension entry point (./index.ts)
 * [HERE]: extensions/defaults/grub/grub-controller.ts - state machine for /grub iterations with cross-session persistence and feature-list-gated completion
 */

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { allPassing, firstPending, readFeatureList } from "./grub-feature-list.js";
import { languageName, grubText, type GrubLocale } from "./grub-i18n.js";
import { persistState, stateFilePathFor } from "./grub-persistence.js";
import type {
	GrubControllerState,
	GrubDecision,
	GrubTaskSnapshot,
	GrubTaskState,
} from "./grub-types.js";

const DEFAULT_MAX_ITERATIONS = 25;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

export interface GrubStartOptions {
	maxIterations?: number;
	maxConsecutiveFailures?: number;
	locale?: GrubLocale;
}

export class GrubController {
	private activeTask?: GrubTaskState;
	private lastTerminalTask?: GrubTaskSnapshot;

	getState(): GrubControllerState {
		return {
			active: this.activeTask ? { ...this.activeTask } : undefined,
			lastTerminal: this.lastTerminalTask ? { ...this.lastTerminalTask } : undefined,
		};
	}

	hasActiveTask(): boolean {
		return this.activeTask !== undefined;
	}

	getActiveTask(): GrubTaskState | undefined {
		return this.activeTask;
	}

	start(goal: string, cwd: string, options: GrubStartOptions = {}): GrubTaskState {
		const trimmedGoal = goal.trim();
		if (!trimmedGoal) {
			throw new Error("Grub goal cannot be empty.");
		}
		if (this.activeTask) {
			throw new Error(`Grub ${this.activeTask.id} is already running. Stop it before starting a new one.`);
		}

		const now = Date.now();
		const id = this.generateTaskId();
		const harnessDirectory = join(cwd, ".grub", id);
		const task: GrubTaskState = {
			id,
			goal: trimmedGoal,
			locale: options.locale ?? "en",
			status: "running",
			phase: "initializer",
			startedAt: now,
			updatedAt: now,
			currentIteration: 1,
			awaitingTurn: false,
			consecutiveFailures: 0,
			maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
			maxConsecutiveFailures: options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
			harnessDirectory,
			featureChecklistPath: join(harnessDirectory, "feature-checklist.md"),
			featureListPath: join(harnessDirectory, "feature-list.json"),
			stateFilePath: stateFilePathFor(harnessDirectory),
			progressLogPath: join(harnessDirectory, "progress-log.md"),
			initScriptPath: join(harnessDirectory, "init.sh"),
		};

		this.activeTask = task;
		this.safePersist(task);
		return task;
	}

	/**
	 * Adopt a previously persisted task, e.g. after process restart. Does not
	 * auto-dispatch the next iteration; the caller decides whether to continue.
	 */
	adoptResumedTask(task: GrubTaskState): GrubTaskState {
		if (this.activeTask && this.activeTask.id !== task.id) {
			throw new Error(`Cannot adopt task ${task.id}; ${this.activeTask.id} is already active.`);
		}
		const resumed: GrubTaskState = { ...task, locale: task.locale ?? "en", awaitingTurn: false, updatedAt: Date.now() };
		this.activeTask = resumed;
		this.safePersist(resumed);
		return resumed;
	}

	stop(reason: string, status: GrubTaskSnapshot["status"] = "stopped"): GrubTaskSnapshot | undefined {
		if (!this.activeTask) {
			return this.lastTerminalTask;
		}

		const task = this.activeTask;
		const finalTask: GrubTaskState = { ...task, status, updatedAt: Date.now(), awaitingTurn: false };
		this.safePersist(finalTask);

		const snapshot: GrubTaskSnapshot = {
			id: finalTask.id,
			goal: finalTask.goal,
			locale: finalTask.locale,
			status,
			phase: finalTask.phase,
			startedAt: finalTask.startedAt,
			updatedAt: finalTask.updatedAt,
			completedIterations: Math.max(0, finalTask.currentIteration - (task.awaitingTurn ? 1 : 0)),
			consecutiveFailures: finalTask.consecutiveFailures,
			harnessDirectory: finalTask.harnessDirectory,
			featureChecklistPath: finalTask.featureChecklistPath,
			featureListPath: finalTask.featureListPath,
			stateFilePath: finalTask.stateFilePath,
			progressLogPath: finalTask.progressLogPath,
			initScriptPath: finalTask.initScriptPath,
			lastDecision: finalTask.lastDecision,
			lastError: reason || finalTask.lastError,
		};

		this.activeTask = undefined;
		this.lastTerminalTask = snapshot;
		return snapshot;
	}

	isGrubPrompt(prompt: string): boolean {
		return this.activeTask !== undefined && prompt.startsWith(this.getPromptPrefix(this.activeTask.id));
	}

	buildPrompt(): string {
		if (!this.activeTask) {
			throw new Error("No active grub task.");
		}

		const task = this.activeTask;
		const text = grubText(task.locale);
		const sections = [
			`${this.getPromptPrefix(task.id)}${task.currentIteration}]`,
			"",
			task.locale === "zh" ? "自主 Grub 目标：" : "Autonomous grub goal:",
			task.goal,
			"",
			task.locale === "zh"
				? "你正在一个受控的 grub harness 中工作。请围绕同一个目标持续推进具体进展。"
				: "You are inside a managed grub harness. Keep making concrete progress on the same goal.",
			task.locale === "zh"
				? "按需使用工具、编辑文件、运行检查并验证结果。所有面向用户的总结、进度和说明都必须使用中文。"
				: "Use tools, edit files, run checks, and verify results as needed.",
			`User language: ${languageName(task.locale)}.`,
			"",
			task.locale === "zh" ? "Harness 文件（每轮都必须保持最新）：" : "Harness files (must stay up to date every iteration):",
			`- ${text.featureList}: ${task.featureListPath}`,
			`- ${text.progressLog}: ${task.progressLogPath}`,
			`- ${text.initScript}: ${task.initScriptPath}`,
		];

		if (task.phase === "initializer") {
			sections.push(
				"",
				task.locale === "zh" ? "初始化阶段要求：" : "Initializer phase requirements:",
				task.locale === "zh"
					? "1. 将 feature-list.json 的占位内容替换为 15-40 个具体、可测试的切片。每项必须保持 {id, category, description, steps[], passes:false}。"
					: "1. Replace the placeholder feature-list.json with 15-40 concrete, testable slices. Every entry MUST keep the schema {id, category, description, steps[], passes:false}.",
				task.locale === "zh"
					? "2. 确保 init.sh 包含可靠的启动检查，并设置为可执行。"
					: "2. Ensure init.sh contains reliable startup checks and make it executable.",
				task.locale === "zh"
					? "3. 在 progress-log.md 中追加清晰的初始化总结。"
					: "3. Append a clear initialization summary in progress-log.md.",
				task.locale === "zh"
					? "4. 先建立强 harness，不要开始大范围实现。"
					: "4. Do not attempt broad implementation yet; prepare a strong harness first.",
				task.locale === "zh"
					? "5. 除非目标已经完成或阻塞，否则本轮以 loop-state status=continue 结束。"
					: "5. End this turn with loop-state status=continue unless the goal is already complete/blocked.",
			);
		} else {
			sections.push(
				"",
				task.locale === "zh" ? "执行阶段要求：" : "Execution phase requirements:",
				task.locale === "zh"
					? "1. 先运行 init.sh，再读取 feature-list.json 和 progress-log.md。"
					: "1. Start by running the init script, then read feature-list.json and progress-log.md.",
				task.locale === "zh"
					? "2. 只选择一个 passes:false 的 feature，并端到端完成它。"
					: "2. Pick exactly one feature with passes:false and execute it end-to-end.",
				task.locale === "zh"
					? "3. 运行相关验证（测试、烟测或运行时检查）。"
					: "3. Run relevant verification (tests, smoke checks, or runtime checks).",
				task.locale === "zh"
					? "4. 只能修改该 feature 的 passes/evidence 字段；其他字段不可变。"
					: "4. Flip ONLY the passes/evidence fields for that feature; other fields are immutable.",
				task.locale === "zh"
					? "5. 本轮结束前追加进度日志并 git commit。"
					: "5. Append progress log and git-commit before finishing the turn.",
				task.locale === "zh"
					? "6. 每轮都保持增量、安全、可回退。"
					: "6. Keep each iteration incremental and production-safe.",
			);
		}

		if (task.lastDecision?.summary) {
			sections.push("", task.locale === "zh" ? "上次总结：" : "Previous summary:", task.lastDecision.summary);
		}

		if (task.lastDecision?.nextStep) {
			sections.push("", task.locale === "zh" ? "上次计划的下一步：" : "Previous planned next step:", task.lastDecision.nextStep);
		}

		if (task.lastError) {
			sections.push("", task.locale === "zh" ? "恢复提示：" : "Recovery note:", task.lastError);
		}

		sections.push(
			"",
			task.locale === "zh"
				? "不要因为一次查询结束就停止。只有 feature-list.json 中每个 feature 都 passes:true 时，才可以决定 `complete`。"
				: "Do not stop just because one query finished. Only decide `complete` when every feature in feature-list.json has passes:true.",
			task.locale === "zh"
				? "如果还需要下一轮自主推进，请以有效的 <loop-state> 块结束，让系统自动继续。"
				: "If you need another autonomous pass, end with a valid <loop-state> block so the system can continue automatically.",
		);

		return sections.join("\n");
	}

	markDispatched(): GrubTaskState {
		if (!this.activeTask) {
			throw new Error("No active grub task.");
		}
		this.activeTask.awaitingTurn = true;
		this.activeTask.updatedAt = Date.now();
		this.safePersist(this.activeTask);
		return this.activeTask;
	}

	/**
	 * Validate a completion decision against the feature-list. If the decision
	 * says `complete` but the persisted feature-list still has pending entries,
	 * the decision is downgraded to `continue` with a synthetic nextStep.
	 * Returns the (possibly rewritten) decision.
	 */
	validateCompletion(decision: GrubDecision): { decision: GrubDecision; downgraded: boolean; reason?: string } {
		if (decision.status !== "complete" || !this.activeTask) {
			return { decision, downgraded: false };
		}
		const list = readFeatureList(this.activeTask.featureListPath);
		if (!list) {
			const rewritten: GrubDecision = {
				status: "continue",
				summary: decision.summary,
				nextStep:
					this.activeTask.locale === "zh"
						? "feature-list.json 缺失或无效；初始化阶段必须先生成它，不能直接声明完成。"
						: "feature-list.json is missing or invalid; the initializer must produce it before claiming complete.",
			};
			return {
				decision: rewritten,
				downgraded: true,
				reason: this.activeTask.locale === "zh" ? "feature-list.json 缺失或无效" : "feature-list.json missing or invalid",
			};
		}
		if (allPassing(list)) {
			return { decision, downgraded: false };
		}
		const pending = firstPending(list);
		const rewritten: GrubDecision = {
			status: "continue",
			summary: decision.summary,
			nextStep: pending
				? this.activeTask.locale === "zh"
					? `完成待处理 feature：${pending.id}（${pending.description}）`
					: `Complete pending feature: ${pending.id} (${pending.description})`
				: this.activeTask.locale === "zh"
					? "先完成剩余待处理 feature，再声明完成。"
					: "Complete the remaining pending features before declaring done.",
		};
		return {
			decision: rewritten,
			downgraded: true,
			reason:
				this.activeTask.locale === "zh"
					? `feature-list 仍有 ${list.features.length - list.features.filter((f) => f.passes).length} 个待处理条目`
					: `feature-list still has ${list.features.length - list.features.filter((f) => f.passes).length} pending entries`,
		};
	}

	finishTurn(decision: GrubDecision): { action: "continue" | "stop"; task?: GrubTaskState; snapshot?: GrubTaskSnapshot } {
		if (!this.activeTask) {
			return { action: "stop", snapshot: this.lastTerminalTask };
		}

		const task = this.activeTask;
		task.awaitingTurn = false;
		task.consecutiveFailures = 0;
		task.lastError = undefined;
		task.lastDecision = decision;
		task.updatedAt = Date.now();
		if (task.phase === "initializer") {
			task.phase = "execution";
		}

		if (decision.status === "complete") {
			return {
				action: "stop",
				snapshot: this.stop(task.locale === "zh" ? "Grub 目标已完成。" : "Grub goal completed.", "complete"),
			};
		}
		if (decision.status === "blocked") {
			return {
				action: "stop",
				snapshot: this.stop(task.locale === "zh" ? "Grub 报告任务被阻塞。" : "Grub reported it is blocked.", "blocked"),
			};
		}

		if (task.currentIteration >= task.maxIterations) {
			return {
				action: "stop",
				snapshot: this.stop(
					task.locale === "zh"
						? `Grub 达到轮次上限（${task.maxIterations}）。`
						: `Grub hit the iteration limit (${task.maxIterations}).`,
					"failed",
				),
			};
		}

		task.currentIteration += 1;
		this.safePersist(task);
		return { action: "continue", task: { ...task } };
	}

	recordFailure(message: string): { action: "continue" | "stop"; task?: GrubTaskState; snapshot?: GrubTaskSnapshot } {
		if (!this.activeTask) {
			return { action: "stop", snapshot: this.lastTerminalTask };
		}

		const task = this.activeTask;
		task.awaitingTurn = false;
		task.consecutiveFailures += 1;
		task.lastError = message;
		task.updatedAt = Date.now();

		if (task.consecutiveFailures >= task.maxConsecutiveFailures) {
			return {
				action: "stop",
				snapshot: this.stop(
					task.locale === "zh"
						? `Grub 连续失败 ${task.consecutiveFailures} 次后停止。最近错误：${message}`
						: `Grub stopped after ${task.consecutiveFailures} consecutive failures. Last error: ${message}`,
					"failed",
				),
			};
		}

		if (task.currentIteration >= task.maxIterations) {
			return {
				action: "stop",
				snapshot: this.stop(
					task.locale === "zh"
						? `Grub 达到轮次上限（${task.maxIterations}）。`
						: `Grub hit the iteration limit (${task.maxIterations}).`,
					"failed",
				),
			};
		}

		task.currentIteration += 1;
		this.safePersist(task);
		return { action: "continue", task: { ...task } };
	}

	private getPromptPrefix(taskId: string): string {
		return `[GRUB:${taskId}:`;
	}

	private generateTaskId(): string {
		return randomBytes(4).toString("hex").slice(0, 8);
	}

	private safePersist(task: GrubTaskState): void {
		try {
			persistState(task);
		} catch (error) {
			// Persistence is best-effort; failure must not break the state machine.
			const message = error instanceof Error ? error.message : String(error);
			// Surface to console so operators can see disk issues.
			console.error(`[Grub] Failed to persist task ${task.id} state: ${message}`);
		}
	}
}
