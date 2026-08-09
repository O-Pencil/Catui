/**
 * [WHO]: Provides runEvolutionGate(), runCandidateEvalFixtureGate(), and EvolutionGateRunner for deterministic self-evolution promotion checks
 * [FROM]: Depends on core harness-eval runner, built-in offline fixtures, and active evolved eval_fixture artifacts
 * [TO]: Consumed by evolution_refine and turn_end auto-promotion paths
 * [HERE]: extensions/optional/evolution/evolution-gate.ts - eval gate adapter for controlled self-evolution
 */

import { runHarnessEval } from "../../../core/harness-eval/runner.js";
import { BUILTIN_HARNESS_EVAL_FIXTURES, BUILTIN_HARNESS_EVAL_MANIFEST } from "../../../core/harness-eval/scenarios.js";
import type { HarnessEvalFixture, HarnessEvalFixtureResult, HarnessEvalManifest, HarnessEvalReport, HarnessEvalScenarioManifest } from "../../../core/harness-eval/types.js";
import { getEvolutionScopeRoot, loadActiveEvalFixtureArtifacts, loadActiveEvolutionArtifacts } from "./evolution-store.js";
import type { EvolutionCandidate, EvolutionGateReport } from "./evolution-types.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface EvolutionGateContext {
	agentDir?: string;
	cwd?: string;
	sessionId?: string;
}

export type EvolutionGateRunner = (candidate: EvolutionCandidate, context?: EvolutionGateContext) => Promise<EvolutionGateReport>;

function readJson(filePath: string): unknown {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function fixtureResult(value: unknown, fixtureId: string): HarnessEvalFixtureResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Project evolution eval fixture is invalid: ${fixtureId}`);
	const record = value as Record<string, unknown>;
	if (!Array.isArray(record.recorded)) throw new Error(`Project evolution eval fixture missing recorded trace: ${fixtureId}`);
	if (record.observed !== undefined && !Array.isArray(record.observed)) throw new Error(`Project evolution eval fixture observed trace is invalid: ${fixtureId}`);
	if (record.policyViolations !== undefined && (typeof record.policyViolations !== "number" || record.policyViolations < 0)) {
		throw new Error(`Project evolution eval fixture policyViolations is invalid: ${fixtureId}`);
	}
	return {
		recorded: record.recorded as HarnessEvalFixtureResult["recorded"],
		...(record.observed ? { observed: record.observed as HarnessEvalFixtureResult["observed"] } : {}),
		...(record.policyViolations !== undefined ? { policyViolations: record.policyViolations } : {}),
	};
}

function projectFixtureMap(value: unknown): Readonly<Record<string, HarnessEvalFixture>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Project evolution eval fixtures must be an object");
	const fixtures: Record<string, HarnessEvalFixture> = {};
	for (const [id, fixture] of Object.entries(value)) {
		fixtures[id] = async () => fixtureResult(fixture, id);
	}
	return fixtures;
}

function evolvedFixtureMap(artifacts: ReturnType<typeof loadActiveEvolutionArtifacts>): {
	manifest: HarnessEvalManifest;
	fixtures: Readonly<Record<string, HarnessEvalFixture>>;
} | undefined {
	const seen = new Set<string>();
	const evalArtifacts = artifacts.filter((artifact) => {
		if (artifact.kind !== "eval_fixture") return false;
		if (seen.has(artifact.id)) return false;
		seen.add(artifact.id);
		return true;
	});
	if (evalArtifacts.length === 0) return undefined;
	const fixtures: Record<string, HarnessEvalFixture> = {};
	const scenarios: HarnessEvalScenarioManifest[] = [];
	for (const artifact of evalArtifacts) {
		const parsed = fixtureResult(JSON.parse(artifact.content), artifact.id);
		const fixtureId = artifact.id;
		const scenarioId = typeof artifact.metadata?.scenarioId === "string" ? artifact.metadata.scenarioId : artifact.id;
		fixtures[fixtureId] = async () => parsed;
		scenarios.push({ id: scenarioId, fixture: fixtureId, frameworks: "both" });
	}
	return {
		manifest: {
			version: 1,
			thresholds: { minimumPassRate: 1, maximumReplayDivergences: 0, maximumPolicyViolations: 0, maximumUnpairedToolCalls: 0 },
			scenarios,
		},
		fixtures,
	};
}

function reportFailure(name: string, error: unknown): EvolutionGateReport {
	return {
		name,
		passed: false,
		checkedAt: new Date().toISOString(),
		metrics: { passRate: 0, replayDivergences: 0, policyViolations: 0, unpairedToolCalls: 0 },
		failure: error instanceof Error ? error.message : String(error),
	};
}

function gateReport(name: string, report: HarnessEvalReport): EvolutionGateReport {
	return {
		name,
		passed: report.passed,
		checkedAt: new Date().toISOString(),
		metrics: report.metrics,
		...(report.streams ? {
			streams: report.streams.map((stream) => ({
				id: stream.id,
				mode: stream.mode,
				passed: stream.passed,
				metrics: stream.metrics,
			})),
		} : {}),
		...(report.passed ? {} : { failure: report.results.find((result) => !result.passed)?.failure ?? `${name} failed` }),
	};
}

export async function runCandidateEvalFixtureGate(content: string, scenarioId: string): Promise<EvolutionGateReport> {
	try {
		const fixture = fixtureResult(JSON.parse(content), scenarioId);
		const report = await runHarnessEval({
			version: 1,
			thresholds: { minimumPassRate: 1, maximumReplayDivergences: 0, maximumPolicyViolations: 0, maximumUnpairedToolCalls: 0 },
			scenarios: [{ id: scenarioId, fixture: scenarioId, frameworks: "both" }],
		}, { [scenarioId]: async () => fixture });
		return gateReport("candidate-eval-fixture", report);
	} catch (error) {
		return reportFailure("candidate-eval-fixture", error);
	}
}

export async function runEvolutionGate(_candidate: EvolutionCandidate, context: EvolutionGateContext = {}): Promise<EvolutionGateReport> {
	const projectManifestPath = context.cwd ? join(context.cwd, ".catui", "evolution", "eval-manifest.json") : undefined;
	if (projectManifestPath && existsSync(projectManifestPath)) {
		const projectFixturePath = join(context.cwd ?? "", ".catui", "evolution", "eval-fixtures.json");
		try {
			const report = await runHarnessEval(readJson(projectManifestPath), projectFixtureMap(readJson(projectFixturePath)));
			return gateReport("project-harness-eval", report);
		} catch (error) {
			return reportFailure("project-harness-eval", error);
		}
	}
	if (context.agentDir) {
		const roots = [
			getEvolutionScopeRoot(context.agentDir, { scope: "global" }),
			...(context.cwd ? [getEvolutionScopeRoot(context.agentDir, { scope: "workspace", cwd: context.cwd })] : []),
			...(context.sessionId ? [getEvolutionScopeRoot(context.agentDir, { scope: "session", sessionId: context.sessionId })] : []),
		];
		const evolved = evolvedFixtureMap(roots.flatMap((root) => [...loadActiveEvolutionArtifacts(root), ...loadActiveEvalFixtureArtifacts(root)]));
		if (evolved) {
			try {
				const report = await runHarnessEval(evolved.manifest, evolved.fixtures);
				return gateReport("evolved-harness-eval", report);
			} catch (error) {
				return reportFailure("evolved-harness-eval", error);
			}
		}
	}
	const report = await runHarnessEval(BUILTIN_HARNESS_EVAL_MANIFEST, BUILTIN_HARNESS_EVAL_FIXTURES);
	return gateReport("builtin-harness-eval", report);
}
