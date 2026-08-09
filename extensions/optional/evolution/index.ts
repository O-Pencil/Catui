/**
 * [WHO]: Opt-in controlled self-evolution extension with /refine and promoted declarative context hooks
 * [FROM]: Depends on Node crypto, ExtensionAPI, and extension-local prompts/schema/store/types
 * [TO]: Loaded explicitly by Catui users as the self-evolving harness surface
 * [HERE]: extensions/optional/evolution/index.ts - manual refinement and active-resource orchestration
 */
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, relative } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../../../core/extensions-host/types.js";
import { boundedSessionEvidence, buildRefinementPrompt, PROPOSAL_DRAFT_SCHEMA } from "./prompts.js";
import { validateProposal } from "./schema.js";
import { EvolutionStore, skillDirectoryName } from "./store.js";
import type { ArtifactKind, EvolutionArtifact, EvolutionProposal, EvolutionScope, GateEvidence } from "./types.js";
import { mergeScopedArtifacts } from "./workflow.js";
import { evaluateCandidateEffectiveness } from "./evaluation.js";
import { evolvedActivePrompt } from "./consumers.js";
import {
	DEFAULT_AUTOMATION_POLICY,
	EVOLUTION_MODES,
	loadAutomationState,
	reserveAutomationReview,
	runWithGuardedAuthorization,
	updateAutomationState,
	type AutomationTrigger,
	type EvolutionMode,
} from "./automation.js";

interface ProposalDraftArtifact {
	id: string;
	kind: ArtifactKind;
	title: string;
	content: string;
	applicability: string[];
	nonApplicability: string[];
	promptTokenBudget: number;
	dependencies: string[];
	expectedOutcome: string;
	overrides?: string;
}

interface ProposalDraft {
	summary: string;
	expectedOutcome: string;
	artifacts: ProposalDraftArtifact[];
}

function parseScope(args: string): EvolutionScope {
	const match = args.match(/(?:^|\s)--scope\s+(global|workspace|session)(?:\s|$)/);
	return (match?.[1] as EvolutionScope | undefined) ?? "session";
}

function commandTokens(args: string): string[] {
	return args.replace(/(?:^|\s)--scope\s+(?:global|workspace|session)(?=\s|$)/g, " ").trim().split(/\s+/).filter(Boolean);
}

function storeFor(ctx: ExtensionContext): EvolutionStore {
	return new EvolutionStore({
		agentDir: ctx.agentDir,
		cwd: ctx.cwd,
		sessionId: ctx.sessionManager.getSessionId(),
	});
}

function parseDraft(raw: string): ProposalDraft {
	const value = JSON.parse(raw) as unknown;
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Refinement response must be an object");
	const record = value as Record<string, unknown>;
	if (typeof record.summary !== "string" || typeof record.expectedOutcome !== "string" || !Array.isArray(record.artifacts)) {
		throw new Error("Refinement response is missing summary, expectedOutcome, or artifacts");
	}
	return value as ProposalDraft;
}

function buildProposal(draft: ProposalDraft, input: {
	id: string;
	scope: EvolutionScope;
	baselineRevisionId: string | null;
	sessionId: string;
	traceRefs: string[];
	createdAt: string;
	trigger: string;
}): EvolutionProposal {
	const artifacts: EvolutionArtifact[] = draft.artifacts.map((artifact) => ({
		schemaVersion: 1,
		id: `evolved:${artifact.kind}:${artifact.id}`,
		kind: artifact.kind,
		title: artifact.title,
		content: artifact.content,
		scope: input.scope,
		version: 1,
		createdAt: input.createdAt,
		applicability: artifact.applicability,
		nonApplicability: artifact.nonApplicability,
		promptTokenBudget: artifact.promptTokenBudget,
		dependencies: artifact.dependencies,
		expectedOutcome: artifact.expectedOutcome,
		...(artifact.overrides ? { overrides: artifact.overrides } : {}),
		provenance: { sourceCandidateId: input.id, trigger: input.trigger, traceRefs: input.traceRefs },
	}));
	return {
		schemaVersion: 1,
		id: input.id,
		scope: input.scope,
		baselineRevisionId: input.baselineRevisionId,
		summary: draft.summary,
		expectedOutcome: draft.expectedOutcome,
		createdAt: input.createdAt,
		provenance: { trigger: input.trigger, sessionId: input.sessionId, traceRefs: input.traceRefs },
		artifacts,
	};
}

