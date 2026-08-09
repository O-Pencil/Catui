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
		{ gate: "replay", details: { lifecyclePreserved: true, toolPairsPreserved: true, policyPreserved: true } },
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

function context(options: {
	completeJson?: ExtensionCommandContext["completeJson"];
	notifications?: string[];
	reloads?: { count: number };
	reloadError?: Error;
	lastRunTrace?: readonly unknown[];
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
			getEntries: () => [{
				type: "message",
				id: "entry-1",
				parentId: null,
				timestamp: "2026-08-09T00:00:00.000Z",
				message: { role: "user", content: "Use API_KEY=secret-value in /Users/alice/private-workspace" },
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
	assert.doesNotMatch(capturedPrompt, /secret-value|\/Users\/alice/);
	assert.match(capturedPrompt, /\[REDACTED_SECRET\]|\[REDACTED_PATH\]/);
	assert.match(notifications.join(" "), /statically validated/i);
	assert.match(notifications.join(" "), /inactive/i);
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
		{ type: "before_agent_start", prompt: "Finish", systemPrompt: "base" },
		{ ...context(), cwd, agentDir } as ExtensionContext,
	) as { appendSystemPrompt?: string };
	assert.match(result.appendSystemPrompt ?? "", /Always run verify:all/);
	assert.doesNotMatch(result.appendSystemPrompt ?? "", /Never inject/);
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
