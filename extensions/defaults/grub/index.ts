/**
 * [WHO]: grubExtension default export - registers /grub command, dual-phase prompts, resume support, feature-list validation, and grub renderer
 * [FROM]: Depends on @pencil-agent/agent-core, @pencil-agent/tui, core/extensions/types, core/runtime/event-bus, ./grub-controller, ./grub-parser, ./grub-types, ./grub-feature-list, ./grub-persistence
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension
 * [HERE]: extensions/defaults/grub/index.ts - autonomous iterative task runner with Anthropic-style long-running harness (feature-list.json + durable state + phase-specialized prompts)
 */

import type { AgentMessage } from "@pencil-agent/agent-core";
import { Box, Container, Spacer, Text } from "@pencil-agent/tui";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "../../../core/extensions/types.js";
import { getLocale, type Locale } from "../../../core/i18n/index.js";
import type { EventBus } from "../../../core/runtime/event-bus.js";
import { GrubController } from "./grub-controller.js";
import {
	createInitialFeatureList,
	migrateChecklistToFeatureList,
	readFeatureList,
	writeFeatureList,
} from "./grub-feature-list.js";
import { detectGrubLocale, grubText, languageName, type GrubLocale } from "./grub-i18n.js";
import { buildGrubHelp, parseGrubCommand } from "./grub-parser.js";
import { discoverActiveTasks, pruneStale } from "./grub-persistence.js";
import type { GrubDecision, GrubTaskSnapshot, GrubTaskState } from "./grub-types.js";

const GRUB_CUSTOM_TYPE = "grub";
const LOOP_STATE_START = "<loop-state>";
const LOOP_STATE_END = "</loop-state>";
let currentGrubLocale: GrubLocale = "en";

function buildGrubInitializerPrompt(locale: GrubLocale): string {
	const languageLine =
		locale === "zh"
			? "All user-visible summaries, progress log entries, and explanations MUST be written in 中文."
			: "All user-visible summaries, progress log entries, and explanations MUST be written in English.";
	return `
You are the INITIALIZER for a long-running autonomous grub task.

Your only job this turn is to set up a complete, executable harness that
future coding agents can read from disk even with a fresh context window.
Do NOT start broad implementation yet.

Required outputs this turn:
1) feature-list.json
   - Replace the placeholder entry with 15-40 concrete, testable, end-to-end
     feature entries that together cover the goal.
   - Schema (strict): {
       "version": 1,
       "goal": "<unchanged user goal>",
       "features": [
         { "id": "kebab-slug", "category": "functional|verification|polish",
           "description": "observable behavior",
           "steps": ["actionable", "verification", "steps"],
           "passes": false }
       ]
     }
   - All features must start with passes:false. Never invent passing
     features. Keep ids stable and kebab-case.

2) init.sh
   - Starts with pwd, git log --oneline -n 20, progress-log tail, feature
     progress count.
   - Ends with a minimal project-specific smoke command so every future
     iteration can verify the project still boots before touching code.
   - Must be executable (chmod +x).

3) progress-log.md
   - Append an Initialization section summarizing intent and harness
     decisions.

Rules for later coding agents (document them in progress-log.md):
- Coding agents may ONLY flip "passes" and set "evidence" on features.
- Never remove tests. Treat existing tests as ground truth.
- Each iteration must commit with message "grub(<id>): <feature-id>".

End with exactly one XML block:
<loop-state>{"status":"continue","summary":"harness ready","nextStep":"begin execution phase"}</loop-state>
${languageLine}
`.trim();
}

