/**
 * [WHO]: evolutionExtension registers /refine, model tools, turn observation, and active evolved harness prompt injection
 * [FROM]: Depends on core extension APIs plus local evolution store/refiner/format/tool/observer modules
 * [TO]: Loaded explicitly as optional extension through Catui extension configuration or --extension
 * [HERE]: extensions/optional/evolution/index.ts - controlled self-evolution feature entry
 */

import type {
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "../../../core/extensions-host/types.js";
import {
	createEvolutionCandidate,
	getEvolutionScopeRoot,
	inspectEvolution,
	loadActiveEvolutionArtifacts,
	promoteEvolutionCandidate,
	rejectEvolutionCandidate,
	recordEvolutionGateFailure,
	rollbackEvolution,
} from "./evolution-store.js";
import {
	buildEvolutionPromptAppend,
	formatCandidate,
	formatCreatedCandidate,
	formatEvolutionChanges,
	formatEvolutionStatus,
	formatRevision,
} from "./evolution-format.js";
import { planEvolutionCandidate } from "./evolution-refiner.js";
import { createEvolutionRefineTool } from "./evolution-refine-tool.js";
import { runEvolutionGate } from "./evolution-gate.js";
import { createEvolvedTool } from "./evolution-tool.js";
import { createEvolvedExecutableTool } from "./evolution-executable-tool.js";
import { EvolutionAutoObserver } from "./evolution-auto.js";
import type { EvolutionScope, EvolutionScopeSelector } from "./evolution-types.js";

const MESSAGE_TYPE = "evolution";

function parseScope(args: string, ctx: ExtensionContext): { scope: EvolutionScope; selector: EvolutionScopeSelector; rest: string } {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	let scope: EvolutionScope = "session";
	const remaining: string[] = [];
	for (const token of tokens) {
		if (token === "--global") scope = "global";
		else if (token === "--workspace") scope = "workspace";
		else if (token === "--session") scope = "session";
		else remaining.push(token);
	}
	const selector: EvolutionScopeSelector =
		scope === "global"
			? { scope }
			: scope === "workspace"
				? { scope, cwd: ctx.cwd }
				: { scope, sessionId: ctx.sessionManager.getSessionId() };
	return { scope, selector, rest: remaining.join(" ") };
}

function rootFor(ctx: ExtensionContext, selector: EvolutionScopeSelector): string {
	return getEvolutionScopeRoot(ctx.agentDir, selector);
}

function send(api: ExtensionAPI, content: string): void {
	api.sendMessage({ customType: MESSAGE_TYPE, content, display: true });
}

async function handleRefineCommand(args: string, ctx: ExtensionCommandContext, api: ExtensionAPI): Promise<void> {
	const parsed = parseScope(args, ctx);
	const [command, ...tail] = parsed.rest.split(/\s+/).filter(Boolean);
	const root = rootFor(ctx, parsed.selector);
	const subcommand = command ?? "";
	if (subcommand === "status" || subcommand === "") {
		if (subcommand === "status") {
			send(api, formatEvolutionStatus(inspectEvolution(root), parsed.scope));
			return;
		}
		if (!ctx.model) {
			ctx.ui.notify("Refine unavailable: no model is currently selected.", "warning");
			return;
		}
		ctx.ui.notify("Planning evolution candidate...", "info");
		const input = await planEvolutionCandidate(ctx, parsed.scope, tail.join(" "));
		const candidate = createEvolutionCandidate(root, input);
		api.appendEntry("catui.evolution.candidate", { scope: parsed.scope, candidateId: candidate.id });
		send(api, formatCreatedCandidate(candidate));
		return;
	}
	if (subcommand === "inspect") {
		const id = tail[0];
		if (!id) {
			send(api, formatEvolutionStatus(inspectEvolution(root), parsed.scope));
			return;
		}
		const inspection = inspectEvolution(root);
		const candidate = inspection.candidates.find((item) => item.id === id);
		if (candidate) {
			send(api, formatCandidate(candidate));
			return;
		}
		const revision = inspection.revisions.find((item) => item.id === id);
		if (revision) {
			send(api, formatRevision(revision));
			return;
		}
		throw new Error(`Evolution item not found: ${id}`);
	}
	if (subcommand === "changes") {
		send(api, formatEvolutionChanges(inspectEvolution(root), tail[0]));
		return;
	}
	if (subcommand === "promote" || subcommand === "approve") {
		const id = tail[0];
		if (!id) throw new Error("Usage: /refine promote <candidate-id>");
		const candidate = inspectEvolution(root).candidates.find((item) => item.id === id);
		if (!candidate) throw new Error(`Evolution candidate not found: ${id}`);
		const hasExecutableTool = candidate.artifacts.some((artifact) => artifact.kind === "executable_tool");
		const gateReport = hasExecutableTool
			? await runEvolutionGate(candidate, { agentDir: ctx.agentDir, cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() })
			: undefined;
		if (gateReport && !gateReport.passed) {
			recordEvolutionGateFailure(root, id, { gateReport });
			send(api, `Evolution candidate ${id} remains inactive: eval gate failed (${gateReport.failure ?? gateReport.name}).`);
			return;
		}
		const revision = promoteEvolutionCandidate(root, id, { approvedBy: "user", ...(gateReport ? { gateReport } : {}) });
		api.appendEntry("catui.evolution.promoted", { scope: parsed.scope, candidateId: id, revisionId: revision.id });
		await ctx.reload();
		send(api, `Evolution revision ${revision.id} is now active.`);
		return;
	}
	if (subcommand === "reject") {
		const id = tail[0];
		if (!id) throw new Error("Usage: /refine reject <candidate-id> [reason]");
		const candidate = rejectEvolutionCandidate(root, id, tail.slice(1).join(" ") || "Rejected by user", { rejectedBy: "user" });
		api.appendEntry("catui.evolution.rejected", { scope: parsed.scope, candidateId: id });
		send(api, `Evolution candidate ${candidate.id} rejected.`);
		return;
	}
	if (subcommand === "rollback") {
		const id = tail[0];
		if (!id) throw new Error("Usage: /refine rollback <revision-id>");
		const current = rollbackEvolution(root, id, { requestedBy: "user" });
		api.appendEntry("catui.evolution.rollback", { scope: parsed.scope, revisionId: id, rollbackOf: current.rollbackOf });
		await ctx.reload();
		send(api, `Evolution rolled back to revision ${current.revisionId}.`);
		return;
	}
	const instructions = parsed.rest;
	if (!ctx.model) {
		ctx.ui.notify("Refine unavailable: no model is currently selected.", "warning");
		return;
	}
	ctx.ui.notify("Planning evolution candidate...", "info");
	const input = await planEvolutionCandidate(ctx, parsed.scope, instructions);
	const candidate = createEvolutionCandidate(root, input);
	api.appendEntry("catui.evolution.candidate", { scope: parsed.scope, candidateId: candidate.id });
	send(api, formatCreatedCandidate(candidate));
}

function beforeAgentStart(ctx: ExtensionContext): BeforeAgentStartEventResult | undefined {
	const roots = [
		rootFor(ctx, { scope: "global" }),
		rootFor(ctx, { scope: "workspace", cwd: ctx.cwd }),
		rootFor(ctx, { scope: "session", sessionId: ctx.sessionManager.getSessionId() }),
	];
	const artifacts = roots.flatMap((root) => loadActiveEvolutionArtifacts(root));
	const appendSystemPrompt = buildEvolutionPromptAppend(artifacts);
	return appendSystemPrompt ? { appendSystemPrompt } : undefined;
}

export default async function evolutionExtension(api: ExtensionAPI): Promise<void> {
	const autoObserver = new EvolutionAutoObserver();
	api.registerTool(createEvolutionRefineTool());
	api.registerTool(createEvolvedTool());
	api.registerTool(createEvolvedExecutableTool());
	api.registerCommand("refine", {
		description: "Propose, inspect, promote, reject, or rollback controlled evolved harness artifacts.",
		getArgumentCompletions: (prefix) => {
			const values = ["status", "inspect", "changes", "promote", "approve", "reject", "rollback", "--session", "--workspace", "--global"];
			const normalized = prefix.trim();
			return values
				.filter((value) => value.startsWith(normalized))
				.map((value) => ({ value, label: value }));
		},
		handler: (args, ctx) => handleRefineCommand(args, ctx, api),
	});
	api.on("before_agent_start", (_event, ctx) => beforeAgentStart(ctx));
	api.on("turn_end", async (event, ctx) => {
		try {
			await autoObserver.observeTurnEnd(event, ctx);
		} catch {
			// Auto-observation must never fail the agent loop; invalid lessons simply do not evolve.
		}
	});
}
