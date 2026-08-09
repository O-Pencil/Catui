/**
 * [WHO]: Opt-in controlled self-evolution extension with /refine and promoted declarative context hooks
 * [FROM]: Depends on Node crypto, ExtensionAPI, and extension-local prompts/schema/store/types
 * [TO]: Loaded explicitly by Catui users as the self-evolving harness surface
 * [HERE]: extensions/optional/evolution/index.ts - manual refinement and active-resource orchestration
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../../../core/extensions-host/types.js";
import { boundedSessionEvidence, buildRefinementPrompt, PROPOSAL_DRAFT_SCHEMA } from "./prompts.js";
import { validateProposal } from "./schema.js";
import { EvolutionStore } from "./store.js";
import type { ArtifactKind, EvolutionArtifact, EvolutionProposal, EvolutionScope, GateEvidence } from "./types.js";

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
		provenance: { sourceCandidateId: input.id, trigger: "manual", traceRefs: input.traceRefs },
	}));
	return {
		schemaVersion: 1,
		id: input.id,
		scope: input.scope,
		baselineRevisionId: input.baselineRevisionId,
		summary: draft.summary,
		expectedOutcome: draft.expectedOutcome,
		createdAt: input.createdAt,
		provenance: { trigger: "manual", sessionId: input.sessionId, traceRefs: input.traceRefs },
		artifacts,
	};
}

async function handleNewProposal(args: string, ctx: ExtensionCommandContext): Promise<void> {
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
	ctx.ui.notify(`Evolution candidate ${id} is statically validated and inactive; replay/eval evidence is required before promotion.`, "info");
}

async function handleCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	try {
		const scope = parseScope(args);
		const tokens = commandTokens(args);
		const action = tokens[0];
		const store = storeFor(ctx);
		if (action === "status") {
			const current = await store.getCurrent(scope);
			ctx.ui.notify(current ? `Evolution ${scope} active revision: ${current.revisionId}` : `Evolution ${scope} has no active revision.`, "info");
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
				if (result.previousRevisionId) await store.rollback(scope, result.previousRevisionId);
				throw new Error(`Resource reload failed; activation was restored: ${error instanceof Error ? error.message : String(error)}`);
			}
			ctx.ui.notify(`Evolution ${scope} rolled back to ${result.revisionId}.`, "info");
			return;
		}
		if (action === "approve" || action === "reject" || action === "mode") {
			ctx.ui.notify(`Refine ${action} is unavailable in the manual-candidate slice; no active state changed.`, "warning");
			return;
		}
		await handleNewProposal(args, ctx);
	} catch (error: unknown) {
		ctx.ui.notify(`Refine failed: ${error instanceof Error ? error.message : String(error)}`, "error");
	}
}

async function activePrompt(ctx: ExtensionContext): Promise<string | undefined> {
	const store = storeFor(ctx);
	const sections: string[] = [];
	for (const scope of ["global", "workspace", "session"] as const) {
		try {
			const manifest = await store.readActiveManifest(scope);
			if (!manifest) continue;
			for (const artifact of manifest.artifacts) {
				if (artifact.kind !== "prompt_note" && artifact.kind !== "memory") continue;
				const bounded = artifact.content.slice(0, artifact.promptTokenBudget * 4);
				sections.push(`[${artifact.id} | ${scope}]\n${bounded}`);
			}
		} catch {
			// A corrupt evolution scope disables only that scope; normal sessions continue.
		}
	}
	if (sections.length === 0) return undefined;
	return `# Promoted Evolved Context\nSupplementary only; explicit user/project resources and built-in safety rules take precedence.\n\n${sections.join("\n\n")}`;
}

export default async function evolutionExtension(api: ExtensionAPI): Promise<void> {
	api.registerCommand("refine", {
		description: "Propose, inspect, or roll back controlled declarative harness evolution",
		handler: handleCommand,
	});
	api.on("resources_discover", async (_event, ctx) => {
		const existing = new Set(ctx.getSkills().map((skill) => skill.name));
		const skillPaths: string[] = [];
		const store = storeFor(ctx);
		for (const scope of ["global", "workspace", "session"] as const) {
			try {
				for (const skill of await store.activeSkillPaths(scope)) {
					if (!existing.has(skill.name)) {
						existing.add(skill.name);
						skillPaths.push(skill.path);
					}
				}
			} catch {
				// Invalid generated resources disable only the affected scope.
			}
		}
		return skillPaths.length > 0 ? { skillPaths } : undefined;
	});
	api.on("before_agent_start", async (_event, ctx) => {
		const appendSystemPrompt = await activePrompt(ctx);
		return appendSystemPrompt ? { appendSystemPrompt } : undefined;
	});
}