function buildGrubCodingPrompt(locale: GrubLocale): string {
	const languageLine =
		locale === "zh"
			? "All user-visible summaries, progress log entries, and explanations MUST be written in 中文."
			: "All user-visible summaries, progress log entries, and explanations MUST be written in English.";
	return `
You are a CODING AGENT working inside a long-running grub harness.

Every turn you MUST:
1) Run .grub/<id>/init.sh and verify the project still boots. Fix any
   regression before starting new work.
2) Read feature-list.json. Pick EXACTLY one feature with passes:false.
3) Implement + verify that single feature end-to-end. Prefer real runtime
   or integration checks over unit-only evidence.
4) Flip ONLY the "passes" field to true for that feature and set "evidence"
   to a git sha or short proof. You MAY NOT add, remove, reorder, rename, or
   re-describe features. If the feature list needs new entries, stop and
   report status:"blocked" with a clear reason.
5) Append one dated line to progress-log.md describing what changed.
6) git add -A && git commit -m "grub(<id>): <feature-id>" when in a git
   worktree. If git commit fails, note it in the progress log and continue.
7) End with exactly one XML block:
   <loop-state>{"status":"continue|complete|blocked","summary":"...","nextStep":"..."}</loop-state>

You may only declare status:"complete" when every feature in
feature-list.json has passes:true. The harness will reject premature
completion and keep you iterating.

Do not remove or rewrite tests. Treat tests as ground truth.
Do not wrap the loop-state JSON in markdown fences.
${languageLine}
`.trim();
}

const controllersByBus = new WeakMap<EventBus, GrubController>();
const notifyByBus = new WeakMap<EventBus, (msg: string, type?: "info" | "warning" | "error") => void>();

function getController(bus: EventBus): GrubController {
	let controller = controllersByBus.get(bus);
	if (!controller) {
		controller = new GrubController();
		controllersByBus.set(bus, controller);
	}
	return controller;
}

function notify(bus: EventBus, message: string, type: "info" | "warning" | "error" = "info"): void {
	notifyByBus.get(bus)?.(message, type);
}

function getActiveLocale(): GrubLocale {
	return currentGrubLocale;
}

function localeFromSettings(ctx: Pick<ExtensionCommandContext, "getSettings">): GrubLocale {
	const locale = ctx.getSettings().locale;
	return locale === "zh" || locale === "en" ? locale : getLocale();
}

function localeForTask(task: GrubTaskState | undefined): GrubLocale {
	return task?.locale ?? getActiveLocale();
}

function publishGrubUpdate(
	api: ExtensionAPI,
	bus: EventBus,
	message: string,
	type: "info" | "warning" | "error" = "info",
): void {
	api.appendEntry(GRUB_CUSTOM_TYPE, { message, timestamp: Date.now() });
	notify(bus, message, type);
	api.sendMessage({
		customType: GRUB_CUSTOM_TYPE,
		content: message,
		display: true,
		details: { message, level: type, timestamp: Date.now() },
	});
}

function formatDate(timestamp: number, locale: GrubLocale): string {
	return new Date(timestamp).toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
}

function formatTaskState(task: GrubTaskState): string {
	const text = grubText(task.locale ?? "en");
	const lines = [
		`${text.prefix} ${text.activeTask} ${task.id}`,
		`${text.status}: ${task.status}`,
		`${text.phase}: ${task.phase}`,
		`${text.goal}: ${task.goal}`,
		`${text.started}: ${formatDate(task.startedAt, task.locale ?? "en")}`,
		`${text.currentIteration}: ${task.currentIteration}`,
		`${text.awaitingResult}: ${task.awaitingTurn ? text.yes : text.no}`,
		`${text.consecutiveFailures}: ${task.consecutiveFailures}/${task.maxConsecutiveFailures}`,
		`${text.maxIterations}: ${task.maxIterations}`,
		`${text.harnessDir}: ${task.harnessDirectory}`,
		`${text.featureList}: ${task.featureListPath}`,
		`${text.progressLog}: ${task.progressLogPath}`,
		`${text.initScript}: ${task.initScriptPath}`,
		`${text.stateFile}: ${task.stateFilePath}`,
	];

	const list = readFeatureList(task.featureListPath);
	if (list) {
		const total = list.features.length;
		const passing = list.features.filter((f) => f.passes).length;
		lines.push(text.featuresPassing(passing, total));
	}

	if (task.lastDecision?.summary) lines.push(`${text.lastSummary}: ${task.lastDecision.summary}`);
	if (task.lastDecision?.nextStep) lines.push(`${text.lastNextStep}: ${task.lastDecision.nextStep}`);
	if (task.lastError) lines.push(`${text.lastError}: ${task.lastError}`);

	return lines.join("\n");
}

