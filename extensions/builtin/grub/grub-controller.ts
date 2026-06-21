/**
 * [WHO]: GrubController - drives autonomous iterative tasks with durable state and completion validation
 * [FROM]: Depends on node:crypto, node:path, ./grub-types, ./grub-persistence, ./grub-feature-list, ./grub-prompts
 * [TO]: Consumed by extension entry point (./index.ts)
 * [HERE]: extensions/builtin/grub/grub-controller.ts - state machine for /grub iterations with cross-session persistence and feature-list-gated completion
 */

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { allPassing, firstPending, readFeatureList, readFeatureListResult, sanitizeInitializerFeatureList, validateFeatureListDiff, writeFeatureList } from "./grub-feature-list.js";
import { type GrubLocale } from "./grub-i18n.js";
import { persistState, stateFilePathFor } from "./grub-persistence.js";
import { buildGrubTaskPrompt, getPromptPrefix } from "./grub-prompts.js";
import type {
	FeatureList,
	GrubControllerState,
	GrubDecision,
	GrubTaskSnapshot,
	GrubTaskState,
} from "./grub-types.js";

const DEFAULT_MAX_ITERATIONS = 25;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
// The initializer often needs a couple of tries to produce a structurally
// complete feature list. Give it a more forgiving budget than execution so a
// few setup hiccups don't burn the whole task before any real work begins.
const DEFAULT_MAX_INITIALIZER_FAILURES = 5;
const BLOCKED_THRESHOLD = 3;
const INITIALIZER_MIN_FEATURES = 15;
const INITIALIZER_MAX_FEATURES = 40;

