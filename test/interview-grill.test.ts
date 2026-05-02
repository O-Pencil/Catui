import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@pencil-agent/tui";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	RegisteredTool,
} from "../core/extensions/types.js";
import interviewExtension from "../extensions/defaults/interview/index.js";

function createSessionManager(lastUserText?: string) {
	const entries = lastUserText
		? [
				{
					type: "message",
					message: {
						role: "user",
						content: lastUserText,
					},
				},
			]
		: [];
	return {
		getEntries: () => entries,
		getBranch: () => entries,
		getSessionId: () => "session-1",
	};
}

function createHarness(options: { hasUI?: boolean; lastUserText?: string; cancelInput?: boolean; invalidProbe?: boolean; chooseCustom?: boolean } = {}) {
	const commands = new Map<string, any>();
	const tools = new Map<string, RegisteredTool>();
	const renderers = new Map<string, any>();
	const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<any> | any>>();
	const sentMessages: Array<{ message: any; options?: any }> = [];
	const notifications: string[] = [];
	const completeCalls: Array<{ systemPrompt: string; userMessage: string }> = [];
	const inputPrompts: string[] = [];
	const selectPrompts: string[] = [];
	const workingMessages: Array<string | undefined> = [];

	const api = {
		cwd: process.cwd(),
		events: {},
		registerCommand: (name: string, command: any) => commands.set(name, command),
		registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
		registerMessageRenderer: (type: string, renderer: any) => renderers.set(type, renderer),
		on: (event: string, handler: any) => {
			const current = handlers.get(event) ?? [];
			current.push(handler);
			handlers.set(event, current);
		},
		sendMessage: (message: any, opts?: any) => sentMessages.push({ message, options: opts }),
		appendEntry: () => {},
		getActiveTools: () => [],
	} as unknown as ExtensionAPI;

	const ctx = {
		cwd: process.cwd(),
		hasUI: options.hasUI ?? true,
		sessionManager: createSessionManager(options.lastUserText),
		model: { provider: "test", id: "test-model" },
		completeSimple: async (systemPrompt: string, userMessage: string) => {
			completeCalls.push({ systemPrompt, userMessage });
			if (options.invalidProbe) return undefined;
			if (systemPrompt.includes("Grill me")) {
				return JSON.stringify({
					completionScore: 0.4,
					refinedIntent: "Grill Summary: validate the architecture boundary before implementation.",
					missingSlots: [
						{
							key: "boundary",
							question: "Should this live inside interview or a separate extension?",
							recommendedAnswer: "Keep it inside interview and add grill mode.",
							allowCustom: true,
						},
					],
				});
			}
			return JSON.stringify({
				completionScore: 0.4,
				refinedIntent: "Clarified intent: define deliverable and acceptance.",
				missingSlots: [
					{
						key: "deliverable",
						question: "What should be delivered?",
						allowCustom: true,
					},
				],
			});
		},
		getSettings: () => ({}),
		ui: {
			notify: (message: string) => notifications.push(message),
			setWorkingMessage: (message?: string) => workingMessages.push(message),
			input: async (title: string) => {
				inputPrompts.push(title);
				if (options.cancelInput) return undefined;
				return "Keep it inside interview and add grill mode.";
			},
			select: async (title: string, optionsList: string[]) => {
				selectPrompts.push(title);
				if (options.cancelInput) return undefined;
				return options.chooseCustom ? optionsList[1] : optionsList[0];
			},
		},
	} as unknown as ExtensionCommandContext & ExtensionContext;

	return { api, ctx, commands, tools, renderers, handlers, sentMessages, notifications, completeCalls, inputPrompts, selectPrompts, workingMessages };
}

test("interview extension registers grill commands and uses recent user text", async () => {
	const harness = createHarness({ lastUserText: "帮我规划 NP-01，但我说不清楚需求" });
	await interviewExtension(harness.api);

	assert.ok(harness.commands.has("interview"));
	assert.ok(harness.commands.has("grill-me"));
	assert.equal(harness.commands.has("grill"), false);

	await harness.commands.get("grill-me").handler("", harness.ctx);

	assert.equal(harness.sentMessages.length, 3);
	assert.match(harness.sentMessages[0].message.content, /正在读取项目上下文/);
	assert.match(harness.sentMessages[0].message.content, /初始目标/);
	assert.match(harness.sentMessages[0].message.content, /帮我规划 NP-01/);
	assert.match(harness.sentMessages[1].message.content, /已确认第 1 个回答/);
	assert.equal(harness.sentMessages[2].message.customType, "grill_summary");
	assert.equal(harness.sentMessages[2].options.triggerTurn, true);
	assert.match(harness.sentMessages[2].message.content, /\[Grill Summary\]/);
	assert.match(harness.sentMessages[2].message.content, /Keep it inside interview/);
	assert.equal(harness.sentMessages[2].message.details.mode, "grill");
	assert.ok(harness.workingMessages.some((message) => message?.includes("Grilling：正在读取项目上下文")));
	assert.ok(harness.workingMessages.some((message) => message?.includes("Grilling：正在生成第 1 个追问")));
	assert.ok(harness.workingMessages.some((message) => message?.includes("Grilling：正在整理 summary")));
	assert.ok(harness.completeCalls[0].userMessage.includes("[Response language]\nChinese"));
	assert.ok(harness.completeCalls[0].userMessage.includes("[Workspace context]"));
	assert.ok(harness.completeCalls[0].userMessage.includes("projectNameFromPath:"));
});