function formatSnapshot(snapshot: GrubTaskSnapshot): string {
	const locale = snapshot.locale ?? "en";
	const text = grubText(locale);
	const lines = [
		`${text.prefix} ${text.lastTask} ${snapshot.id}`,
		`${text.status}: ${snapshot.status}`,
		`${text.phase}: ${snapshot.phase}`,
		`${text.goal}: ${snapshot.goal}`,
		`${text.started}: ${formatDate(snapshot.startedAt, locale)}`,
		`${text.updated}: ${formatDate(snapshot.updatedAt, locale)}`,
		`${text.completedIterations}: ${snapshot.completedIterations}`,
		`${text.consecutiveFailures}: ${snapshot.consecutiveFailures}`,
		`${text.harnessDir}: ${snapshot.harnessDirectory}`,
		`${text.featureList}: ${snapshot.featureListPath}`,
		`${text.progressLog}: ${snapshot.progressLogPath}`,
		`${text.initScript}: ${snapshot.initScriptPath}`,
		`${text.stateFile}: ${snapshot.stateFilePath}`,
	];

	if (snapshot.lastDecision?.summary) lines.push(`${text.lastSummary}: ${snapshot.lastDecision.summary}`);
	if (snapshot.lastDecision?.nextStep) lines.push(`${text.lastNextStep}: ${snapshot.lastDecision.nextStep}`);
	if (snapshot.lastError) lines.push(`${text.lastError}: ${snapshot.lastError}`);

	return lines.join("\n");
}

function extractAssistantText(message: AgentMessage | undefined): string {
	if (!message || (message as { role?: string }).role !== "assistant") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" &&
				part !== null &&
				"type" in part &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
}

function extractUserText(message: AgentMessage | undefined): string {
	if (!message || (message as { role?: string }).role !== "user") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" &&
				part !== null &&
				"type" in part &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("\n");
}

function getLastAssistantMessage(messages: AgentMessage[]): AgentMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		if ((messages[i] as { role?: string }).role === "assistant") {
			return messages[i];
		}
	}
	return undefined;
}

function extractGrubDecision(text: string): GrubDecision | undefined {
	const startIndex = text.lastIndexOf(LOOP_STATE_START);
	const endIndex = text.lastIndexOf(LOOP_STATE_END);
	if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) return undefined;

	const payload = text.slice(startIndex + LOOP_STATE_START.length, endIndex).trim();
	try {
		const parsed = JSON.parse(payload) as Partial<GrubDecision>;
		if (parsed.status !== "continue" && parsed.status !== "complete" && parsed.status !== "blocked") {
			return undefined;
		}

		const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
		const nextStep = typeof parsed.nextStep === "string" ? parsed.nextStep.trim() : undefined;
		if (!summary) return undefined;
		if (parsed.status === "continue" && !nextStep) return undefined;

		return { status: parsed.status, summary, nextStep };
	} catch {
		return undefined;
	}
}

function describeDecision(decision: GrubDecision): string {
	const locale = getActiveLocale();
	const text = grubText(locale);
	const lines = [`${text.prefix} ${text.decision}: ${decision.status}`, `${text.summary}: ${decision.summary}`];
	if (decision.nextStep) lines.push(`${text.nextStep}: ${decision.nextStep}`);
	return lines.join("\n");
}

function describeTerminalSnapshot(snapshot: GrubTaskSnapshot | undefined): string {
	if (!snapshot) return `${grubText(getActiveLocale()).prefix} ${grubText(getActiveLocale()).noActive}`;
	return formatSnapshot(snapshot);
}

function dispatchNextIteration(api: ExtensionAPI, bus: EventBus, controller: GrubController): void {
	const task = controller.getActiveTask();
	if (!task) return;

	const prompt = controller.buildPrompt();
	controller.markDispatched();
	publishGrubUpdate(api, bus, grubText(task.locale).startingIteration(task.currentIteration, task.id), "info");
	api.sendUserMessage(prompt, { deliverAs: "followUp" });
}