async function handleNewProposal(
	args: string,
	ctx: ExtensionContext,
	options: { trigger?: string; notify?: boolean } = {},
): Promise<string> {
	if (!ctx.completeJson) throw new Error("The current model does not support structured refinement");
	const scope = parseScope(args);
	const store = storeFor(ctx);
	const baselineRevisionId = (await store.getCurrent(scope))?.revisionId ?? null;
	const entries = ctx.sessionManager.getEntries();
	const evidence = boundedSessionEvidence(entries, [ctx.cwd, ctx.agentDir]);
	const sessionId = ctx.sessionManager.getSessionId();
	const traceRefs = evidence.map((entry) => `session:${sessionId}:entry:${entry.id}`);
	if (traceRefs.length === 0) traceRefs.push(`session:${sessionId}:manual`);
	const prompts = buildRefinementPrompt({
		scope,
		baselineRevisionId,
		instructions: commandTokens(args).join(" "),
		evidence,
	});
	const raw = await ctx.completeJson(prompts.systemPrompt, prompts.userPrompt, PROPOSAL_DRAFT_SCHEMA, {
		toolName: "propose_harness_refinement",
		resultKey: "proposal",
	});
	if (!raw) throw new Error("The model returned no refinement proposal");
	const id = `candidate_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
	const proposal = buildProposal(parseDraft(raw), {
		id,
		scope,
		baselineRevisionId,
		sessionId,
		traceRefs,
		createdAt: new Date().toISOString(),
		trigger: options.trigger ?? "manual",
	});
	const validation = validateProposal(proposal);
	if (!validation.ok) throw new Error(`Refinement proposal rejected: ${validation.issues.join("; ")}`);
	await store.createCandidate(scope, proposal);
	const staticEvidence: GateEvidence = {
		schemaVersion: 1,
		gate: "static",
		passed: true,
		createdAt: new Date().toISOString(),
		summary: "Declarative schema and untrusted-content checks passed",
		details: { issueCount: 0 },
	};
	await store.writeEvidence(scope, id, staticEvidence);
	if (options.notify !== false) {
		ctx.ui.notify(`Evolution candidate ${id} is statically validated and inactive; replay/eval evidence is required before promotion.`, "info");
	}
	return id;
}

function automationFingerprint(kind: string, value: unknown): string {
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		serialized = String(value);
	}
	return createHash("sha256").update(`${kind}:${serialized.slice(0, 8_000)}`).digest("hex");
}

async function runAutomaticReview(trigger: AutomationTrigger, ctx: ExtensionContext, isCurrent: () => boolean): Promise<void> {
	const now = Date.now();
	const reservation = await reserveAutomationReview(ctx.agentDir, trigger, DEFAULT_AUTOMATION_POLICY, now);
	if (!reservation.reserved) return;
	const scope = reservation.state.promotionScope;
	const candidateId = await handleNewProposal(`--scope ${scope}`, ctx, { trigger: `automatic:${trigger.type}`, notify: false });
	if (!isCurrent()) return;
	await verifyCandidate(scope, candidateId, ctx, { notify: false });
	if (!isCurrent()) return;
	const improved = await evaluateCandidateEffectiveness(scope, candidateId, storeFor(ctx), ctx);
	if (!improved || !isCurrent()) return;
	const store = storeFor(ctx);
	const proposal = await store.readProposal(scope, candidateId);
	// Generated skills require a resource reload, which is intentionally reserved for explicit commands.
	if (proposal.artifacts.some((artifact) => artifact.kind === "skill_manifest")) return;
	await runWithGuardedAuthorization(ctx.agentDir, scope, async () => {
		if (!isCurrent()) return;
		await store.promote(scope, candidateId, {
			beforeActivate: () => {
				if (!isCurrent()) throw new Error("Automatic promotion was cancelled before activation");
			},
		});
	});
}

async function verifyCandidate(
	scope: EvolutionScope,
	candidateId: string,
	ctx: ExtensionContext,
	options: { notify?: boolean } = {},
): Promise<void> {
	const store = storeFor(ctx);
	await store.readProposal(scope, candidateId);
	const trace = ctx.getLastRunTrace?.();
	if (!trace || trace.length === 0) throw new Error("No completed run trace is available for deterministic verification");
	if (trace.length > 4_096) throw new Error("The completed run trace exceeds the verification event budget");
	if (Buffer.byteLength(JSON.stringify(trace), "utf8") > 512 * 1_024) {
		throw new Error("The completed run trace exceeds the verification byte budget");
	}
	if (!ctx.replayRunTrace) throw new Error("Deterministic run replay is unavailable in this runtime");
	const replay = ctx.replayRunTrace(trace);
	if (!ctx.runHarnessEval) throw new Error("Harness evaluation is unavailable in this runtime");
	const report = await ctx.runHarnessEval();
	const passed = replay.ok && report.passed;
	await store.writeEvidence(scope, candidateId, {
		schemaVersion: 1,
		gate: "replay",
		passed,
		createdAt: new Date().toISOString(),
		summary: !replay.ok
			? replay.divergence.message
			: report.passed ? "Semantic replay and built-in deterministic harness regressions passed" : "Built-in deterministic harness regressions failed",
		details: {
			lifecyclePreserved: replay.ok,
			toolPairsPreserved: replay.ok,
			policyPreserved: replay.ok,
			harnessEvalPassed: report.passed,
			harnessScenarios: report.scenarioIds,
			harnessMetrics: report.metrics,
			eventCount: trace.length,
			trace: structuredClone(trace),
			...(replay.ok ? { replaySummary: replay.summary } : { divergence: replay.divergence }),
		},
	});
	if (!replay.ok) throw new Error(`Run trace replay failed: ${replay.divergence.message}`);
	if (!report.passed) throw new Error("Harness evaluation failed; the candidate remains inactive");
	if (options.notify !== false) {
		ctx.ui.notify(`Evolution candidate ${candidateId} verified for safety; effectiveness is pending explicit human approval.`, "info");
	}
}

async function approveCandidate(scope: EvolutionScope, candidateId: string, reason: string, ctx: ExtensionCommandContext): Promise<void> {
	const store = storeFor(ctx);
	await store.readProposal(scope, candidateId);
	await store.writeEvidence(scope, candidateId, {
		schemaVersion: 1,
		gate: "reviewer",
		passed: true,
		createdAt: new Date().toISOString(),
		summary: reason || "Explicit human approval",
		details: { actor: "human", overrideMissingEffectiveness: true, reason: reason || "explicit-command" },
	});
	const result = await store.promote(scope, candidateId);
	try {
		await ctx.reload();
	} catch (error: unknown) {
		await store.restoreActivation(scope, result.revisionId, result.previousRevisionId);
		throw new Error(`Resource reload failed; activation was restored: ${error instanceof Error ? error.message : String(error)}`);
	}
	ctx.ui.notify(`Evolution candidate ${candidateId} promoted as ${result.revisionId}.`, "info");
}

async function rejectCandidate(scope: EvolutionScope, candidateId: string, reason: string, ctx: ExtensionCommandContext): Promise<void> {
	const store = storeFor(ctx);
	await store.readProposal(scope, candidateId);
	await store.writeEvidence(scope, candidateId, {
		schemaVersion: 1,
		gate: "reviewer",
		passed: false,
		createdAt: new Date().toISOString(),
		summary: reason || "Explicit human rejection",
		details: { actor: "human", reason: reason || "explicit-command" },
	});
	ctx.ui.notify(`Evolution candidate ${candidateId} was rejected and remains inactive.`, "warning");
}

async function handleCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const scope = parseScope(args);
		const tokens = commandTokens(args);
		const action = tokens[0];
		const store = storeFor(ctx);
		if (action === "status") {
			const current = await store.getCurrent(scope);
			const inventory = await store.inventory(scope);
			const automation = await loadAutomationState(ctx.agentDir);
			const active = current ? `active revision ${current.revisionId}` : "no active revision";
			ctx.ui.notify(`Evolution ${scope}: ${active}; ${inventory.pendingCandidates} pending, ${inventory.quarantined} quarantined, ${inventory.revisions} revision(s); mode=${automation.mode}; automation scope=${automation.promotionScope}; daily budget ${automation.tokensUsed}/${DEFAULT_AUTOMATION_POLICY.dailyTokenBudget} estimated tokens and $${automation.costUsedUsd.toFixed(2)}/$${DEFAULT_AUTOMATION_POLICY.dailyCostBudgetUsd.toFixed(2)}.`, "info");
			return;
		}
		if (action === "inspect") {
			if (!tokens[1]) throw new Error("Usage: /refine inspect <candidate-id> [--scope ...]");
			const proposal = await store.readProposal(scope, tokens[1]);
			ctx.ui.notify(`${proposal.id}: ${proposal.summary} (${proposal.artifacts.length} artifact(s), inactive until promoted)`, "info");
			return;
		}
		if (action === "rollback") {
			if (!tokens[1]) throw new Error("Usage: /refine rollback <revision-id> [--scope ...]");
			const result = await store.rollback(scope, tokens[1]);
			try {
				await ctx.reload();
			} catch (error: unknown) {
				await store.restoreActivation(scope, result.revisionId, result.previousRevisionId);
				throw new Error(`Resource reload failed; activation was restored: ${error instanceof Error ? error.message : String(error)}`);
			}
			ctx.ui.notify(`Evolution ${scope} rolled back to ${result.revisionId}.`, "info");
			return;
		}
		if (action === "verify") {
			if (!tokens[1]) throw new Error("Usage: /refine verify <candidate-id> [--scope ...]");
			await verifyCandidate(scope, tokens[1], ctx);
			return;
		}
		if (action === "approve") {
			if (!tokens[1]) throw new Error("Usage: /refine approve <candidate-id> [reason] [--scope ...]");
			await approveCandidate(scope, tokens[1], tokens.slice(2).join(" "), ctx);
			return;
		}
		if (action === "reject") {
			if (!tokens[1]) throw new Error("Usage: /refine reject <candidate-id> [reason] [--scope ...]");
			await rejectCandidate(scope, tokens[1], tokens.slice(2).join(" "), ctx);
			return;
		}
		if (action === "mode") {
			const requested = tokens[1];
			if (!requested || !EVOLUTION_MODES.includes(requested as EvolutionMode)) {
				throw new Error("Usage: /refine mode off|manual|shadow|guarded");
			}
			if (scope === "global") throw new Error("Automatic global evolution is prohibited; choose --scope session or workspace");
			await updateAutomationState(ctx.agentDir, (automation) => ({
				...automation,
				mode: requested as EvolutionMode,
				promotionScope: scope,
			}));
			ctx.ui.notify(`Evolution automation mode set to ${requested} for ${scope}.`, "info");
			return;
		}
		await handleNewProposal(args, ctx);
	} catch (error: unknown) {
		ctx.ui.notify(`Refine failed: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

export default async function evolutionExtension(api: ExtensionAPI): Promise<void> {
	let automationTail: Promise<void> = Promise.resolve();
	let pendingTurnTrigger: AutomationTrigger | undefined;
	let automationGeneration = 0;
	const enqueueAutomation = (trigger: AutomationTrigger, ctx: ExtensionContext): void => {
		const generation = automationGeneration;
		automationTail = automationTail
			.then(() => runAutomaticReview(trigger, ctx, () => automationGeneration === generation))
			.catch(() => undefined);
	};
	api.registerCommand("refine", {
		description: "Propose, inspect, or roll back controlled declarative harness evolution",
		handler: handleCommand,
	});
	api.on("resources_discover", async (_event, ctx) => {
		const existing = new Map(ctx.getSkills().map((skill) => [skill.name, skill]));
		const skillPaths: string[] = [];
		const store = storeFor(ctx);
		const scoped: Array<{ scope: EvolutionScope; artifacts: EvolutionArtifact[] }> = [];
		const pathsByScopeAndId = new Map<string, string>();
		for (const scope of ["global", "workspace", "session"] as const) {
			try {
				for (const skill of await store.activeSkillPaths(scope)) {
					pathsByScopeAndId.set(`${scope}:${skill.artifact.id}`, skill.path);
					scoped.push({ scope, artifacts: [skill.artifact] });
				}
			} catch {
				// Invalid generated resources disable only the affected scope.
			}
		}
		for (const artifact of mergeScopedArtifacts(scoped, (item) => skillDirectoryName(item.id))) {
			const path = pathsByScopeAndId.get(`${artifact.scope}:${artifact.id}`);
			if (!path) continue;
			const name = skillDirectoryName(artifact.id);
			const collisionPath = existing.get(name)?.filePath;
			const rel = collisionPath ? relative(path, collisionPath) : undefined;
			if (!collisionPath || (rel !== undefined && !rel.startsWith("..") && !isAbsolute(rel))) skillPaths.push(path);
		}
		return skillPaths.length > 0 ? { skillPaths } : undefined;
	});
	api.on("before_agent_start", async (event, ctx) => {
		automationGeneration += 1;
		const appendSystemPrompt = await evolvedActivePrompt(ctx, event.prompt);
		return appendSystemPrompt ? { appendSystemPrompt } : undefined;
	});
	api.on("turn_end", (event, ctx) => {
		pendingTurnTrigger = {
			type: "turn",
			turnIndex: event.turnIndex,
			fingerprint: automationFingerprint("turn", { turnIndex: event.turnIndex, message: event.message, toolResults: event.toolResults }),
		};
	});
	api.on("agent_end", (_event, ctx) => {
		if (!pendingTurnTrigger) return;
		const trigger = pendingTurnTrigger;
		pendingTurnTrigger = undefined;
		enqueueAutomation(trigger, ctx);
	});
	api.on("session_compact", (event, ctx) => {
		enqueueAutomation({ type: "compaction", fingerprint: automationFingerprint("compaction", event.compactionEntry) }, ctx);
	});
	api.on("session_shutdown", () => {
		automationGeneration += 1;
		pendingTurnTrigger = undefined;
	});
}
