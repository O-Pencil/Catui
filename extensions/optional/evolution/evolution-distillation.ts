/**
 * [WHO]: Provides deterministic trace clustering and distilled evidence summaries for evolution candidates
 * [FROM]: Depends on workspace trace JSONL reader and local path labels only
 * [TO]: Consumed by evolution_refine trace sweep candidate creation
 * [HERE]: extensions/optional/evolution/evolution-distillation.ts - non-executable experience evidence boundary
 */

import { relative, resolve } from "node:path";
import { readRunTraceJsonl } from "../../../core/runtime/run-trace-jsonl.js";
import type { RunTraceEventV1 } from "@catui/agent-core";

export interface EvolutionTraceEvidenceSlice {
	clusterId: string;
	rootCause: string;
	tracePath: string;
	signals: {
		stopReason?: string;
		outputFingerprint?: string;
		toolCallCount?: number;
		turnCount?: number;
	};
}

export interface EvolutionTraceEvidenceCluster {
	id: string;
	traceCount: number;
	tracePaths: string[];
	rootCause: string;
	signals: EvolutionTraceEvidenceSlice["signals"];
}

export interface EvolutionTraceEvidenceSummary {
	schemaVersion: 1;
	createdBy: "evolution_trace_distillation";
	traceCount: number;
	clusters: EvolutionTraceEvidenceCluster[];
	slicesByTracePath: Record<string, EvolutionTraceEvidenceSlice>;
}

interface TraceSignature {
	tracePath: string;
	signatureKey: string;
	signals: EvolutionTraceEvidenceSlice["signals"];
}

function completedEvent(events: readonly RunTraceEventV1[]): RunTraceEventV1 | undefined {
	return events.find((event) => event.kind === "run.completed");
}

function completedSignals(event: RunTraceEventV1 | undefined): EvolutionTraceEvidenceSlice["signals"] {
	const payload = event?.payload as {
		stopReason?: unknown;
		outputFingerprint?: unknown;
		toolCallCount?: unknown;
		turnCount?: unknown;
	} | undefined;
	return {
		...(typeof payload?.stopReason === "string" ? { stopReason: payload.stopReason } : {}),
		...(typeof payload?.outputFingerprint === "string" ? { outputFingerprint: payload.outputFingerprint } : {}),
		...(typeof payload?.toolCallCount === "number" ? { toolCallCount: payload.toolCallCount } : {}),
		...(typeof payload?.turnCount === "number" ? { turnCount: payload.turnCount } : {}),
	};
}

function signatureKey(signals: EvolutionTraceEvidenceSlice["signals"]): string {
	return [
		`stop=${signals.stopReason ?? "unknown"}`,
		`output=${signals.outputFingerprint ?? "unknown"}`,
		`tools=${signals.toolCallCount ?? "unknown"}`,
	].join("|");
}

function rootCause(signals: EvolutionTraceEvidenceSlice["signals"], traceCount: number): string {
	const repeated = traceCount > 1 ? `Repeated in ${traceCount} traces. ` : "";
	if (signals.outputFingerprint) {
		return `${repeated}Output fingerprint diverged or changed with completion signature ${signals.outputFingerprint}.`;
	}
	if (signals.stopReason && signals.stopReason !== "stop") {
		return `${repeated}Run stopped with ${signals.stopReason}; inspect the terminal run event before promotion.`;
	}
	return `${repeated}Trace completed with the same run signature; inspect clustered events before promotion.`;
}

function stableClusterId(index: number, key: string): string {
	const cleaned = key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
	return `trace-cluster-${String(index + 1).padStart(2, "0")}${cleaned ? `-${cleaned}` : ""}`;
}

export async function distillWorkspaceTraceEvidence(cwd: string, tracePaths: readonly string[]): Promise<EvolutionTraceEvidenceSummary> {
	const resolvedCwd = resolve(cwd);
	const signatures: TraceSignature[] = [];
	for (const tracePath of tracePaths) {
		const events = await readRunTraceJsonl(tracePath);
		const signals = completedSignals(completedEvent(events));
		const relTracePath = relative(resolvedCwd, tracePath);
		signatures.push({
			tracePath: relTracePath,
			signals,
			signatureKey: signatureKey(signals),
		});
	}
	const grouped = new Map<string, TraceSignature[]>();
	for (const signature of signatures) {
		const list = grouped.get(signature.signatureKey) ?? [];
		list.push(signature);
		grouped.set(signature.signatureKey, list);
	}
	const clusters: EvolutionTraceEvidenceCluster[] = [...grouped.entries()]
		.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
		.map(([key, group], index) => {
			const signals = group[0]?.signals ?? {};
			return {
				id: stableClusterId(index, key),
				traceCount: group.length,
				tracePaths: group.map((item) => item.tracePath).sort(),
				rootCause: rootCause(signals, group.length),
				signals,
			};
		});
	const clusterByTracePath = new Map<string, EvolutionTraceEvidenceCluster>();
	for (const cluster of clusters) {
		for (const tracePath of cluster.tracePaths) clusterByTracePath.set(tracePath, cluster);
	}
	const slicesByTracePath: Record<string, EvolutionTraceEvidenceSlice> = {};
	for (const signature of signatures) {
		const cluster = clusterByTracePath.get(signature.tracePath);
		if (!cluster) continue;
		slicesByTracePath[signature.tracePath] = {
			clusterId: cluster.id,
			rootCause: cluster.rootCause,
			tracePath: signature.tracePath,
			signals: signature.signals,
		};
	}
	return {
		schemaVersion: 1,
		createdBy: "evolution_trace_distillation",
		traceCount: tracePaths.length,
		clusters,
		slicesByTracePath,
	};
}