function buildInitScript(task: GrubTaskState): string {
	const isZh = task.locale === "zh";
	return [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		"",
		isZh
			? "# Grub harness 启动脚本（get-bearings 协议）。请将下方烟测替换为项目专属命令，"
			: "# Grub harness startup (get-bearings protocol). Override the smoke block below",
		isZh
			? "# 用来证明应用仍能端到端启动。"
			: "# with project-specific commands that prove the app still boots end-to-end.",
		"",
		'echo "=== grub bearings ==="',
		"pwd",
		'echo "--- recent commits ---"',
		"git log --oneline -n 20 2>/dev/null || true",
		'echo "--- working tree ---"',
		"git status --short 2>/dev/null || true",
		'echo "--- progress tail ---"',
		`tail -n 40 ${JSON.stringify(task.progressLogPath)} 2>/dev/null || true`,
		'echo "--- feature progress ---"',
		`node -e "try{const l=require(${JSON.stringify(task.featureListPath)});const p=l.features.filter(f=>f.passes).length;console.log(p+'/'+l.features.length+' passing');}catch(e){console.log('feature-list.json unavailable');}" 2>/dev/null || true`,
		'echo "--- project smoke (override below) ---"',
		isZh
			? "# TODO: 项目专属烟测命令（tests、curl、tsc --noEmit 等）"
			: "# TODO: project-specific smoke command (tests, curl, tsc --noEmit, etc.)",
		"",
	].join("\n");
}

function ensureHarnessArtifacts(task: GrubTaskState): void {
	if (!existsSync(task.harnessDirectory)) {
		mkdirSync(task.harnessDirectory, { recursive: true });
	}

	if (!existsSync(task.featureListPath)) {
		const migrated = existsSync(task.featureChecklistPath)
			? migrateChecklistToFeatureList(task.featureChecklistPath, task.goal)
			: null;
		writeFeatureList(task.featureListPath, migrated ?? createInitialFeatureList(task.goal));
	}

	if (!existsSync(task.progressLogPath)) {
		const text = grubText(task.locale);
		writeFileSync(
			task.progressLogPath,
			[
				text.progressLogTitle(task.id),
				"",
				`${text.goal}: ${task.goal}`,
				"",
				text.initializationHeading,
				text.harnessCreated,
				text.structuredFeatureNote,
				text.initScriptNote,
				"",
				text.iterationsHeading,
				text.appendIterationNote,
				"",
			].join("\n"),
			"utf-8",
		);
	}

	if (!existsSync(task.initScriptPath)) {
		writeFileSync(task.initScriptPath, buildInitScript(task), "utf-8");
		chmodSync(task.initScriptPath, 0o755);
	}
}

/**
 * Attempt to commit the initial harness directory so future coding agents
 * have a clean revert point. Best-effort: non-repo, dirty index, missing git,
 * or missing user.email silently short-circuit.
 */
function gitCommitHarness(cwd: string, task: GrubTaskState): void {
	try {
		execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd,
			stdio: "ignore",
			timeout: 2_000,
		});
	} catch {
		return;
	}
	const relativePath = `.grub/${task.id}/`;
	try {
		execFileSync("git", ["add", "--", relativePath], {
			cwd,
			stdio: "ignore",
			timeout: 2_000,
		});
		execFileSync("git", ["commit", "-m", `grub(${task.id}): init harness`, "--only", "--", relativePath], {
			cwd,
			stdio: "ignore",
			timeout: 3_000,
		});
	} catch {
		// Best-effort: ignore commit failures (e.g. no user.email configured).
	}
}

function resumeSummary(task: GrubTaskState): string {
	const text = grubText(task.locale ?? "en");
	return [
		text.resumeSummary(task.id, task.currentIteration, task.phase),
		`${text.goal}: ${task.goal}`,
		text.resumeHint,
	].join("\n");
}

