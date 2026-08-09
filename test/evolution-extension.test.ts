/**
 * [WHO]: Opt-in evolution extension command and promoted-resource integration tests
 * [FROM]: Depends on node:test/assert/fs/os/path, extension host types, and evolution extension/store
 * [TO]: Guards manual proposal safety, inactive candidates, active prompt loading, and rollback reload
 * [HERE]: test/evolution-extension.test.ts - user-facing self-evolution vertical slice coverage
 */
import assert from "node:assert/strict";
import { mkdtemp, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../core/extensions-host/types.ts";
import evolutionExtension from "../extensions/optional/evolution/index.ts";
import { EvolutionStore } from "../extensions/optional/evolution/store.ts";
import { loadSkillsFromDir } from "../core/skills.ts";
import type { EvolutionProposal } from "../extensions/optional/evolution/types.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type Command = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

async function waitFor(check: () => boolean | Promise<boolean>, message: string): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${message}`);
}

async function harness(): Promise<{
	api: ExtensionAPI;
	agentDir: string;
	cwd: string;
	handlers: Map<string, Handler[]>;
	commands: Map<string, Command>;
}> {
	const root = await mkdtemp(join(tmpdir(), "catui-evolution-extension-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "workspace");
	await import("node:fs/promises").then(({ mkdir }) => mkdir(cwd, { recursive: true }));
	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, Command>();
	const api = {
		agentDir,
		cwd,
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand(name: string, options: { handler: Command }) {
			commands.set(name, options.handler);
		},
	} as unknown as ExtensionAPI;
	await evolutionExtension(api);
	return { api, agentDir, cwd, handlers, commands };
}

function proposal(id: string, baselineRevisionId: string | null, content: string): EvolutionProposal {
	return {
		schemaVersion: 1,
		id,
		scope: "workspace",
		baselineRevisionId,
		summary: "Persist a verified convention",
		expectedOutcome: "Completion claims include verification evidence",
		createdAt: "2026-08-09T00:00:00.000Z",
		provenance: { trigger: "manual", sessionId: "session-1", traceRefs: ["session:entry:1"] },
		artifacts: [{
			schemaVersion: 1,
			id: `evolved:prompt_note:${id}`,
			kind: "prompt_note",
			title: "Verification convention",
			content,
			scope: "workspace",
			version: 1,
			createdAt: "2026-08-09T00:00:00.000Z",
			applicability: ["Completion work"],
			nonApplicability: ["Concept-only answers"],
			promptTokenBudget: 80,
			dependencies: [],
			expectedOutcome: "Verification is reported",
			provenance: { sourceCandidateId: id, trigger: "manual", traceRefs: ["session:entry:1"] },
		}],
	};
}

async function writePassingEvidence(store: EvolutionStore, candidateId: string): Promise<void> {
	for (const item of [
		{ gate: "static", details: {} },
		{ gate: "replay", details: { lifecyclePreserved: true, toolPairsPreserved: true, policyPreserved: true, harnessEvalPassed: true } },
		{ gate: "eval", details: { matchedScenarios: ["verify-completion"], nonInferior: true, improvement: true } },
	] as const) {
		await store.writeEvidence("workspace", candidateId, {
			schemaVersion: 1,
			gate: item.gate,
			passed: true,
			createdAt: "2026-08-09T00:01:00.000Z",
			summary: `${item.gate} passed`,
			details: item.details,
		});
	}
}

async function promoteGuardedBaseline(store: EvolutionStore): Promise<EvolutionProposal> {
	const baseline = proposal("guarded-baseline", null, "Cite exact verification output before completion claims.");
	baseline.artifacts.push({
		...baseline.artifacts[0]!,
		id: "evolved:memory:retained-baseline",
		kind: "memory",
		title: "Retained baseline memory",
		content: "Keep this unrelated champion behavior.",
	});
	await store.createCandidate("workspace", baseline);
	await writePassingEvidence(store, "guarded-baseline");
	await store.promote("workspace", "guarded-baseline");
	return baseline;
}

function context(options: {
	completeJson?: ExtensionCommandContext["completeJson"];
	notifications?: string[];
	reloads?: { count: number };
	reloadError?: Error;
	lastRunTrace?: readonly unknown[];
	entries?: readonly unknown[];
	replayResult?: { ok: true; summary: { runId: string; stopReason: string; turnCount: number; toolCallCount: number; checkpointCount: number } } | { ok: false; divergence: { message: string } };
	harnessEval?: { passed: boolean; scenarioIds: string[]; metrics: { passRate: number; replayDivergences: number; policyViolations: number; unpairedToolCalls: number } };
} = {}): ExtensionCommandContext {
	const notifications = options.notifications ?? [];
	const reloads = options.reloads ?? { count: 0 };
	return {
		cwd: "/Users/alice/private-workspace",
		agentDir: "/Users/alice/.catui/agents/default",
		hasUI: true,
		ui: { notify(message: string) { notifications.push(message); } },
		sessionManager: {
			getSessionId: () => "session-1",
			getEntries: () => options.entries ?? [{
				type: "message",
				id: "entry-1",
				parentId: null,
				timestamp: "2026-08-09T00:00:00.000Z",
				message: { role: "user", content: "Use API_KEY=secret-value in /Users/alice/private-workspace. This is a concept-only answer." },
			}],
		} as never,
		completeJson: options.completeJson,
		getLastRunTrace: () => options.lastRunTrace,
		replayRunTrace: () => options.replayResult ?? {
			ok: true,
			summary: { runId: "run-1", stopReason: "stop", turnCount: 1, toolCallCount: 0, checkpointCount: 0 },
		},
		runHarnessEval: async () => options.harnessEval ?? {
			passed: true,
			scenarioIds: ["policy-ordering", "approval-checkpoint"],
			metrics: { passRate: 1, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
		},
		async reload() { reloads.count += 1; if (options.reloadError) throw options.reloadError; },
	} as unknown as ExtensionCommandContext;
}

test("registers a single refine command and lifecycle consumers", async () => {
	const { commands, handlers } = await harness();
	assert.ok(commands.has("refine"));
	assert.ok(handlers.has("before_agent_start"));
	assert.ok(handlers.has("resources_discover"));
	assert.ok(handlers.has("turn_end"));
	assert.ok(handlers.has("agent_end"));
	assert.ok(handlers.has("session_compact"));
	assert.ok(handlers.has("session_shutdown"));
});

test("automation mode rejects unattended global scope", async () => {
	const { commands, agentDir, cwd } = await harness();
	const notifications: string[] = [];
	const ctx = context({ notifications });
	ctx.agentDir = agentDir;
	ctx.cwd = cwd;
	await commands.get("refine")!("mode guarded --scope global", ctx);
	assert.match(notifications.join(" "), /automatic global evolution is prohibited/i);
});

test("manual refine redacts bounded evidence and persists an inactive statically validated candidate", async () => {
	const { commands, agentDir, cwd } = await harness();
	const notifications: string[] = [];
	let capturedPrompt = "";
	const ctx = context({
		notifications,
		completeJson: async (_system, user) => {
			capturedPrompt = user;
			return JSON.stringify({
				summary: "Remember verification",
				expectedOutcome: "Verification appears before completion",
				artifacts: [{
					id: "verify-before-completion",
					kind: "prompt_note",
					title: "Verify before completion",
					content: "Run repository verification before completion claims.",
					applicability: ["Completion claims"],
					nonApplicability: ["Conceptual answers"],
					promptTokenBudget: 80,
					dependencies: [],
					expectedOutcome: "Verification evidence is included",
				}],
			});
		},
	});
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;
	await commands.get("refine")!("--scope workspace", ctx);
	await commands.get("refine")!("status --scope workspace", ctx);
	assert.doesNotMatch(capturedPrompt, /secret-value|\/Users\/alice/);
	assert.match(capturedPrompt, /\[REDACTED_SECRET\]|\[REDACTED_PATH\]/);
	assert.match(notifications.join(" "), /statically validated/i);
	assert.match(notifications.join(" "), /inactive/i);
	assert.match(notifications.join(" "), /1 pending, 0 quarantined/i);
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	assert.equal(await store.getCurrent("workspace"), undefined);
});

test("before-agent hook loads only promoted prompt and memory artifacts", async () => {
	const { handlers, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	await store.createCandidate("workspace", proposal("active", null, "Always run verify:all before completion."));
	await writePassingEvidence(store, "active");
	await store.promote("workspace", "active");
	await store.createCandidate("workspace", proposal("inactive", (await store.getCurrent("workspace"))!.revisionId, "Never inject this candidate."));
	const before = handlers.get("before_agent_start")![0]!;
	const result = await before(
		{ type: "before_agent_start", prompt: "Completion work: Finish", systemPrompt: "base" },
		{ ...context(), cwd, agentDir } as ExtensionContext,
	) as { appendSystemPrompt?: string };
	assert.match(result.appendSystemPrompt ?? "", /Always run verify:all/);
	assert.doesNotMatch(result.appendSystemPrompt ?? "", /Never inject/);
	const excluded = await before(
		{ type: "before_agent_start", prompt: "Concept-only answers for Completion work", systemPrompt: "base" },
		{ ...context(), cwd, agentDir } as ExtensionContext,
	);
	assert.equal(excluded, undefined);
});

test("before-agent hook enforces one aggregate evolved-context budget", async () => {
	const { handlers, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	const input = proposal("budget", null, "A".repeat(10_000));
	input.artifacts[0]!.promptTokenBudget = 4_096;
	input.artifacts.push({
		...input.artifacts[0]!,
		id: "evolved:memory:budget-tail",
		kind: "memory",
		content: `${"B".repeat(9_990)}BUDGET_TAIL`,
	});
	await store.createCandidate("workspace", input);
	await writePassingEvidence(store, "budget");
	await store.promote("workspace", "budget");
	const result = await handlers.get("before_agent_start")![0]!(
		{ type: "before_agent_start", prompt: "Completion work", systemPrompt: "base" },
		{ ...context(), cwd, agentDir } as ExtensionContext,
	) as { appendSystemPrompt?: string };
	assert.doesNotMatch(result.appendSystemPrompt ?? "", /BUDGET_TAIL/);
	assert.ok(Buffer.byteLength(result.appendSystemPrompt ?? "", "utf8") <= 4_096);
});

test("before-agent hook exposes promoted subagent and tool specifications as non-executable planning context", async () => {
	const { handlers, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	const input = proposal("planning-catalog", null, "Retain the verified memory facet.");
	input.artifacts.push(
		{
			...input.artifacts[0]!,
			id: "evolved:subagent_spec:release-auditor",
			kind: "subagent_spec",
			title: "Release auditor",
			content: "Delegate release evidence review to a read-only general-purpose agent.",
		},
		{
			...input.artifacts[0]!,
			id: "evolved:tool_spec:trace-diff",
			kind: "tool_spec",
			title: "Trace diff requirement",
			content: "A future tool should compare two redacted semantic trace summaries.",
		},
	);
	await store.createCandidate("workspace", input);
	await writePassingEvidence(store, "planning-catalog");
	await store.promote("workspace", "planning-catalog");
	const before = handlers.get("before_agent_start")![0]!;
	const result = await before(
		{ type: "before_agent_start", prompt: "Completion work: Plan the release", systemPrompt: "base" },
		{ ...context(), cwd, agentDir } as ExtensionContext,
	) as { appendSystemPrompt?: string };
	assert.match(result.appendSystemPrompt ?? "", /Evolved Delegation Catalog/);
	assert.match(result.appendSystemPrompt ?? "", /read-only general-purpose agent/);
	assert.match(result.appendSystemPrompt ?? "", /Evolved Tool Design Backlog/);
	assert.match(result.appendSystemPrompt ?? "", /future tool should compare/i);
	assert.match(result.appendSystemPrompt ?? "", /planning-only.*not registered/i);
});

test("resource discovery exposes promoted skill manifests but never candidates or quarantine", async () => {
	const { handlers, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	const input = proposal("skill", null, "placeholder");
	input.artifacts = [{
		...input.artifacts[0]!,
		id: "evolved:skill_manifest:verify-workflow",
		kind: "skill_manifest",
		title: "Verify workflow",
		content: "Run the repository verification gate and report exact evidence.",
	}];
	await store.createCandidate("workspace", input);
	await writePassingEvidence(store, "skill");
	await store.promote("workspace", "skill");
	const discover = handlers.get("resources_discover")![0]!;
	const result = await discover(
		{ type: "resources_discover", cwd, reason: "startup" },
		{ ...context(), cwd, agentDir, getSkills: () => [] } as ExtensionContext,
	) as { skillPaths?: string[] };
	assert.equal(result.skillPaths?.length, 1);
	assert.match(result.skillPaths![0]!, /revisions/);
	assert.doesNotMatch(result.skillPaths![0]!, /candidates|quarantine/);
	const loaded = loadSkillsFromDir({ dir: result.skillPaths![0]!, source: "evolution-test" });
	assert.deepEqual(loaded.diagnostics, []);
	assert.equal(loaded.skills[0]?.name, "evolved-skill-manifest-verify-workflow");
	const reloaded = await discover(
		{ type: "resources_discover", cwd, reason: "reload" },
		{
			...context(),
			cwd,
			agentDir,
			getSkills: () => [{ ...loaded.skills[0]!, source: "evolution-test" }],
		} as ExtensionContext,
	) as { skillPaths?: string[] };
	assert.deepEqual(reloaded.skillPaths, result.skillPaths);
});

test("rollback switches to an existing revision and reloads resources", async () => {
	const { commands, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	await store.createCandidate("workspace", proposal("first", null, "First revision"));
	await writePassingEvidence(store, "first");
	const first = await store.promote("workspace", "first");
	await store.createCandidate("workspace", proposal("second", first.revisionId, "Second revision"));
	await writePassingEvidence(store, "second");
	await store.promote("workspace", "second");
	const notifications: string[] = [];
	const reloads = { count: 0 };
	const ctx = context({ notifications, reloads });
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;
	await commands.get("refine")!(`rollback ${first.revisionId} --scope workspace`, ctx);
	assert.equal(reloads.count, 1);
	assert.equal((await store.getCurrent("workspace"))?.revisionId, first.revisionId);
	assert.match(notifications.join(" "), /rolled back/i);
});

test("reload failure restores a prior no-active-revision state", async () => {
	const { commands, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	await store.createCandidate("workspace", proposal("orphan", null, "Orphan revision"));
	await writePassingEvidence(store, "orphan");
	const orphan = await store.promote("workspace", "orphan");
	await unlink((await store.scopePaths("workspace")).currentPath);
	const notifications: string[] = [];
	const ctx = context({ notifications, reloadError: new Error("reload broke") });
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;
	await commands.get("refine")!(`rollback ${orphan.revisionId} --scope workspace`, ctx);
	assert.equal(await store.getCurrent("workspace"), undefined);
	assert.match(notifications.join(" "), /restored/i);
});

test("verify records real replay and harness eval evidence before explicit approval promotes", async () => {
	const { commands, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	await store.createCandidate("workspace", proposal("verified", null, "Use verified evidence."));
	await store.writeEvidence("workspace", "verified", {
		schemaVersion: 1,
		gate: "static",
		passed: true,
		createdAt: "2026-08-09T00:01:00.000Z",
		summary: "static passed",
		details: {},
	});
	const notifications: string[] = [];
	const reloads = { count: 0 };
	const ctx = context({ notifications, reloads, lastRunTrace: [{ version: 1, kind: "run.started" }] });
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;

	await commands.get("refine")!("verify verified --scope workspace", ctx);
	assert.equal(await store.getCurrent("workspace"), undefined);
	assert.match(notifications.join(" "), /verified.*pending.*approval/i);

	await commands.get("refine")!("approve verified --scope workspace", ctx);
	assert.equal(reloads.count, 1);
	assert.equal((await store.readActiveManifest("workspace"))?.candidateId, "verified");
	assert.match(notifications.join(" "), /promoted/i);
});

test("verify fails closed without a completed runtime trace", async () => {
	const { commands, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	await store.createCandidate("workspace", proposal("no-trace", null, "Remain inactive."));
	await store.writeEvidence("workspace", "no-trace", {
		schemaVersion: 1,
		gate: "static",
		passed: true,
		createdAt: "2026-08-09T00:01:00.000Z",
		summary: "static passed",
		details: {},
	});
	const notifications: string[] = [];
	const ctx = context({ notifications });
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;

	await commands.get("refine")!("verify no-trace --scope workspace", ctx);
	assert.equal(await store.getCurrent("workspace"), undefined);
	assert.match(notifications.join(" "), /no completed run trace/i);
});

test("verify fails closed before persistence when a runtime trace exceeds its byte budget", async () => {
	const { commands, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	await store.createCandidate("workspace", proposal("large-trace", null, "Remain inactive."));
	await store.writeEvidence("workspace", "large-trace", {
		schemaVersion: 1, gate: "static", passed: true, createdAt: "2026-08-09T00:01:00.000Z",
		summary: "static passed", details: {},
	});
	const notifications: string[] = [];
	const ctx = context({ notifications, lastRunTrace: [{ payload: "x".repeat(512 * 1_024) }] });
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;
	await commands.get("refine")!("verify large-trace --scope workspace", ctx);
	assert.equal(await store.getCurrent("workspace"), undefined);
	assert.match(notifications.join(" "), /trace exceeds the verification byte budget/i);
});

test("reject writes a durable decision that blocks later approval", async () => {
	const { commands, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	await store.createCandidate("workspace", proposal("rejected", null, "Do not activate."));
	await writePassingEvidence(store, "rejected");
	const notifications: string[] = [];
	const ctx = context({ notifications });
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;

	await commands.get("refine")!("reject rejected insufficient-evidence --scope workspace", ctx);
	await commands.get("refine")!("approve rejected --scope workspace", ctx);
	assert.equal(await store.getCurrent("workspace"), undefined);
	assert.match(notifications.join(" "), /rejected/i);
});

test("shadow mode schedules bounded automatic proposals without promotion or hook notifications", async () => {
	const { commands, handlers, agentDir, cwd } = await harness();
	const notifications: string[] = [];
	let calls = 0;
	const ctx = context({
		notifications,
		lastRunTrace: [{ version: 1, kind: "run.started" }],
		completeJson: async (_system, _user, _schema, completionOptions) => {
			calls += 1;
			if (completionOptions?.toolName === "evaluate_harness_candidate") {
				return JSON.stringify({
					matchedScenarios: ["entry-1"],
					baselineScore: 60,
					candidateScore: 75,
					regressions: [],
					improvements: ["Verification evidence becomes explicit"],
					rationale: "The candidate directly addresses the repeated omission.",
				});
			}
			return JSON.stringify({
				summary: "Remember repeated verification",
				expectedOutcome: "Verification evidence is consistently reported",
				artifacts: [{
					id: "shadow-verification",
					kind: "memory",
					title: "Shadow verification signal",
					content: "Report repository verification evidence before completion.",
					applicability: ["Completion work"],
					nonApplicability: ["Concept-only answers"],
					promptTokenBudget: 80,
					dependencies: [],
					expectedOutcome: "Verification evidence is reported",
				}],
			});
		},
	});
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;
	await commands.get("refine")!("mode shadow", ctx);
	const beforeHookNotifications = notifications.length;

	await handlers.get("turn_end")![0]!({ type: "turn_end", turnIndex: 24, message: { role: "assistant", content: [] }, toolResults: [] }, ctx);
	await handlers.get("turn_end")![0]!({ type: "turn_end", turnIndex: 25, message: { role: "assistant", content: [{ type: "text", text: "Verified." }] }, toolResults: [] }, ctx);
	await handlers.get("agent_end")![0]!({ type: "agent_end", messages: [] }, ctx);
	await waitFor(() => calls === 2, "shadow evaluation");
	await handlers.get("session_shutdown")![0]!({ type: "session_shutdown" }, ctx);

	assert.equal(calls, 2);
	assert.equal(notifications.length, beforeHookNotifications);
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	assert.equal(await store.getCurrent("session"), undefined);
});

test("guarded mode promotes only a safety-verified candidate with measured improvement in the selected workspace scope", async () => {
	const { commands, handlers, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	const baseline = await promoteGuardedBaseline(store);
	let calls = 0;
	const ctx = context({
		lastRunTrace: [{ version: 1, kind: "run.started" }],
		entries: [{
			type: "message", id: "entry-1", parentId: null, timestamp: "2026-08-09T00:00:00.000Z",
			message: { role: "user", content: `[evolution-exclude ${baseline.artifacts[0]!.id}] concept-only answer` },
		}],
		completeJson: async (_system, _user, _schema, completionOptions) => {
			calls += 1;
			if (completionOptions?.toolName === "evaluate_harness_candidate") {
				return JSON.stringify({
					matchedScenarios: ["entry-1"], baselineScore: 50, candidateScore: 80,
					regressions: [], improvements: ["The repeated failure is directly mitigated"],
					rationale: "Candidate improves the declared outcome without regressions.",
				});
			}
			return JSON.stringify({
				summary: "Guard completion evidence",
				expectedOutcome: "Verification is reported",
				artifacts: [{
					id: "guarded-verification", kind: "prompt_note", title: "Verification convention",
					content: "Cite exact verification output before completion claims.",
					applicability: ["Completion work"], nonApplicability: ["Concept-only answers", "concept-only answer"],
					promptTokenBudget: 80, dependencies: [], expectedOutcome: "Verification is reported",
					overrides: baseline.artifacts[0]!.id,
				}],
			});
		},
	});
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;
	await commands.get("refine")!("mode guarded --scope workspace", ctx);
	await handlers.get("turn_end")![0]!({ type: "turn_end", turnIndex: 25, message: { role: "assistant", content: [{ type: "text", text: "Done." }] }, toolResults: [] }, ctx);
	await handlers.get("agent_end")![0]!({ type: "agent_end", messages: [] }, ctx);
	await waitFor(async () => (await store.readActiveManifest("workspace"))?.candidateId !== "guarded-baseline", "guarded promotion");
	await handlers.get("session_shutdown")![0]!({ type: "session_shutdown" }, ctx);

	assert.equal(calls, 2);
	const active = await store.readActiveManifest("workspace");
	assert.match(active?.candidateId ?? "", /^candidate_/);
	assert.equal(active?.artifacts.length, 2);
	assert.ok(active?.artifacts.some((artifact) => artifact.id === "evolved:memory:retained-baseline"));
});

test("guarded promotion is cancelled by a mode change, subsequent turn, or non-blocking shutdown", async () => {
	for (const cancellation of ["mode", "new-turn", "shutdown"] as const) {
		const { commands, handlers, agentDir, cwd } = await harness();
		const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
		const baseline = await promoteGuardedBaseline(store);
		let calls = 0;
		let releaseEvaluation!: () => void;
		let evaluationStarted!: () => void;
		const started = new Promise<void>((resolve) => { evaluationStarted = resolve; });
		const release = new Promise<void>((resolve) => { releaseEvaluation = resolve; });
		const ctx = context({
			lastRunTrace: [{ version: 1, kind: "run.started" }],
			entries: [{
				type: "message", id: "entry-1", parentId: null, timestamp: "2026-08-09T00:00:00.000Z",
				message: { role: "user", content: `[evolution-exclude ${baseline.artifacts[0]!.id}] concept-only answer` },
			}],
			completeJson: async (_system, _user, _schema, completionOptions) => {
				calls += 1;
				if (completionOptions?.toolName === "evaluate_harness_candidate") {
					evaluationStarted();
					await release;
					return JSON.stringify({
						matchedScenarios: ["entry-1"], baselineScore: 50, candidateScore: 80,
						regressions: [], improvements: ["Refined applicability"], rationale: "Scenario-backed.",
					});
				}
				return JSON.stringify({
					summary: "Refine negative applicability", expectedOutcome: "Verification is reported",
					artifacts: [{
						id: `guarded-${cancellation}`, kind: "prompt_note", title: "Verification convention",
						content: "Cite exact verification output before completion claims.",
						applicability: ["Completion work"], nonApplicability: ["Concept-only answers", "concept-only answer"],
						promptTokenBudget: 80, dependencies: [], expectedOutcome: "Verification is reported",
						overrides: baseline.artifacts[0]!.id,
					}],
				});
			},
		});
		ctx.cwd = cwd;
		ctx.agentDir = agentDir;
		await commands.get("refine")!("mode guarded --scope workspace", ctx);
		await handlers.get("turn_end")![0]!({ type: "turn_end", turnIndex: 25, message: { role: "assistant", content: [] }, toolResults: [] }, ctx);
		await handlers.get("agent_end")![0]!({ type: "agent_end", messages: [] }, ctx);
		await started;
		if (cancellation === "mode") await commands.get("refine")!("mode manual --scope workspace", ctx);
		else if (cancellation === "new-turn") await handlers.get("before_agent_start")![0]!({ type: "before_agent_start", prompt: "Completion work", systemPrompt: "base" }, ctx);
		else await handlers.get("session_shutdown")![0]!({ type: "session_shutdown" }, ctx);
		releaseEvaluation();
		await waitFor(() => calls === 2, `${cancellation} cancellation`);
		await new Promise((resolve) => setTimeout(resolve, 25));
		assert.equal((await store.readActiveManifest("workspace"))?.candidateId, "guarded-baseline");
		if (cancellation !== "shutdown") await handlers.get("session_shutdown")![0]!({ type: "session_shutdown" }, ctx);
	}
});

test("guarded mode keeps candidates inactive when deterministic harness safety fails", async () => {
	const { commands, handlers, agentDir, cwd } = await harness();
	let calls = 0;
	const ctx = context({
		lastRunTrace: [{ version: 1, kind: "run.started" }],
		harnessEval: {
			passed: false,
			scenarioIds: ["policy-ordering"],
			metrics: { passRate: 0, replayDivergences: 0, policyViolations: 1, unpairedToolCalls: 0 },
		},
		completeJson: async () => {
			calls += 1;
			return JSON.stringify({
				summary: "Unsafe candidate", expectedOutcome: "Should remain inactive",
				artifacts: [{
					id: "unsafe", kind: "memory", title: "Unsafe", content: "Remember the failure.",
					applicability: ["Tests"], nonApplicability: ["Other"], promptTokenBudget: 40,
					dependencies: [], expectedOutcome: "No activation",
				}],
			});
		},
	});
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;
	await commands.get("refine")!("mode guarded", ctx);
	await handlers.get("turn_end")![0]!({ type: "turn_end", turnIndex: 25, message: { role: "assistant", content: [] }, toolResults: [] }, ctx);
	await handlers.get("agent_end")![0]!({ type: "agent_end", messages: [] }, ctx);
	await waitFor(() => calls === 1, "failed safety review");
	await handlers.get("session_shutdown")![0]!({ type: "session_shutdown" }, ctx);
	assert.equal(calls, 1);
	assert.equal(await new EvolutionStore({ agentDir, cwd, sessionId: "session-1" }).getCurrent("session"), undefined);
});

test("guarded mode rejects evaluations that cite evidence outside the bounded session", async () => {
	const { commands, handlers, agentDir, cwd } = await harness();
	let calls = 0;
	const ctx = context({
		lastRunTrace: [{ version: 1, kind: "run.started" }],
		completeJson: async (_system, _user, _schema, completionOptions) => {
			calls += 1;
			return completionOptions?.toolName === "evaluate_harness_candidate" ? JSON.stringify({
				matchedScenarios: ["invented-scenario"], baselineScore: 50, candidateScore: 90,
				regressions: [], improvements: ["Unsupported claim"], rationale: "Not grounded.",
			})
			: JSON.stringify({
				summary: "Ungrounded candidate", expectedOutcome: "Should remain inactive",
				artifacts: [{
					id: "ungrounded", kind: "prompt_note", title: "Ungrounded", content: "Claim improvement.",
					applicability: ["Tests"], nonApplicability: ["Other"], promptTokenBudget: 40,
					dependencies: [], expectedOutcome: "No activation",
				}],
			});
		},
	});
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;
	await commands.get("refine")!("mode guarded", ctx);
	await handlers.get("turn_end")![0]!({ type: "turn_end", turnIndex: 25, message: { role: "assistant", content: [] }, toolResults: [] }, ctx);
	await handlers.get("agent_end")![0]!({ type: "agent_end", messages: [] }, ctx);
	await waitFor(() => calls === 2, "ungrounded evaluation rejection");
	await handlers.get("session_shutdown")![0]!({ type: "session_shutdown" }, ctx);
	assert.equal(await new EvolutionStore({ agentDir, cwd, sessionId: "session-1" }).getCurrent("session"), undefined);
});

test("guarded mode treats model scores as advisory and cannot self-authorize new behavior", async () => {
	const { commands, handlers, agentDir, cwd } = await harness();
	let calls = 0;
	const ctx = context({
		lastRunTrace: [{ version: 1, kind: "run.started" }],
		completeJson: async (_system, _user, _schema, completionOptions) => {
			calls += 1;
			return completionOptions?.toolName === "evaluate_harness_candidate"
				? JSON.stringify({
					matchedScenarios: ["entry-1"], baselineScore: 0, candidateScore: 100,
					regressions: [], improvements: ["Self-reported perfection"], rationale: "The model approves itself.",
				})
				: JSON.stringify({
					summary: "New self-approved behavior", expectedOutcome: "Remain inactive",
					artifacts: [{
						id: "self-approved", kind: "prompt_note", title: "Self approved",
						content: "Adopt new behavior.", applicability: ["Completion work"],
						nonApplicability: ["Concept-only answers"], promptTokenBudget: 40,
						dependencies: [], expectedOutcome: "New behavior",
					}],
				});
		},
	});
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;
	await commands.get("refine")!("mode guarded", ctx);
	await handlers.get("turn_end")![0]!({ type: "turn_end", turnIndex: 25, message: { role: "assistant", content: [] }, toolResults: [] }, ctx);
	await handlers.get("agent_end")![0]!({ type: "agent_end", messages: [] }, ctx);
	await waitFor(() => calls === 2, "advisory self-evaluation");
	await handlers.get("session_shutdown")![0]!({ type: "session_shutdown" }, ctx);
	assert.equal(await new EvolutionStore({ agentDir, cwd, sessionId: "session-1" }).getCurrent("session"), undefined);
});

test("guarded mode rejects user exclusions that overlap an artifact applicability contract", async () => {
	const { commands, handlers, agentDir, cwd } = await harness();
	const store = new EvolutionStore({ agentDir, cwd, sessionId: "session-1" });
	const baseline = await promoteGuardedBaseline(store);
	let calls = 0;
	const ctx = context({
		lastRunTrace: [{ version: 1, kind: "run.started" }],
		entries: [{
			type: "message", id: "entry-1", parentId: null, timestamp: "2026-08-09T00:00:00.000Z",
			message: { role: "user", content: `[evolution-exclude ${baseline.artifacts[0]!.id}] Completion work` },
		}],
		completeJson: async (_system, _user, _schema, completionOptions) => {
			calls += 1;
			return completionOptions?.toolName === "evaluate_harness_candidate"
				? JSON.stringify({
					matchedScenarios: ["entry-1"], baselineScore: 50, candidateScore: 80,
					regressions: [], improvements: ["Over-broad exclusion"], rationale: "Advisory only.",
				})
				: JSON.stringify({
					summary: "Unsafe exclusion", expectedOutcome: "Verification is reported",
					artifacts: [{
						id: "overlapping-exclusion", kind: "prompt_note", title: "Verification convention",
						content: "Cite exact verification output before completion claims.",
						applicability: ["Completion work"], nonApplicability: ["Concept-only answers", "Completion work"],
						promptTokenBudget: 80, dependencies: [], expectedOutcome: "Verification is reported",
						overrides: baseline.artifacts[0]!.id,
					}],
				});
		},
	});
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;
	await commands.get("refine")!("mode guarded --scope workspace", ctx);
	await handlers.get("turn_end")![0]!({ type: "turn_end", turnIndex: 25, message: { role: "assistant", content: [] }, toolResults: [] }, ctx);
	await handlers.get("agent_end")![0]!({ type: "agent_end", messages: [] }, ctx);
	await waitFor(() => calls === 2, "overlapping exclusion rejection");
	await handlers.get("session_shutdown")![0]!({ type: "session_shutdown" }, ctx);
	assert.equal((await store.readActiveManifest("workspace"))?.candidateId, "guarded-baseline");
});

test("guarded mode never auto-promotes generated skill resources", async () => {
	const { commands, handlers, agentDir, cwd } = await harness();
	let calls = 0;
	const ctx = context({
		lastRunTrace: [{ version: 1, kind: "run.started" }],
		completeJson: async (_system, _user, _schema, completionOptions) => {
			calls += 1;
			return completionOptions?.toolName === "evaluate_harness_candidate" ? JSON.stringify({
				matchedScenarios: ["entry-1"], baselineScore: 50, candidateScore: 90,
				regressions: [], improvements: ["Workflow is reusable"], rationale: "Scenario-backed.",
			})
			: JSON.stringify({
				summary: "Generated skill", expectedOutcome: "Remain pending for manual resource reload",
				artifacts: [{
					id: "generated-skill", kind: "skill_manifest", title: "Generated skill",
					content: "Run verified workflow steps.", applicability: ["Workflow"],
					nonApplicability: ["Other"], promptTokenBudget: 80, dependencies: [],
					expectedOutcome: "Reusable workflow",
				}],
			});
		},
	});
	ctx.cwd = cwd;
	ctx.agentDir = agentDir;
	await commands.get("refine")!("mode guarded", ctx);
	await handlers.get("turn_end")![0]!({ type: "turn_end", turnIndex: 25, message: { role: "assistant", content: [] }, toolResults: [] }, ctx);
	await handlers.get("agent_end")![0]!({ type: "agent_end", messages: [] }, ctx);
	await waitFor(() => calls === 2, "skill evaluation");
	await handlers.get("session_shutdown")![0]!({ type: "session_shutdown" }, ctx);
	assert.equal(await new EvolutionStore({ agentDir, cwd, sessionId: "session-1" }).getCurrent("session"), undefined);
});
