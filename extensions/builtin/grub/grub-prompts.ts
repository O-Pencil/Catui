/**
 * [WHO]: Provides buildGrubInitializerPrompt(), buildGrubCodingPrompt(), buildGrubTaskPrompt()
 * [FROM]: Depends on ./grub-i18n and ./grub-types for locale-aware task prompts
 * [TO]: Consumed by ./index.ts and ./grub-controller.ts for /grub prompt injection and dispatch
 * [HERE]: extensions/builtin/grub/grub-prompts.ts - prompt construction boundary for the Grub harness
 */

import { languageName, grubText, type GrubLocale } from "./grub-i18n.js";
import type { GrubTaskState } from "./grub-types.js";

export function buildGrubInitializerPrompt(locale: GrubLocale): string {
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

Graduation: as soon as you emit a structurally valid list (15-40 features,
real kebab-case ids, placeholder replaced) the harness AUTOMATICALLY advances
to the execution phase on the next turn. Do NOT mark any feature passing now
and do NOT touch the goal text; if you accidentally do, the harness silently
sanitimizes them (goal restored, passes reset to false) instead of failing —
but keep the list clean so nothing is lost.

Rules for later coding agents (document them in progress-log.md):
- Coding agents may ONLY flip "passes" and set "evidence" on features.
- Never remove tests. Treat existing tests as ground truth.
- Do not create git commits unless the user explicitly asks for them. Record
  verification evidence in feature-list.json and progress-log.md instead.

End with exactly one XML block:
<loop-state>{"status":"continue","summary":"harness ready","nextStep":"begin execution phase"}</loop-state>
${languageLine}
`.trim();
}

export function buildGrubCodingPrompt(locale: GrubLocale): string {
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
6) Do not create git commits by default. Keep changes visible in the working
   tree and use evidence strings/progress-log.md as the reversible checkpoint.
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

export function buildGrubTaskPrompt(task: GrubTaskState): string {
	const text = grubText(task.locale);
	const sections = [
		`${getPromptPrefix(task.id)}${task.currentIteration}]`,
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
			task.locale === "zh"
				? "6. 本阶段不要标记任何 feature 通过，也不要改动 goal——清单结构合格后，系统会自动进入执行阶段，届时再逐个标记 passes。"
				: "6. Do not mark any feature as passing or change the goal in this phase—once the list is structurally valid the harness auto-advances to execution, where you mark passes one by one.",
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
				? "5. 本轮结束前追加进度日志；默认不要创建 git commit。"
				: "5. Append progress log before finishing the turn; do not create git commits by default.",
			task.locale === "zh" ? "6. 每轮都保持增量、安全、可回退。" : "6. Keep each iteration incremental and production-safe.",
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

export function getPromptPrefix(taskId: string): string {
	return `[GRUB:${taskId}:`;
}