export interface GrubStartOptions {
	maxIterations?: number;
	maxConsecutiveFailures?: number;
	maxInitializerFailures?: number;
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
		return this.activeTask ? { ...this.activeTask } : undefined;
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
			consecutiveBlockedAttempts: 0,
			maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
			maxConsecutiveFailures: options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
			maxInitializerFailures: options.maxInitializerFailures ?? DEFAULT_MAX_INITIALIZER_FAILURES,
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
		const resumed: GrubTaskState = { ...task, locale: task.locale ?? "en", consecutiveBlockedAttempts: task.consecutiveBlockedAttempts ?? 0, awaitingTurn: false, updatedAt: Date.now() };
		this.activeTask = resumed;
		this.safePersist(resumed);
		return resumed;
	}

	stop(reason: string, status: GrubTaskSnapshot["status"] = "stopped"): GrubTaskSnapshot | undefined {
		if (!this.activeTask) {
			return this.lastTerminalTask;
		}

		const task = this.activeTask;
		const wasAwaiting = task.awaitingTurn;
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
			completedIterations: Math.max(0, finalTask.currentIteration - (wasAwaiting ? 1 : 0)),
			consecutiveFailures: finalTask.consecutiveFailures,
			consecutiveBlockedAttempts: finalTask.consecutiveBlockedAttempts,
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
		return this.activeTask !== undefined && prompt.startsWith(getPromptPrefix(this.activeTask.id));
	}

	buildPrompt(): string {
		if (!this.activeTask) {
			throw new Error("No active grub task.");
		}
		return buildGrubTaskPrompt(this.activeTask);
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
	 * Enforce the feature-list contract at the state-machine boundary. The
	 * initializer may replace the placeholder with the first complete list; after
	 * that, every turn may only change passes/evidence fields.
	 */
	validateFeatureListAfterTurn(): { ok: true } | { ok: false; message: string } {
		if (!this.activeTask) {
			return { ok: true };
		}

		const task = this.activeTask;
		const readResult = readFeatureListResult(task.featureListPath);
		if (!readResult.ok) {
			return {
				ok: false,
				message:
					task.locale === "zh"
						? `任务清单缺失或格式不正确，需要先修好清单再继续：${readResult.error}`
						: `The task checklist is missing or malformed and must be fixed before continuing: ${readResult.error}`,
			};
		}
		const list = readResult.list;

		if (task.phase === "initializer") {
			// Only genuinely unfixable structural problems should fail the turn
			// and force a retry. Recoverable hygiene issues (wrong goal,
			// pre-marked passes, stray evidence) are auto-corrected below so a
			// first-time mistake never strands the task in the initializer phase.
			const structuralError = this.validateInitializerStructure(list);
			if (structuralError) {
				return { ok: false, message: structuralError };
			}
			const { list: sanitized, fixes } = sanitizeInitializerFeatureList(list, task.goal);
			if (fixes.length > 0) {
				try {
					writeFeatureList(task.featureListPath, sanitized);
				} catch {
					// Write failed — use the on-disk list as baseline to avoid
					// divergence between memory and disk that would cause every
					// subsequent validateFeatureListDiff to reject the turn.
					const onDisk = readFeatureList(task.featureListPath);
					task.featureListBaseline = this.cloneFeatureList(onDisk ?? list);
					this.safePersist(task);
					return { ok: true };
				}
			}
			task.featureListBaseline = this.cloneFeatureList(sanitized);
			this.safePersist(task);
			return { ok: true };
		}

		if (!task.featureListBaseline) {
			task.featureListBaseline = this.cloneFeatureList(list);
			this.safePersist(task);
			return { ok: true };
		}

		try {
			validateFeatureListDiff(task.featureListBaseline, list);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				ok: false,
				message:
					task.locale === "zh"
						? `任务清单被改动得不安全：${message}`
						: `The task checklist changed in an unsafe way: ${message}`,
			};
		}

		task.featureListBaseline = this.cloneFeatureList(list);
		this.safePersist(task);
		return { ok: true };
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
						? "任务清单缺失或无效；必须先生成清单，不能直接结束。"
						: "The task checklist is missing or invalid; it must be created before the task can finish.",
			};
			return {
				decision: rewritten,
				downgraded: true,
				reason: this.activeTask.locale === "zh" ? "任务清单缺失或无效" : "the task checklist is missing or invalid",
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
						? `清单里还有 ${list.features.length - list.features.filter((f) => f.passes).length} 项未完成`
						: `the checklist still has ${list.features.length - list.features.filter((f) => f.passes).length} unfinished items`,
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

		if (decision.status === "complete") {
			return {
				action: "stop",
				snapshot: this.stop(task.locale === "zh" ? "Grub 目标已完成。" : "Grub goal completed.", "complete"),
			};
		}
		if (decision.status === "blocked") {
			task.consecutiveBlockedAttempts += 1;
			if (task.consecutiveBlockedAttempts < BLOCKED_THRESHOLD) {
				// Not enough consecutive blocked turns yet — force continue
				decision = {
					status: "continue",
					summary: decision.summary,
					nextStep: task.locale === "zh"
						? `阻塞报告被拒绝（第 ${task.consecutiveBlockedAttempts}/${BLOCKED_THRESHOLD} 次）。同一个阻塞条件需要连续出现 ${BLOCKED_THRESHOLD} 次才能标记 blocked。请换一种方式尝试推进。`
						: `Blocked report rejected (${task.consecutiveBlockedAttempts}/${BLOCKED_THRESHOLD}). The same blocker must repeat for ${BLOCKED_THRESHOLD} consecutive turns before you may report blocked. Try a different approach.`,
				};
				task.lastDecision = decision;
			} else {
				return {
					action: "stop",
					snapshot: this.stop(task.locale === "zh" ? "Grub 报告任务被阻塞。" : "Grub reported it is blocked.", "blocked"),
				};
			}
		} else {
			// Successful turn — reset blocked counter
			task.consecutiveBlockedAttempts = 0;
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

		if (task.phase === "initializer") {
			task.phase = "execution";
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

		// The initializer gets a more forgiving budget: setting up a valid
		// harness is a distinct, retry-friendly activity from execution work.
		const failureLimit =
			task.phase === "initializer"
				? task.maxInitializerFailures ?? DEFAULT_MAX_INITIALIZER_FAILURES
				: task.maxConsecutiveFailures;

		if (task.consecutiveFailures >= failureLimit) {
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

	private generateTaskId(): string {
		return randomBytes(4).toString("hex").slice(0, 8);
	}

	private validateInitializerStructure(list: FeatureList): string | undefined {
		const task = this.activeTask;
		const locale = task?.locale ?? "en";
		const graduationHint =
			locale === "zh"
				? "（产出一份干净的清单后，系统会自动从初始化阶段进入执行阶段，届时才逐个标记 passes。）"
				: " (Once the list is structurally clean, the harness automatically moves from the initializer to the execution phase, where you mark passes one by one.)";
		if (list.features.length < INITIALIZER_MIN_FEATURES || list.features.length > INITIALIZER_MAX_FEATURES) {
			return locale === "zh"
				? `初始化阶段必须生成 ${INITIALIZER_MIN_FEATURES}-${INITIALIZER_MAX_FEATURES} 个 feature。${graduationHint}`
				: `Initializer must produce ${INITIALIZER_MIN_FEATURES}-${INITIALIZER_MAX_FEATURES} features.${graduationHint}`;
		}
		const seen = new Set<string>();
		for (const feature of list.features) {
			if (feature.id === "placeholder-expand-features") {
				return locale === "zh"
					? `初始化阶段必须替换 placeholder feature。${graduationHint}`
					: `Initializer must replace the placeholder feature.${graduationHint}`;
			}
			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature.id)) {
				return locale === "zh" ? `feature id 必须是 kebab-case：${feature.id}` : `feature id must be kebab-case: ${feature.id}`;
			}
			if (seen.has(feature.id)) {
				return locale === "zh" ? `feature id 重复：${feature.id}` : `duplicate feature id: ${feature.id}`;
			}
			seen.add(feature.id);
		}
		return undefined;
	}

	private cloneFeatureList(list: FeatureList): FeatureList {
		return {
			version: list.version,
			goal: list.goal,
			features: list.features.map((feature) => ({
				...feature,
				steps: [...feature.steps],
			})),
		};
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
