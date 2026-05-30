import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionRunner } from "../core/extensions-host/index.js";
import type { ResourceLoader } from "../core/platform/config/resource-loader.js";
import type { PromptTemplate } from "../core/prompt/prompt-templates.js";
import type { Skill } from "../core/skills.js";
import { buildRpcLoopPolicyOptions, buildRpcSessionState, buildRpcSlashCommands } from "../modes/rpc/rpc-mode.js";

const promptTemplates = [
	{
		name: "draft",
		description: "Draft from prompt",
		source: "project",
		filePath: "/workspace/.pencil/prompts/draft.md",
	},
] as PromptTemplate[];

const skill: Skill = {
	name: "review",
	description: "Review skill",
	source: "user",
	filePath: "/home/user/.nanopencil/skills/review/SKILL.md",
	content: "",
	disableModelInvocation: false,
};

const resourceLoader = {
	getSkills: () => ({
		skills: [skill],
		diagnostics: [],
	}),
} satisfies Pick<ResourceLoader, "getSkills">;

const extensionRunner = {
	getRegisteredCommandsWithPaths: () => [
		{
			command: { name: "deploy", description: "Deploy project" },
			extensionPath: "/workspace/extensions/deploy",
		},
		{
			command: { name: "model", description: "Should not shadow builtin" },
			extensionPath: "/workspace/extensions/shadow",
		},
	],
} as ExtensionRunner;

test("rpc command catalog shares category and shadow filtering with runtime catalog", () => {
	const commands = buildRpcSlashCommands({
		promptTemplates,
		resourceLoader: resourceLoader as ResourceLoader,
		extensionRunner,
	});

	assert.deepEqual(commands, [
		{
			name: "deploy",
			description: "Deploy project",
			source: "extension",
			category: "tools",
			location: undefined,
			path: "/workspace/extensions/deploy",
		},
		{
			name: "draft",
			description: "Draft from prompt",
			source: "prompt",
			category: "workflow",
			location: "project",
			path: "/workspace/.pencil/prompts/draft.md",
		},
		{
			name: "skill:review",
			description: "Review skill",
			source: "skill",
			category: "tools",
			location: "user",
			path: "/home/user/.nanopencil/skills/review/SKILL.md",
		},
	]);
});

test("rpc session state exposes last agent loop result", () => {
	const state = buildRpcSessionState({
		model: undefined,
		thinkingLevel: "off",
		agentLoopFramework: "standard",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "one-at-a-time",
		followUpMode: "one-at-a-time",
		sessionFile: "/tmp/session.jsonl",
		sessionId: "session-1",
		sessionName: "Loop debugging",
		autoCompactionEnabled: true,
		messages: [],
		pendingMessageCount: 0,
		state: {
			lastResult: {
				stopReason: "toolUse",
				turnCount: 3,
				toolCallCount: 4,
				durationMs: 250,
				lastTransition: { reason: "tool_result", toolCallCount: 2 },
			},
		},
	});

	assert.deepEqual(state.lastResult, {
		stopReason: "toolUse",
		turnCount: 3,
		toolCallCount: 4,
		durationMs: 250,
		lastTransition: { reason: "tool_result", toolCallCount: 2 },
	});
});

test("rpc loop policy maps serializable controls and clears nullable fields", () => {
	assert.deepEqual(
		buildRpcLoopPolicyOptions({
			maxToolCallsPerPrompt: 4,
			maxTurnsPerPrompt: null,
			outputTokenBudget: {
				targetTokens: 1200,
				thresholdPct: 0.75,
				maxContinuations: 2,
			},
		}),
		{
			maxToolCallsPerPrompt: 4,
			maxTurnsPerPrompt: undefined,
			outputTokenBudget: {
				targetTokens: 1200,
				thresholdPct: 0.75,
				maxContinuations: 2,
			},
		},
	);

	assert.deepEqual(buildRpcLoopPolicyOptions({ outputTokenBudget: null }), {
		outputTokenBudget: undefined,
	});
});