export default async function grubExtension(api: ExtensionAPI) {
	const bus = api.events;
	const controller = getController(bus);

	// Opportunistic cleanup of long-abandoned harnesses (best effort).
	try {
		pruneStale(api.cwd);
	} catch {
		// ignore
	}

	api.registerMessageRenderer(GRUB_CUSTOM_TYPE, (message, _options, theme) => {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("\n");

		const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
		box.addChild(new Text(theme.fg("dim", text), 0, 0));

		const container = new Container();
		container.addChild(new Spacer(1));
		container.addChild(box);
		return container;
	});

	api.on("session_start", () => {
		if (controller.hasActiveTask()) return;
		const active = discoverActiveTasks(api.cwd);
		if (active.length === 0) return;
		// Adopt only the most recently persisted task; ignore any others so the
		// user is not forcibly pulled into multiple stale harnesses at once.
		const persisted = active[0];
		try {
			controller.adoptResumedTask(persisted.task);
			currentGrubLocale = persisted.task.locale ?? getLocale();
			publishGrubUpdate(api, bus, resumeSummary(persisted.task), "info");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			publishGrubUpdate(api, bus, grubText(persisted.task.locale ?? getLocale()).failedResume(persisted.task.id, message), "warning");
		}
	});

	api.on("session_shutdown", () => {
		// Persist is already called on every state transition; we only need to
		// unbind the in-memory bindings so a future session starts fresh.
		controllersByBus.delete(bus);
		notifyByBus.delete(bus);
	});

	api.on("before_agent_start", (event) => {
		if (!controller.isGrubPrompt(event.prompt)) return;
		const task = controller.getActiveTask();
		const phase = task?.phase ?? "execution";
		const locale = localeForTask(task);
		return {
			appendSystemPrompt: phase === "initializer" ? buildGrubInitializerPrompt(locale) : buildGrubCodingPrompt(locale),
		};
	});

	api.on("input", (event) => {
		if (event.source !== "extension" || !event.text.startsWith("[GRUB:")) return;
		if (!controller.isGrubPrompt(event.text)) return { action: "handled" };
		return { action: "continue" };
	});

	api.on("context", (event) => {
		const lastMessage = event.messages[event.messages.length - 1];
		const lastUserText = extractUserText(lastMessage);
		if (!lastUserText.startsWith("[GRUB:")) return;
		if (controller.isGrubPrompt(lastUserText)) return;
		return { messages: event.messages.slice(0, -1) };
	});

	api.on("agent_end", (event) => {
		const activeTask = controller.getActiveTask();
		if (!activeTask?.awaitingTurn) return;
		const text = grubText(activeTask.locale);
		currentGrubLocale = activeTask.locale;

		const assistantText = extractAssistantText(getLastAssistantMessage(event.messages));
		if (!assistantText) {
			const failure = controller.recordFailure(text.failedNoAssistant);
			if (failure.action === "stop") {
				publishGrubUpdate(api, bus, describeTerminalSnapshot(failure.snapshot), "warning");
				return;
			}
			publishGrubUpdate(
				api,
				bus,
				text.iterationFailedRetry(failure.task?.currentIteration),
				"warning",
			);
			dispatchNextIteration(api, bus, controller);
			return;
		}

		const parsedDecision = extractGrubDecision(assistantText);
		if (!parsedDecision) {
			const failure = controller.recordFailure(text.invalidLoopState);
			if (failure.action === "stop") {
				publishGrubUpdate(api, bus, describeTerminalSnapshot(failure.snapshot), "warning");
				return;
			}
			publishGrubUpdate(
				api,
				bus,
				text.invalidLoopRetry(failure.task?.currentIteration),
				"warning",
			);
			dispatchNextIteration(api, bus, controller);
			return;
		}

		const validated = controller.validateCompletion(parsedDecision);
		if (validated.downgraded) {
			publishGrubUpdate(
				api,
				bus,
				text.prematureComplete(validated.reason ?? (activeTask.locale === "zh" ? "仍有未完成 feature" : "pending features remain")),
				"warning",
			);
		}
		const decision = validated.decision;

		publishGrubUpdate(api, bus, describeDecision(decision), "info");
		const next = controller.finishTurn(decision);
		if (next.action === "stop") {
			publishGrubUpdate(
				api,
				bus,
				describeTerminalSnapshot(next.snapshot),
				decision.status === "complete" ? "info" : "warning",
			);
			return;
		}

		dispatchNextIteration(api, bus, controller);
	});

	const handleGrubCommand = async (args: string, ctx: ExtensionCommandContext) => {
		if (ctx.ui.notify) {
			notifyByBus.set(bus, ctx.ui.notify.bind(ctx.ui));
		}

		const parsed = parseGrubCommand(args);
		const settingsLocale = localeFromSettings(ctx);
		if (parsed.type === "help") {
			const text = grubText(settingsLocale);
			const reason = parsed.reason === "empty" ? text.missingGoal : undefined;
			publishGrubUpdate(api, bus, buildGrubHelp(reason, settingsLocale), "warning");
			return;
		}

		if (parsed.type === "status") {
			const state = controller.getState();
			if (parsed.json) {
				publishGrubUpdate(api, bus, JSON.stringify(state, null, 2), "info");
				return;
			}
			const message = state.active
				? formatTaskState(state.active)
				: state.lastTerminal
					? formatSnapshot(state.lastTerminal)
					: `${grubText(settingsLocale).prefix} ${grubText(settingsLocale).noStarted}`;
			publishGrubUpdate(api, bus, message, "info");
			return;
		}

		if (parsed.type === "stop") {
			const activeTask = controller.getActiveTask();
			const locale = localeForTask(activeTask);
			const text = grubText(locale);
			if (!activeTask) {
				publishGrubUpdate(api, bus, `${text.prefix} ${text.noActiveRunning}`, "warning");
				return;
			}

			controller.stop(locale === "zh" ? "用户请求停止。" : "Stopped by user request.", "stopped");
			if (!ctx.isIdle()) {
				ctx.abort();
			}
			publishGrubUpdate(api, bus, text.stopped(activeTask.id), "info");
			return;
		}

		if (parsed.type === "resume") {
			let activeTask = controller.getActiveTask();
			let locale = localeForTask(activeTask);
			if (!activeTask) {
				const persisted = discoverActiveTasks(ctx.cwd);
				if (persisted.length === 0) {
					publishGrubUpdate(api, bus, `${grubText(settingsLocale).prefix} ${grubText(settingsLocale).noPersisted}`, "warning");
					return;
				}
				try {
					activeTask = controller.adoptResumedTask(persisted[0].task);
					locale = activeTask.locale ?? settingsLocale;
					currentGrubLocale = locale;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					publishGrubUpdate(api, bus, grubText(settingsLocale).failedAdopt(message), "error");
					return;
				}
			}
			ensureHarnessArtifacts(activeTask);
			publishGrubUpdate(api, bus, grubText(locale).resuming(activeTask.id), "info");
			dispatchNextIteration(api, bus, controller);
			return;
		}

		try {
			const locale = detectGrubLocale(parsed.goal, settingsLocale);
			currentGrubLocale = locale;
			const task = controller.start(parsed.goal, ctx.cwd, {
				maxIterations: parsed.maxIterations,
				maxConsecutiveFailures: parsed.maxConsecutiveFailures,
				locale,
			});
			ensureHarnessArtifacts(task);
			gitCommitHarness(ctx.cwd, task);
			const text = grubText(locale);
			publishGrubUpdate(
				api,
				bus,
				[
					text.startedTask(task.id),
					`${text.goal}: ${task.goal}`,
					`${text.harnessDir}: ${task.harnessDirectory}`,
					text.initPhase,
					text.safetyLimits(task.maxIterations, task.maxConsecutiveFailures),
					`Language: ${languageName(locale)}`,
				].join("\n"),
				"info",
			);
			dispatchNextIteration(api, bus, controller);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			publishGrubUpdate(api, bus, `${grubText(settingsLocale).prefix} ${message}`, "error");
		}
	};

	api.registerCommand("grub", {
		description: "Dig through one autonomous task until it is complete, blocked, stopped, or fails.",
		handler: handleGrubCommand,
	});
}
