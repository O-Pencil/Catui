/**
 * [WHO]: Verifies createAgentSession wires agent-loop budget settings into Agent
 * [FROM]: Depends on createAgentSession, SettingsManager, model registry types
 * [TO]: Consumed by root node:test verification
 * [HERE]: test/sdk-agent-loop-budget.test.ts - runtime SDK coverage for loop budget plumbing
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getModel, type Model } from "@pencil-agent/ai";
import { SettingsManager } from "../core/config/settings-manager.js";
import { createAgentSession } from "../core/runtime/sdk.js";

test("createAgentSession passes aggregate tool result budget into Agent", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "nanopencil-sdk-budget-"));
	const agentCtx = { id: "sdk-budget-test", path: agentDir };
	const settingsManager = SettingsManager.inMemory({
		agentLoop: { maxToolResultBatchSizeChars: 123_456 },
	});
	const model = {
		...getModel("openai", "gpt-4o-mini"),
		agentLoopFramework: "weak-model-compatible",
	} as Model<any> & { agentLoopFramework: "weak-model-compatible" };

	const { session } = await createAgentSession({
		cwd: process.cwd(),
		agentCtx,
		agentDir,
		settingsManager,
		model,
		enableSoul: false,
	});

	const agentWithPrivateOptions = session.agent as unknown as {
		maxToolResultBatchSizeChars?: number;
	};
	assert.equal(agentWithPrivateOptions.maxToolResultBatchSizeChars, 123_456);
});

test("createAgentSession accepts explicit loop framework and prompt limits", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "nanopencil-sdk-loop-overrides-"));
	const agentCtx = { id: "sdk-loop-overrides-test", path: agentDir };

	const { session } = await createAgentSession({
		cwd: process.cwd(),
		agentCtx,
		agentDir,
		settingsManager: SettingsManager.inMemory(),
		model: getModel("openai", "gpt-4o-mini"),
		enableSoul: false,
		agentLoopFramework: "weak-model-compatible",
		maxTurnsPerPrompt: 3,
		maxToolCallsPerPrompt: 8,
		maxToolConcurrency: 2,
	});

	const agentWithPrivateOptions = session.agent as unknown as {
		maxTurnsPerPrompt?: number;
		maxToolCallsPerPrompt?: number;
		maxToolConcurrency?: number;
	};
	assert.equal(session.agentLoopFramework, "weak-model-compatible");
	assert.equal(agentWithPrivateOptions.maxTurnsPerPrompt, 3);
	assert.equal(agentWithPrivateOptions.maxToolCallsPerPrompt, 8);
	assert.equal(agentWithPrivateOptions.maxToolConcurrency, 2);
});

test("createAgentSession accepts output continuation loop policy", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "nanopencil-sdk-output-budget-"));
	const agentCtx = { id: "sdk-output-budget-test", path: agentDir };

	const { session } = await createAgentSession({
		cwd: process.cwd(),
		agentCtx,
		agentDir,
		settingsManager: SettingsManager.inMemory(),
		model: getModel("openai", "gpt-4o-mini"),
		enableSoul: false,
		loopPolicy: {
			outputTokenBudget: {
				targetTokens: 1200,
				thresholdPct: 0.75,
				maxContinuations: 2,
			},
			maxOutputTokenRecoveryAttempts: 3,
		},
	});

	const agentWithPrivateOptions = session.agent as unknown as {
		outputTokenBudget?: {
			targetTokens: number;
			thresholdPct?: number;
			maxContinuations?: number;
		};
		maxOutputTokenRecoveryAttempts?: number;
	};
	assert.deepEqual(agentWithPrivateOptions.outputTokenBudget, {
		targetTokens: 1200,
		thresholdPct: 0.75,
		maxContinuations: 2,
	});
	assert.equal(agentWithPrivateOptions.maxOutputTokenRecoveryAttempts, 3);
});

test("AgentSession forwards runtime loop policy updates into Agent", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "nanopencil-sdk-loop-policy-"));
	const agentCtx = { id: "sdk-loop-policy-test", path: agentDir };
	const { session } = await createAgentSession({
		cwd: process.cwd(),
		agentCtx,
		agentDir,
		settingsManager: SettingsManager.inMemory(),
		model: getModel("openai", "gpt-4o-mini"),
		enableSoul: false,
	});

	session.setLoopPolicy({ maxToolCallsPerPrompt: 2 });

	const agentWithPrivateOptions = session.agent as unknown as {
		maxToolCallsPerPrompt?: number;
	};
	assert.equal(agentWithPrivateOptions.maxToolCallsPerPrompt, 2);
});
