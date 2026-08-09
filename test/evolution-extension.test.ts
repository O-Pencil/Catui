/**
 * [WHO]: Registration, prompt-consumption, eval gate, and trace-fixture tests for optional evolution extension
 * [FROM]: Depends on node:test, temporary agent dirs, extension API test doubles
 * [TO]: Consumed by self-evolution extension verification
 * [HERE]: test/evolution-extension.test.ts - /refine, active artifact injection, and self-evolution gate coverage
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RunTraceEventV1 } from "@catui/agent-core";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ToolDefinition,
	ExtensionAPI,
	ExtensionCommandContext,
	RegisteredCommand,
} from "../core/extensions-host/types.js";
import evolutionExtension from "../extensions/optional/evolution/index.js";
import {
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	inspectEvolution,
	promoteEvolutionCandidate,
} from "../extensions/optional/evolution/evolution-store.js";
import { createEvolutionRefineTool } from "../extensions/optional/evolution/evolution-refine-tool.js";

function minimalTrace(outputFingerprint = "sha256:out"): RunTraceEventV1[] {
	return [
		{ version: 1, eventId: "e1", sequence: 1, timestamp: 1, runId: "project-run", kind: "run.started", payload: { loopFramework: "standard", inputFingerprint: "sha256:in" } },
		{ version: 1, eventId: "e2", sequence: 2, timestamp: 2, runId: "project-run", kind: "run.completed", payload: { stopReason: "stop", turnCount: 0, toolCallCount: 0, outputFingerprint } },
	];
}

function writeProjectEvalCorpus(cwd: string, options: { observedOutput?: string; policyViolations?: number } = {}): void {
	const dir = join(cwd, ".catui", "evolution");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "eval-manifest.json"),
		`${JSON.stringify({
			version: 1,
			thresholds: { minimumPassRate: 1, maximumReplayDivergences: 0, maximumPolicyViolations: 0, maximumUnpairedToolCalls: 0 },
			scenarios: [{ id: "project-smoke", fixture: "project-smoke", frameworks: ["standard"] }],
		}, null, 2)}\n`,
		"utf8",
	);
	writeFileSync(
		join(dir, "eval-fixtures.json"),
		`${JSON.stringify({
			"project-smoke": {
				recorded: minimalTrace(),
				observed: minimalTrace(options.observedOutput ?? "sha256:out"),
				policyViolations: options.policyViolations ?? 0,
			},
		}, null, 2)}\n`,
		"utf8",
	);
}

function writeProjectStreamEvalCorpus(cwd: string): void {
	const dir = join(cwd, ".catui", "evolution");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "eval-manifest.json"),
		`${JSON.stringify({
			version: 1,
			thresholds: { minimumPassRate: 1, maximumReplayDivergences: 0, maximumPolicyViolations: 0, maximumUnpairedToolCalls: 0 },
			streams: [
				{ id: "isolated-project-stream", mode: "isolated", scenarios: ["project-smoke"] },
				{ id: "interleaved-project-stream", mode: "interleaved", scenarios: ["project-smoke"] },
			],
			scenarios: [{ id: "project-smoke", fixture: "project-smoke", frameworks: ["standard"] }],
		}, null, 2)}\n`,
		"utf8",
	);
	writeFileSync(
		join(dir, "eval-fixtures.json"),
		`${JSON.stringify({
			"project-smoke": {
				recorded: minimalTrace(),
				observed: minimalTrace(),
				policyViolations: 0,
			},
		}, null, 2)}\n`,
		"utf8",
	);
}

function writeTraceJsonl(path: string, events: readonly RunTraceEventV1[]): void {
	writeFileSync(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
}

type BeforeAgentStartHandler = (
	event: BeforeAgentStartEvent,
	ctx: ExtensionCommandContext,
) => BeforeAgentStartEventResult | Promise<BeforeAgentStartEventResult | void> | void;

function createHarness() {
	const agentDir = mkdtempSync(join(tmpdir(), "catui-evolution-extension-"));
	const commands = new Map<string, RegisteredCommand["handler"]>();
	const handlers = new Map<string, unknown[]>();
	const tools = new Map<string, ToolDefinition>();
	const messages: string[] = [];
	const api = {
		cwd: process.cwd(),
		agentDir,
		registerCommand: (name: string, options: Omit<RegisteredCommand, "name">) => commands.set(name, options.handler),
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		on: (event: string, handler: unknown) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		sendMessage: (message: { content: string }) => messages.push(message.content),
		appendEntry: () => {},
	} as unknown as ExtensionAPI;
	return {
		agentDir,
		api,
		commands,
		handlers,
		tools,
		messages,
		cleanup: () => rmSync(agentDir, { recursive: true, force: true }),
	};
}

test("evolution extension registers refine command and injects only promoted prompt artifacts", async () => {
	const harness = createHarness();
	try {
		await evolutionExtension(harness.api);
		assert.ok(harness.commands.has("refine"));
		assert.ok(harness.handlers.has("before_agent_start"));

		const scope = { scope: "session" as const, sessionId: "session-a" };
		const root = getEvolutionScopeRoot(harness.agentDir, scope);
		createEvolutionCandidate(root, {
			scope: "session",
			summary: "Persist prompt note",
			rationale: "Repeated evidence",
			expectedOutcome: "Better future behavior",
			artifacts: [
				{
					id: "evolved:prompt_note:stay-small",
					kind: "prompt_note",
					title: "Stay small",
					content: "Prefer the smallest evidence-backed reusable change.",
					tokenBudget: 40,
				},
				{
					id: "evolved:skill_manifest:review-flow",
					kind: "skill_manifest",
					title: "Review flow",
					content: "A non-executable description for future planning only.",
				},
			],
		}, { id: () => "candidate-a" });

		const beforeAgentStart = harness.handlers.get("before_agent_start")?.[0] as BeforeAgentStartHandler;
		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-a", getEntries: () => [] },
			cwd: process.cwd(),
			ui: { notify: () => {} },
		} as unknown as ExtensionCommandContext;
		const inactive = await beforeAgentStart(
			{ type: "before_agent_start", prompt: "hello", systemPrompt: "base" },
			ctx,
		);
		assert.equal(inactive?.appendSystemPrompt, undefined);

		promoteEvolutionCandidate(root, "candidate-a", { id: () => "revision-a", approvedBy: "test" });
		const active = await beforeAgentStart({ type: "before_agent_start", prompt: "hello", systemPrompt: "base" }, ctx);
		assert.match(active?.appendSystemPrompt ?? "", /Catui evolved harness notes/);
		assert.match(active?.appendSystemPrompt ?? "", /Prefer the smallest evidence-backed reusable change/);
		assert.doesNotMatch(active?.appendSystemPrompt ?? "", /Review flow/);
	} finally {
		harness.cleanup();
	}
});

test("evolution extension exposes promoted tool specs through controlled evolved_tool", async () => {
	const harness = createHarness();
	try {
		await evolutionExtension(harness.api);
		const tool = harness.tools.get("evolved_tool");
		assert.ok(tool, "Expected evolved_tool to be registered.");

		const scope = { scope: "session" as const, sessionId: "session-tool" };
		const root = getEvolutionScopeRoot(harness.agentDir, scope);
		createEvolutionCandidate(root, {
			scope: "session",
			summary: "Create reusable investigation tool",
			rationale: "Repeated debugging sessions used the same evidence collection sequence.",
			expectedOutcome: "Future debugging starts from a consistent evidence pack.",
			artifacts: [
				{
					id: "evolved:tool_spec:collect-failure-evidence",
					kind: "tool_spec",
					title: "Collect failure evidence",
					content: "Read the failing test output, inspect the touched module, and summarize the smallest reproduction before editing.",
					applicability: "A test or build command fails.",
					nonApplicability: "No failure output is available.",
					metadata: {
						inputs: { failure: "failing command or error text" },
						steps: [
							{ name: "Read failure output", instruction: "Inspect the supplied failure text and identify the failing command or assertion." },
							{ name: "Inspect owner", instruction: "Find the closest source owner before editing." },
						],
						usesExistingTools: ["read", "grep", "bash"],
					},
				},
			],
		}, { id: () => "candidate-tool" });

		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-tool", getEntries: () => [] },
			cwd: process.cwd(),
		} as unknown as ExtensionCommandContext;
		const inactive = await tool.execute("tool-call", { action: "list" }, undefined, undefined, ctx);
		assert.match(inactive.content[0]?.type === "text" ? inactive.content[0].text : "", /No promoted evolved tool specs/);

		promoteEvolutionCandidate(root, "candidate-tool", { id: () => "revision-tool", approvedBy: "test" });
		const listed = await tool.execute("tool-call", { action: "list" }, undefined, undefined, ctx);
		assert.match(listed.content[0]?.type === "text" ? listed.content[0].text : "", /collect-failure-evidence/);

		const invoked = await tool.execute(
			"tool-call",
			{ action: "invoke", id: "evolved:tool_spec:collect-failure-evidence", input: { failure: "npm test failed" } },
			undefined,
			undefined,
			ctx,
		);
		const text = invoked.content[0]?.type === "text" ? invoked.content[0].text : "";
		assert.match(text, /Collect failure evidence/);
		assert.match(text, /Read the failing test output/);
		assert.match(text, /This evolved tool is declarative/);

		const missingInput = await tool.execute(
			"tool-call",
			{ action: "invoke", id: "evolved:tool_spec:collect-failure-evidence" },
			undefined,
			undefined,
			ctx,
		);
		assert.match(missingInput.content[0]?.type === "text" ? missingInput.content[0].text : "", /missing required input: failure/);

		const details = invoked.details as { plan?: { inputs?: Record<string, unknown>; steps?: Array<{ name: string }> } };
		assert.equal(details.plan?.inputs?.failure, "npm test failed");
		assert.equal(details.plan?.steps?.[0]?.name, "Read failure output");
	} finally {
		harness.cleanup();
	}
});

test("evolution_refine lets the model create and auto-promote session tool specs without installing code", async () => {
	const harness = createHarness();
	try {
		await evolutionExtension(harness.api);
		const refineTool = harness.tools.get("evolution_refine");
		const evolvedTool = harness.tools.get("evolved_tool");
		assert.ok(refineTool, "Expected evolution_refine to be registered.");
		assert.ok(evolvedTool, "Expected evolved_tool to be registered.");

		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-autonomous", getEntries: () => [] },
			cwd: process.cwd(),
		} as unknown as ExtensionCommandContext;

		const created = await refineTool.execute(
			"tool-call",
			{
				action: "create_tool_spec",
				title: "Triage flaky test",
				content: "Compare the failing assertion, recent changed files, and the smallest reproducible test before editing.",
				applicability: "A test fails intermittently or only in CI.",
				nonApplicability: "The failure is deterministic and already localized.",
				autoPromote: true,
			},
			undefined,
			undefined,
			ctx,
		);
		const createdText = created.content[0]?.type === "text" ? created.content[0].text : "";
		assert.match(createdText, /created/);
		assert.match(createdText, /promoted/);

		const listed = await evolvedTool.execute("tool-call", { action: "list" }, undefined, undefined, ctx);
		assert.match(listed.content[0]?.type === "text" ? listed.content[0].text : "", /triage-flaky-test/);

		const rejected = await refineTool.execute(
			"tool-call",
			{
				action: "create_tool_spec",
				title: "Install helper",
				content: "Run npm i helper-package and call https://api.example.com.",
				autoPromote: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(rejected.content[0]?.type === "text" ? rejected.content[0].text : "", /Error:/);
	} finally {
		harness.cleanup();
	}
});

test("evolution_refine gates auto-promotion with deterministic eval evidence", async () => {
	const harness = createHarness();
	try {
		const refineTool = createEvolutionRefineTool({
			runGate: async () => ({
				name: "test-gate",
				passed: true,
				checkedAt: "2026-08-09T00:00:00.000Z",
				metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
			}),
		});
		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-gated", getEntries: () => [] },
			cwd: process.cwd(),
		} as unknown as ExtensionCommandContext;

		const promoted = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				kind: "memory",
				title: "Gate-backed lesson",
				content: "Use deterministic eval evidence before activating reusable self-evolution artifacts.",
				applicability: "Self-evolution auto-promotion decisions.",
				autoPromote: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(promoted.content[0]?.type === "text" ? promoted.content[0].text : "", /promoted/);
		const root = getEvolutionScopeRoot(harness.agentDir, { scope: "session", sessionId: "session-gated" });
		const revisionId = inspectEvolution(root).current?.revisionId;
		assert.ok(revisionId);
		const revision = inspectEvolution(root).revisions.find((item) => item.id === revisionId);
		assert.equal(revision?.gateReport?.name, "test-gate");
		assert.equal(revision?.gateReport?.passed, true);

		const blockedTool = createEvolutionRefineTool({
			runGate: async () => ({
				name: "test-gate",
				passed: false,
				checkedAt: "2026-08-09T00:01:00.000Z",
				metrics: { passRate: 0.5, replayDivergences: 1, policyViolations: 0, unpairedToolCalls: 0 },
				failure: "replay divergence",
			}),
		});
		const blocked = await blockedTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				kind: "memory",
				title: "Blocked lesson",
				content: "This candidate should not activate when the eval gate fails.",
				applicability: "Self-evolution auto-promotion decisions.",
				autoPromote: true,
			},
			undefined,
			undefined,
			ctx,
		);
		const blockedText = blocked.content[0]?.type === "text" ? blocked.content[0].text : "";
		assert.match(blockedText, /created/);
		assert.match(blockedText, /eval gate failed/i);
		const inspection = inspectEvolution(root);
		const blockedCandidate = inspection.candidates.find((candidate) => candidate.summary.includes("Blocked lesson"));
		assert.equal(blockedCandidate?.status, "proposed");
		assert.equal((blockedCandidate?.evidence?.gateReport as { passed?: boolean } | undefined)?.passed, false);
	} finally {
		harness.cleanup();
	}
});

test("evolution_refine uses project custom eval corpus for auto-promotion", async () => {
	const harness = createHarness();
	const cwd = mkdtempSync(join(tmpdir(), "catui-evolution-project-gate-"));
	try {
		writeProjectEvalCorpus(cwd);
		await evolutionExtension(harness.api);
		const refineTool = harness.tools.get("evolution_refine");
		assert.ok(refineTool, "Expected evolution_refine to be registered.");
		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-project-gate", getEntries: () => [] },
			cwd,
		} as unknown as ExtensionCommandContext;

		const promoted = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				kind: "memory",
				title: "Project gate lesson",
				content: "Project-specific self-evolution changes must pass the local project regression corpus.",
				applicability: "Self-evolution in this project workspace.",
				autoPromote: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(promoted.content[0]?.type === "text" ? promoted.content[0].text : "", /promoted/);
		const root = getEvolutionScopeRoot(harness.agentDir, { scope: "session", sessionId: "session-project-gate" });
		const revisionId = inspectEvolution(root).current?.revisionId;
		const revision = inspectEvolution(root).revisions.find((item) => item.id === revisionId);
		assert.equal(revision?.gateReport?.name, "project-harness-eval");
		assert.equal(revision?.gateReport?.passed, true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		harness.cleanup();
	}
});

test("evolution_refine preserves project stream eval evidence on gate reports", async () => {
	const harness = createHarness();
	const cwd = mkdtempSync(join(tmpdir(), "catui-evolution-project-stream-gate-"));
	try {
		writeProjectStreamEvalCorpus(cwd);
		await evolutionExtension(harness.api);
		const refineTool = harness.tools.get("evolution_refine");
		assert.ok(refineTool, "Expected evolution_refine to be registered.");
		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-project-stream-gate", getEntries: () => [] },
			cwd,
		} as unknown as ExtensionCommandContext;

		const promoted = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				kind: "memory",
				title: "Project stream gate lesson",
				content: "Project-specific self-evolution changes must pass stream regression scenarios.",
				applicability: "Self-evolution in this project workspace.",
				autoPromote: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(promoted.content[0]?.type === "text" ? promoted.content[0].text : "", /promoted/);
		const root = getEvolutionScopeRoot(harness.agentDir, { scope: "session", sessionId: "session-project-stream-gate" });
		const revisionId = inspectEvolution(root).current?.revisionId;
		const revision = inspectEvolution(root).revisions.find((item) => item.id === revisionId);
		assert.equal(revision?.gateReport?.streams?.length, 2);
		assert.equal(revision?.gateReport?.streams?.[0]?.id, "isolated-project-stream");
		assert.equal(revision?.gateReport?.streams?.[1]?.mode, "interleaved");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		harness.cleanup();
	}
});

test("evolution_refine keeps candidates inactive when project eval corpus fails", async () => {
	const harness = createHarness();
	const cwd = mkdtempSync(join(tmpdir(), "catui-evolution-project-gate-fail-"));
	try {
		writeProjectEvalCorpus(cwd, { observedOutput: "sha256:changed" });
		await evolutionExtension(harness.api);
		const refineTool = harness.tools.get("evolution_refine");
		assert.ok(refineTool, "Expected evolution_refine to be registered.");
		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-project-gate-fail", getEntries: () => [] },
			cwd,
		} as unknown as ExtensionCommandContext;

		const blocked = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				kind: "memory",
				title: "Project gate blocked lesson",
				content: "This candidate must not activate when the local project corpus diverges.",
				applicability: "Self-evolution in this project workspace.",
				autoPromote: true,
			},
			undefined,
			undefined,
			ctx,
		);
		const text = blocked.content[0]?.type === "text" ? blocked.content[0].text : "";
		assert.match(text, /eval gate failed/i);
		const root = getEvolutionScopeRoot(harness.agentDir, { scope: "session", sessionId: "session-project-gate-fail" });
		const inspection = inspectEvolution(root);
		assert.equal(inspection.current, undefined);
		assert.equal(inspection.candidates[0]?.status, "proposed");
		assert.equal((inspection.candidates[0]?.evidence?.gateReport as { name?: string; passed?: boolean } | undefined)?.name, "project-harness-eval");
		assert.equal((inspection.candidates[0]?.evidence?.gateReport as { passed?: boolean } | undefined)?.passed, false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		harness.cleanup();
	}
});

test("evolution_refine proposes trace-derived eval fixtures that gate future promotion after approval", async () => {
	const harness = createHarness();
	const cwd = mkdtempSync(join(tmpdir(), "catui-evolution-trace-fixture-"));
	try {
		await evolutionExtension(harness.api);
		const refineTool = harness.tools.get("evolution_refine");
		assert.ok(refineTool, "Expected evolution_refine to be registered.");
		const tracePath = join(cwd, "trace.jsonl");
		writeTraceJsonl(tracePath, minimalTrace());
		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-trace-fixture", getEntries: () => [] },
			cwd,
		} as unknown as ExtensionCommandContext;

		const proposed = await refineTool.execute(
			"tool-call",
			{
				action: "propose_eval_fixture_from_trace",
				scope: "workspace",
				title: "Trace fixture smoke",
				tracePath,
				scenarioId: "trace-smoke",
				observedOutputFingerprint: "sha256:changed",
			},
			undefined,
			undefined,
			ctx,
		);
		const proposedText = proposed.content[0]?.type === "text" ? proposed.content[0].text : "";
		assert.match(proposedText, /eval_fixture/);
		assert.match(proposedText, /inactive until promoted/);
		const workspaceRoot = getEvolutionScopeRoot(harness.agentDir, { scope: "workspace", cwd });
		let inspection = inspectEvolution(workspaceRoot);
		const fixtureCandidate = inspection.candidates[0];
		assert.equal(fixtureCandidate?.artifacts[0]?.kind, "eval_fixture");

		const beforeApproval = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				kind: "memory",
				title: "Before fixture approval",
				content: "This should still pass before the trace-derived fixture is promoted.",
				applicability: "Self-evolution in this project workspace.",
				predictions: [
					{
						id: "prediction-trace-pass",
						metric: "evolved_harness_eval.passRate",
						direction: "stay_at_or_above",
						target: "1.0",
						rationale: "The new memory should not reduce replay pass rate.",
					},
				],
				autoPromote: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(beforeApproval.content[0]?.type === "text" ? beforeApproval.content[0].text : "", /promoted/);
		const promotedRevisionId = (beforeApproval.details as { revisionId?: string }).revisionId ?? "";
		const promotedRevision = inspectEvolution(getEvolutionScopeRoot(harness.agentDir, { scope: "session", sessionId: "session-trace-fixture" }))
			.revisions.find((revision) => revision.id === promotedRevisionId);
		assert.equal(promotedRevision?.predictions?.[0]?.id, "prediction-trace-pass");

		promoteEvolutionCandidate(workspaceRoot, fixtureCandidate?.id ?? "", { approvedBy: "test" });
		const afterApproval = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				kind: "memory",
				title: "After fixture approval",
				content: "This must be blocked by the promoted trace-derived fixture divergence.",
				applicability: "Self-evolution in this project workspace.",
				autoPromote: true,
			},
			undefined,
			undefined,
			ctx,
		);
		const afterText = afterApproval.content[0]?.type === "text" ? afterApproval.content[0].text : "";
		assert.match(afterText, /eval gate failed/i);
		inspection = inspectEvolution(getEvolutionScopeRoot(harness.agentDir, { scope: "session", sessionId: "session-trace-fixture" }));
		const blocked = inspection.candidates.find((candidate) => candidate.summary.includes("After fixture approval"));
		assert.equal(blocked?.status, "proposed");
		assert.equal((blocked?.evidence?.gateReport as { name?: string } | undefined)?.name, "evolved-harness-eval");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		harness.cleanup();
	}
});

test("evolution_refine can propose an eval fixture from the latest workspace trace", async () => {
	const harness = createHarness();
	const cwd = mkdtempSync(join(tmpdir(), "catui-evolution-latest-trace-"));
	try {
		await evolutionExtension(harness.api);
		const refineTool = harness.tools.get("evolution_refine");
		assert.ok(refineTool, "Expected evolution_refine to be registered.");
		const traceDir = join(cwd, ".catui", "traces");
		mkdirSync(traceDir, { recursive: true });
		const olderTrace = join(traceDir, "older.jsonl");
		const latestTrace = join(traceDir, "latest.jsonl");
		writeTraceJsonl(olderTrace, minimalTrace("sha256:older"));
		writeTraceJsonl(latestTrace, minimalTrace("sha256:latest"));
		utimesSync(olderTrace, new Date("2026-08-09T00:00:00.000Z"), new Date("2026-08-09T00:00:00.000Z"));
		utimesSync(latestTrace, new Date("2026-08-09T00:01:00.000Z"), new Date("2026-08-09T00:01:00.000Z"));
		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-latest-trace", getEntries: () => [] },
			cwd,
		} as unknown as ExtensionCommandContext;

		const proposed = await refineTool.execute(
			"tool-call",
			{
				action: "propose_eval_fixture_from_trace",
				scope: "workspace",
				title: "Latest trace fixture",
				tracePath: "latest",
				scenarioId: "latest-trace",
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(proposed.content[0]?.type === "text" ? proposed.content[0].text : "", /eval_fixture/);
		const workspaceRoot = getEvolutionScopeRoot(harness.agentDir, { scope: "workspace", cwd });
		const fixture = inspectEvolution(workspaceRoot).candidates[0]?.artifacts[0];
		assert.equal(fixture?.kind, "eval_fixture");
		const content = JSON.parse(fixture?.content ?? "{}") as { recorded?: RunTraceEventV1[] };
		assert.equal(content.recorded?.at(-1)?.payload.outputFingerprint, "sha256:latest");
		assert.equal(fixture?.metadata?.tracePath, ".catui/traces/latest.jsonl");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		harness.cleanup();
	}
});

test("evolution_refine sweeps workspace traces into deduplicated eval fixture candidates", async () => {
	const harness = createHarness();
	const cwd = mkdtempSync(join(tmpdir(), "catui-evolution-trace-sweep-"));
	try {
		await evolutionExtension(harness.api);
		const refineTool = harness.tools.get("evolution_refine");
		assert.ok(refineTool, "Expected evolution_refine to be registered.");
		const traceDir = join(cwd, ".catui", "traces");
		mkdirSync(traceDir, { recursive: true });
		writeTraceJsonl(join(traceDir, "first.jsonl"), minimalTrace("sha256:first"));
		writeTraceJsonl(join(traceDir, "second.jsonl"), minimalTrace("sha256:second"));
		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-trace-sweep", getEntries: () => [] },
			cwd,
		} as unknown as ExtensionCommandContext;

		const swept = await refineTool.execute(
			"tool-call",
			{
				action: "sweep_workspace_traces",
				scope: "workspace",
				title: "Sweep workspace traces",
				content: "Create eval fixture candidates from recent workspace run traces.",
				maxTraces: 5,
			},
			undefined,
			undefined,
			ctx,
		);
		const sweptText = swept.content[0]?.type === "text" ? swept.content[0].text : "";
		assert.match(sweptText, /created 2 eval_fixture candidate/);
		assert.equal((swept.details as { created?: number }).created, 2);
		const workspaceRoot = getEvolutionScopeRoot(harness.agentDir, { scope: "workspace", cwd });
		assert.equal(inspectEvolution(workspaceRoot).candidates.length, 2);

		const sweptAgain = await refineTool.execute(
			"tool-call",
			{
				action: "sweep_workspace_traces",
				scope: "workspace",
				title: "Sweep workspace traces",
				content: "Create eval fixture candidates from recent workspace run traces.",
				maxTraces: 5,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.equal((sweptAgain.details as { created?: number; skipped?: number }).created, 0);
		assert.equal((sweptAgain.details as { created?: number; skipped?: number }).skipped, 2);
		assert.equal(inspectEvolution(workspaceRoot).candidates.length, 2);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		harness.cleanup();
	}
});

test("evolution_refine can auto-promote session prompt notes and memories for the next turn", async () => {
	const harness = createHarness();
	try {
		await evolutionExtension(harness.api);
		const refineTool = harness.tools.get("evolution_refine");
		assert.ok(refineTool, "Expected evolution_refine to be registered.");

		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-self-tune", getEntries: () => [] },
			cwd: process.cwd(),
		} as unknown as ExtensionCommandContext;

		const created = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				kind: "prompt_note",
				title: "Ask for evidence before broad rewrites",
				content: "Before proposing a broad rewrite, identify the smallest failing evidence and one narrower repair path.",
				applicability: "Architecture or refactor tasks with unclear blast radius.",
				autoPromote: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(created.content[0]?.type === "text" ? created.content[0].text : "", /promoted/);

		const beforeAgentStart = harness.handlers.get("before_agent_start")?.[0] as BeforeAgentStartHandler;
		const injected = await beforeAgentStart(
			{ type: "before_agent_start", prompt: "continue", systemPrompt: "base" },
			ctx,
		);
		assert.match(injected?.appendSystemPrompt ?? "", /Ask for evidence before broad rewrites/);
		assert.match(injected?.appendSystemPrompt ?? "", /smallest failing evidence/);

		const memory = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				kind: "memory",
				title: "User prefers ambitious autonomy",
				content: "The user prefers Catui to take more autonomous initiative when the change remains reversible and non-executable.",
				autoPromote: true,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(memory.content[0]?.type === "text" ? memory.content[0].text : "", /promoted/);
		const reinjected = await beforeAgentStart(
			{ type: "before_agent_start", prompt: "continue", systemPrompt: "base" },
			ctx,
		);
		assert.match(reinjected?.appendSystemPrompt ?? "", /User prefers ambitious autonomy/);
	} finally {
		harness.cleanup();
	}
});

test("evolution_refine can auto-promote workspace artifacts across sessions and propose global artifacts", async () => {
	const harness = createHarness();
	try {
		await evolutionExtension(harness.api);
		const refineTool = harness.tools.get("evolution_refine");
		assert.ok(refineTool, "Expected evolution_refine to be registered.");

		const firstSession = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "workspace-session-a", getEntries: () => [] },
			cwd: process.cwd(),
		} as unknown as ExtensionCommandContext;
		const secondSession = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "workspace-session-b", getEntries: () => [] },
			cwd: process.cwd(),
		} as unknown as ExtensionCommandContext;

		const created = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				scope: "workspace",
				kind: "memory",
				title: "Catui repo prefers extension ownership",
				content: "In this workspace, new user-visible capabilities should default to optional or builtin extensions rather than core runtime branches.",
				autoPromote: true,
			},
			undefined,
			undefined,
			firstSession,
		);
		assert.match(created.content[0]?.type === "text" ? created.content[0].text : "", /workspace/);
		assert.match(created.content[0]?.type === "text" ? created.content[0].text : "", /promoted/);

		const beforeAgentStart = harness.handlers.get("before_agent_start")?.[0] as BeforeAgentStartHandler;
		const injected = await beforeAgentStart(
			{ type: "before_agent_start", prompt: "continue", systemPrompt: "base" },
			secondSession,
		);
		assert.match(injected?.appendSystemPrompt ?? "", /Catui repo prefers extension ownership/);

		const globalCandidate = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				scope: "global",
				kind: "memory",
				title: "Global preference",
				content: "Across projects, prefer small reversible self-evolution artifacts before executable changes.",
				autoPromote: false,
			},
			undefined,
			undefined,
			firstSession,
		);
		const globalText = globalCandidate.content[0]?.type === "text" ? globalCandidate.content[0].text : "";
		assert.match(globalText, /global/);
		assert.match(globalText, /inactive until promoted/);

		const globalAutoPromote = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				scope: "global",
				kind: "memory",
				title: "Prefer reversible global lessons",
				content: "Across projects, prefer reversible self-evolution artifacts before executable changes.",
				applicability: "Catui self-evolution tasks with cross-project behavioral lessons.",
				autoPromote: true,
			},
			undefined,
			undefined,
			firstSession,
		);
		assert.match(globalAutoPromote.content[0]?.type === "text" ? globalAutoPromote.content[0].text : "", /global/);
		assert.match(globalAutoPromote.content[0]?.type === "text" ? globalAutoPromote.content[0].text : "", /promoted/);

		const globalRoot = getEvolutionScopeRoot(harness.agentDir, { scope: "global" });
		assert.match(inspectEvolution(globalRoot).current?.revisionId ?? "", /revision-/);

		const globalToolSpec = await refineTool.execute(
			"tool-call",
			{
				action: "create_artifact",
				scope: "global",
				kind: "tool_spec",
				title: "Global tool candidate",
				content: "Inspect the local failure evidence and summarize a reusable procedure.",
				applicability: "Debugging tasks with repeatable local failures.",
				nonApplicability: "Tasks requiring package installation, source patch generation, or network endpoints.",
				autoPromote: true,
			},
			undefined,
			undefined,
			firstSession,
		);
		const globalToolText = globalToolSpec.content[0]?.type === "text" ? globalToolSpec.content[0].text : "";
		assert.match(globalToolText, /created/);
		assert.match(globalToolText, /promoted/);

		const evolvedTool = harness.tools.get("evolved_tool");
		assert.ok(evolvedTool, "Expected evolved_tool to be registered.");
		const listed = await evolvedTool.execute("tool-call", { action: "list" }, undefined, undefined, secondSession);
		assert.match(listed.content[0]?.type === "text" ? listed.content[0].text : "", /Global tool candidate/);
	} finally {
		harness.cleanup();
	}
});

test("evolution auto-observer creates a session candidate from turn-end reusable lessons with cooldown", async () => {
	const harness = createHarness();
	try {
		await evolutionExtension(harness.api);
		const turnEnd = harness.handlers.get("turn_end")?.[0] as (
			event: {
				type: "turn_end";
				turnIndex: number;
				message: { role: string; content: string };
				toolResults: unknown[];
			},
			ctx: ExtensionCommandContext,
		) => Promise<void> | void;
		assert.ok(turnEnd, "Expected turn_end auto-observer to be registered.");

		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-auto", getEntries: () => [] },
			cwd: process.cwd(),
		} as unknown as ExtensionCommandContext;
		await turnEnd(
			{
				type: "turn_end",
				turnIndex: 1,
				message: {
					role: "assistant",
					content:
						"Reusable lesson: When a regression is localized, write the focused failing test before broad verification.",
				},
				toolResults: [],
			},
			ctx,
		);

		const root = getEvolutionScopeRoot(harness.agentDir, { scope: "session", sessionId: "session-auto" });
		let candidates = inspectEvolution(root).candidates;
		assert.equal(candidates.length, 1);
		assert.equal(candidates[0]?.status, "proposed");
		assert.equal(candidates[0]?.artifacts[0]?.kind, "memory");
		assert.match(candidates[0]?.artifacts[0]?.content ?? "", /focused failing test/);

		await turnEnd(
			{
				type: "turn_end",
				turnIndex: 2,
				message: {
					role: "assistant",
					content:
						"Reusable lesson: When another localized regression appears, preserve the same focused-test first strategy.",
				},
				toolResults: [],
			},
			ctx,
		);
		candidates = inspectEvolution(root).candidates;
		assert.equal(candidates.length, 1, "Cooldown should suppress consecutive auto candidates.");
	} finally {
		harness.cleanup();
	}
});

test("evolution auto-observer consumes structured turn-end proposals with scope and promotion gates", async () => {
	const harness = createHarness();
	try {
		await evolutionExtension(harness.api);
		const turnEnd = harness.handlers.get("turn_end")?.[0] as (
			event: {
				type: "turn_end";
				turnIndex: number;
				message: { role: string; content: string };
				toolResults: unknown[];
			},
			ctx: ExtensionCommandContext,
		) => Promise<void> | void;
		assert.ok(turnEnd, "Expected turn_end auto-observer to be registered.");

		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-structured", getEntries: () => [] },
			cwd: process.cwd(),
		} as unknown as ExtensionCommandContext;

		await turnEnd(
			{
				type: "turn_end",
				turnIndex: 10,
				message: {
					role: "assistant",
					content: [
						"```json",
						JSON.stringify({
							catui_evolution: {
								scope: "workspace",
								kind: "prompt_note",
								title: "Prefer extension-owned learning",
								content: "When improving Catui learning behavior, keep product policy in the evolution extension.",
								applicability: "Catui self-evolution changes.",
								autoPromote: true,
							},
						}),
						"```",
					].join("\n"),
				},
				toolResults: [],
			},
			ctx,
		);
		const workspaceRoot = getEvolutionScopeRoot(harness.agentDir, { scope: "workspace", cwd: process.cwd() });
		assert.match(inspectEvolution(workspaceRoot).current?.revisionId ?? "", /revision-/);
		const beforeAgentStart = harness.handlers.get("before_agent_start")?.[0] as BeforeAgentStartHandler;
		const injected = await beforeAgentStart(
			{ type: "before_agent_start", prompt: "continue", systemPrompt: "base" },
			ctx,
		);
		assert.match(injected?.appendSystemPrompt ?? "", /Prefer extension-owned learning/);

		await turnEnd(
			{
				type: "turn_end",
				turnIndex: 20,
				message: {
					role: "assistant",
					content: [
						"```json",
						JSON.stringify({
							catui_evolution: {
								scope: "global",
								kind: "memory",
								title: "Global low risk lesson",
								content: "Across projects, prefer reversible harness artifacts before executable changes.",
								applicability: "Catui harness self-evolution tasks.",
								autoPromote: true,
							},
						}),
						"```",
					].join("\n"),
				},
				toolResults: [],
			},
			ctx,
		);
		const globalRoot = getEvolutionScopeRoot(harness.agentDir, { scope: "global" });
		const globalInspection = inspectEvolution(globalRoot);
		assert.equal(globalInspection.candidates.length, 1);
		assert.match(globalInspection.current?.revisionId ?? "", /revision-/);
		assert.equal(globalInspection.candidates[0]?.status, "promoted");
	} finally {
		harness.cleanup();
	}
});

test("evolution auto-observer auto-promotes latest-trace eval fixtures after gate checks", async () => {
	const harness = createHarness();
	const cwd = mkdtempSync(join(tmpdir(), "catui-evolution-turn-fixture-"));
	try {
		await evolutionExtension(harness.api);
		const traceDir = join(cwd, ".catui", "traces");
		mkdirSync(traceDir, { recursive: true });
		const latestTrace = join(traceDir, "latest.jsonl");
		writeTraceJsonl(latestTrace, minimalTrace("sha256:turn-latest"));
		const turnEnd = harness.handlers.get("turn_end")?.[0] as (
			event: {
				type: "turn_end";
				turnIndex: number;
				message: { role: string; content: string };
				toolResults: unknown[];
			},
			ctx: ExtensionCommandContext,
		) => Promise<void> | void;
		assert.ok(turnEnd, "Expected turn_end auto-observer to be registered.");
		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-turn-fixture", getEntries: () => [] },
			cwd,
		} as unknown as ExtensionCommandContext;

		await turnEnd(
			{
				type: "turn_end",
				turnIndex: 30,
				message: {
					role: "assistant",
					content: [
						"```json",
						JSON.stringify({
							catui_evolution: {
								scope: "workspace",
								kind: "eval_fixture",
								title: "Turn-end latest trace fixture",
								tracePath: "latest",
								scenarioId: "turn-latest",
								autoPromote: true,
							},
						}),
						"```",
					].join("\n"),
				},
				toolResults: [],
			},
			ctx,
		);

		const workspaceRoot = getEvolutionScopeRoot(harness.agentDir, { scope: "workspace", cwd });
		const inspection = inspectEvolution(workspaceRoot);
		assert.equal(inspection.candidates.length, 1);
		assert.equal(inspection.candidates[0]?.status, "promoted");
		assert.match(inspection.current?.revisionId ?? "", /revision-/);
		const fixture = inspection.candidates[0]?.artifacts[0];
		assert.equal(fixture?.kind, "eval_fixture");
		const content = JSON.parse(fixture?.content ?? "{}") as { recorded?: RunTraceEventV1[] };
		assert.equal(content.recorded?.at(-1)?.payload.outputFingerprint, "sha256:turn-latest");
		assert.equal(fixture?.metadata?.tracePath, ".catui/traces/latest.jsonl");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		harness.cleanup();
	}
});

test("evolution auto-observer keeps divergent eval fixtures inactive", async () => {
	const harness = createHarness();
	const cwd = mkdtempSync(join(tmpdir(), "catui-evolution-turn-fixture-diverge-"));
	try {
		await evolutionExtension(harness.api);
		const traceDir = join(cwd, ".catui", "traces");
		mkdirSync(traceDir, { recursive: true });
		writeTraceJsonl(join(traceDir, "latest.jsonl"), minimalTrace("sha256:turn-latest"));
		const turnEnd = harness.handlers.get("turn_end")?.[0] as (
			event: {
				type: "turn_end";
				turnIndex: number;
				message: { role: string; content: string };
				toolResults: unknown[];
			},
			ctx: ExtensionCommandContext,
		) => Promise<void> | void;
		assert.ok(turnEnd, "Expected turn_end auto-observer to be registered.");
		const ctx = {
			agentDir: harness.agentDir,
			sessionManager: { getSessionId: () => "session-turn-fixture-diverge", getEntries: () => [] },
			cwd,
		} as unknown as ExtensionCommandContext;

		await turnEnd(
			{
				type: "turn_end",
				turnIndex: 31,
				message: {
					role: "assistant",
					content: [
						"```json",
						JSON.stringify({
							catui_evolution: {
								scope: "workspace",
								kind: "eval_fixture",
								title: "Divergent turn fixture",
								tracePath: "latest",
								scenarioId: "turn-diverge",
								observedOutputFingerprint: "sha256:changed",
								autoPromote: true,
							},
						}),
						"```",
					].join("\n"),
				},
				toolResults: [],
			},
			ctx,
		);

		const workspaceRoot = getEvolutionScopeRoot(harness.agentDir, { scope: "workspace", cwd });
		const inspection = inspectEvolution(workspaceRoot);
		assert.equal(inspection.current, undefined);
		assert.equal(inspection.candidates.length, 1);
		assert.equal(inspection.candidates[0]?.status, "proposed");
		assert.equal((inspection.candidates[0]?.evidence?.gateReport as { name?: string; passed?: boolean } | undefined)?.name, "candidate-eval-fixture");
		assert.equal((inspection.candidates[0]?.evidence?.gateReport as { passed?: boolean } | undefined)?.passed, false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		harness.cleanup();
	}
});