test("grill fallback stays Chinese and asks context-aware performance question", async () => {
	const harness = createHarness({
		lastUserText: "/grill-me 帮我设计一下当前启动性能优化的方案，以及如何测评是真的优化了而不是主观感受",
		invalidProbe: true,
		cancelInput: true,
	});
	await interviewExtension(harness.api);

	await harness.commands.get("grill-me").handler("", harness.ctx);

	assert.match(harness.selectPrompts[0], /启动性能优化/);
	assert.match(harness.selectPrompts[0], /可量化目标/);
	assert.doesNotMatch(harness.selectPrompts[0], /What is the most important decision/);
	assert.doesNotMatch(harness.selectPrompts[0], /Electron\/React/);
});

test("grill skips answered slots instead of repeating the same fallback question", async () => {
	const harness = createHarness({
		lastUserText: "/grill-me 帮我设计一下当前启动性能优化的方案，以及如何测评是真的优化了而不是主观感受",
		invalidProbe: true,
	});
	await interviewExtension(harness.api);

	await harness.commands.get("grill-me").handler("", harness.ctx);

	assert.ok(harness.selectPrompts.length >= 3);
	assert.match(harness.selectPrompts[0], /可量化目标/);
	assert.match(harness.selectPrompts[1], /真实场景/);
	assert.match(harness.selectPrompts[2], /阈值证明优化有效/);
});

test("grill custom answer opens a clear input prompt", async () => {
	const harness = createHarness({
		lastUserText: "帮我设计启动性能优化方案",
		chooseCustom: true,
	});
	await interviewExtension(harness.api);

	await harness.commands.get("grill-me").handler("", harness.ctx);

	assert.match(harness.inputPrompts[0], /custom answer|自定义回答/i);
	assert.match(harness.inputPrompts[0], /Enter.*Esc|Enter 提交，Esc 取消/);
});

test("grill renderer wraps long visible status lines safely", async () => {
	const harness = createHarness();
	await interviewExtension(harness.api);

	const renderer = harness.renderers.get("grill_summary");
	assert.ok(renderer);

	const component = renderer(
		{
			customType: "grill_summary",
			content: "Grilling：正在读取项目上下文并生成第一轮追问，随后会把已确认内容整理成 Grill Summary。这是一段很长很长的状态文本。",
			display: true,
		},
		{ expanded: true },
		{
			bg: (_key: string, value: string) => value,
			fg: (_key: string, value: string) => value,
		},
	);
	const lines = component.render(59);
	assert.ok(lines.length > 0);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 59, `line too wide (${visibleWidth(line)}): ${line}`);
	}
});

test("before_agent_start gives strong grill hint for unclear design prompts", async () => {
	const harness = createHarness();
	await interviewExtension(harness.api);

	const handler = harness.handlers.get("before_agent_start")?.[0] as (
		event: BeforeAgentStartEvent,
		ctx: ExtensionContext,
	) => Promise<BeforeAgentStartEventResult | undefined>;

	const result = await handler(
		{
			type: "before_agent_start",
			prompt: "我现在有个架构方案说不清楚，帮我压测一下再决定怎么做",
		} as BeforeAgentStartEvent,
		harness.ctx,
	);

	assert.ok(result?.appendSystemPrompt?.includes("[Grill Hint]"));
	assert.ok(result?.appendSystemPrompt?.includes('mode="grill"'));
});

test("before_agent_start still skips loop-managed prompts", async () => {
	const harness = createHarness();
	await interviewExtension(harness.api);

	const handler = harness.handlers.get("before_agent_start")?.[0] as (
		event: BeforeAgentStartEvent,
		ctx: ExtensionContext,
	) => Promise<BeforeAgentStartEventResult | undefined>;

	const result = await handler(
		{
			type: "before_agent_start",
			prompt: "[LOOP: abc] You are inside a managed loop. grill me on this plan",
		} as BeforeAgentStartEvent,
		harness.ctx,
	);

	assert.equal(result, undefined);
});

test("interview tool supports grill mode in non-UI fallback", async () => {
	const harness = createHarness({ hasUI: false });
	await interviewExtension(harness.api);

	const tool = harness.tools.get("interview");
	assert.ok(tool);

	const result = await tool.execute(
		"tool-1",
		{
			query: "grill me on moving channel gateway into the agent gateway",
			mode: "grill",
		},
		new AbortController().signal,
		() => {},
		harness.ctx,
	);

	assert.equal((result.details as { mode?: string } | undefined)?.mode, "grill");
	assert.match(result.content?.[0]?.type === "text" ? result.content[0].text : "", /Grill Summary/);
	assert.equal(harness.completeCalls.length, 1);
	assert.ok(harness.completeCalls[0].systemPrompt.includes("Grill me"));
});

test("grill command exits without triggering a turn when user cancels follow-up", async () => {
	const harness = createHarness({
		lastUserText: "帮我设计启动性能优化方案",
		cancelInput: true,
	});
	await interviewExtension(harness.api);

	await harness.commands.get("grill-me").handler("", harness.ctx);

	assert.equal(harness.sentMessages.length, 1);
	assert.match(harness.sentMessages[0].message.content, /正在读取项目上下文|Grilling:/);
	assert.equal(harness.sentMessages[0].options, undefined);
	assert.ok(harness.notifications.some((message) => message.includes("Exited grill mode")));
	assert.equal(harness.workingMessages.at(-1), undefined);
});
