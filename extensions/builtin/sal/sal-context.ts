/**
 * [WHO]: Provides SAL system-prompt context injection and sidecar turn-record persistence
 * [FROM]: Depends on node fs/path, SAL anchors, terrain snapshots, and SalRuntime state
 * [TO]: Consumed by extensions/builtin/sal/index.ts during before_agent_start and agent_end hooks
 * [HERE]: extensions/builtin/sal/sal-context.ts - context formatting and local sidecar persistence for Structural Anchor Localization
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AnchorResolution } from "./anchors.js";
import type { TerrainSnapshot } from "./terrain.js";
import type { SalRuntime } from "./sal-runtime.js";

const SAL_CONTEXT_BUDGET_TOKENS = 800;
const APPROX_TOKENS_PER_CHAR = 0.25;

function approxTokens(text: string): number {
	return Math.ceil(text.length * APPROX_TOKENS_PER_CHAR);
}

function truncateForBudget(parts: string[], budgetTokens: number): string {
	const out: string[] = [];
	let used = 0;
	for (const p of parts) {
		const t = approxTokens(p);
		if (used + t > budgetTokens) {
			const remaining = Math.max(0, budgetTokens - used);
			if (remaining > 20) {
				const charBudget = Math.floor(remaining / APPROX_TOKENS_PER_CHAR);
				out.push(`${p.slice(0, charBudget)}...`);
			}
			break;
		}
		out.push(p);
		used += t;
	}
	return out.join("\n");
}

export function buildContextInjection(resolution: AnchorResolution, snapshot: TerrainSnapshot): string | undefined {
	if (!resolution.selected || resolution.candidates.length === 0) return undefined;
	const top = resolution.candidates[0];
	const anchor = top.anchor;

	const region = anchor.modulePath || anchor.filePath || "<root>";
	const regionSummary = `Likely task region: ${region} (confidence ${anchor.confidence.toFixed(2)})`;

	const reasonLines = top.reasons.slice(0, 3).map((r) => `  - ${r}`);
	const altLines = resolution.candidates
		.slice(1, 4)
		.map((c) => {
			const target = c.anchor.modulePath || c.anchor.filePath || "<root>";
			return `  - ${target} (${c.score.toFixed(2)})`;
		});

	const moduleNode = snapshot.nodes.find(
		(n) => (n.kind === "module" || n.kind === "root") && (n.modulePath ?? "") === (anchor.modulePath ?? ""),
	);
	const summaryLine = moduleNode?.p2Summary ? `Module brief: ${moduleNode.p2Summary}` : undefined;

	const parts: string[] = ["[SAL Anchor]", regionSummary];
	if (summaryLine) parts.push(summaryLine);
	if (reasonLines.length > 0) {
		parts.push("Evidence:");
		parts.push(...reasonLines);
	}
	if (altLines.length > 0) {
		parts.push("Alternative anchors:");
		parts.push(...altLines);
	}
	parts.push(
		"Use this anchor as a structural prior. If the prompt actually targets a different region, override it from tool evidence.",
	);

	return truncateForBudget(parts, SAL_CONTEXT_BUDGET_TOKENS);
}

function ensureSidecarDir(runtime: SalRuntime): void {
	if (!existsSync(runtime.sidecarDir)) {
		try {
			mkdirSync(runtime.sidecarDir, { recursive: true });
		} catch {
			// Non-fatal: sidecar persistence is diagnostic only.
		}
	}
}

export function persistTurnRecord(runtime: SalRuntime, taskRes: AnchorResolution | undefined, actionRes: AnchorResolution): void {
	ensureSidecarDir(runtime);
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const filePath = join(runtime.sidecarDir, `turn-${ts}.json`);
	const record = {
		generatedAt: new Date().toISOString(),
		workspaceRoot: runtime.workspaceRoot,
		weightsSource: runtime.weightsSource,
		prompt: runtime.turn.prompt?.slice(0, 500),
		taskAnchor: taskRes?.selected,
		taskCandidates: taskRes?.candidates.slice(0, 3),
		taskUnresolved: taskRes?.unresolvedSignals,
		actionAnchor: actionRes.selected,
		actionCandidates: actionRes.candidates.slice(0, 3),
		touchedFiles: Array.from(runtime.turn.touchedFiles),
	};
	try {
		writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
	} catch {
		// Non-fatal: sidecar persistence is diagnostic only.
	}
}
