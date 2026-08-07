import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayRunTrace, type AgentLoopFramework } from "@catui/agent-core";
import type {
	HarnessEvalContext,
	HarnessEvalFixture,
	HarnessEvalManifest,
	HarnessEvalReport,
	HarnessEvalResult,
	HarnessEvalScenarioManifest,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFramework(value: unknown): value is AgentLoopFramework {
	return value === "standard" || value === "weak-model-compatible";
}

function validateThreshold(value: unknown, name: string, maximum = false): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (!maximum && value > 1)) {
		throw new Error(`Harness eval threshold ${name} is invalid`);
	}
	return value;
}

export function validateHarnessEvalManifest(value: unknown): HarnessEvalManifest {
	if (!isRecord(value)) throw new Error("Harness eval manifest must be an object");
	if (value.version !== 1) throw new Error(`Unsupported harness eval manifest version: ${String(value.version)}`);
	if (!Array.isArray(value.scenarios) || value.scenarios.length === 0) throw new Error("Harness eval manifest must define at least one scenario");
	if (!isRecord(value.thresholds)) throw new Error("Harness eval thresholds are required");
	const ids = new Set<string>();
	for (const candidate of value.scenarios) {
		if (!isRecord(candidate) || typeof candidate.id !== "string" || candidate.id.length === 0 || typeof candidate.fixture !== "string" || candidate.fixture.length === 0) {
			throw new Error("Harness eval scenario id and fixture must be non-empty strings");
		}
		if (ids.has(candidate.id)) throw new Error(`Duplicate harness eval scenario: ${candidate.id}`);
		ids.add(candidate.id);
		if (candidate.frameworks !== undefined && candidate.frameworks !== "both" && (!Array.isArray(candidate.frameworks) || candidate.frameworks.length === 0 || !candidate.frameworks.every(isFramework))) {
			throw new Error(`Harness eval scenario ${candidate.id} has invalid frameworks`);
		}
	}
	validateThreshold(value.thresholds.minimumPassRate, "minimumPassRate");
	validateThreshold(value.thresholds.maximumReplayDivergences, "maximumReplayDivergences", true);
	validateThreshold(value.thresholds.maximumPolicyViolations, "maximumPolicyViolations", true);
	validateThreshold(value.thresholds.maximumUnpairedToolCalls, "maximumUnpairedToolCalls", true);
	return value as unknown as HarnessEvalManifest;
}

function frameworks(scenario: HarnessEvalScenarioManifest): readonly AgentLoopFramework[] {
	if (scenario.frameworks === undefined || scenario.frameworks === "both") return ["standard", "weak-model-compatible"];
	return scenario.frameworks;
}

function createContext(scenarioId: string, framework: AgentLoopFramework, workspace: string): HarnessEvalContext {
	let clock = 0;
	let identifier = 0;
	return {
		scenarioId,
		framework,
		workspace,
		networkEnabled: false,
		now: () => ++clock,
		nextId: () => `eval-${++identifier}`,
		fetch: async () => { throw new Error("Network access is disabled for harness eval fixtures"); },
	};
}

async function runCase(
	scenario: HarnessEvalScenarioManifest,
	framework: AgentLoopFramework,
	fixture: HarnessEvalFixture,
): Promise<HarnessEvalResult> {
	const workspace = await mkdtemp(join(tmpdir(), `catui-eval-${scenario.id}-`));
	try {
		const result = await fixture(createContext(scenario.id, framework, workspace));
		const replay = replayRunTrace(result.recorded, result.observed);
		const policyViolations = result.policyViolations ?? 0;
		const unpairedToolCalls = !replay.ok && replay.divergence.fieldPath.startsWith("tool.") ? 1 : 0;
		return {
			scenarioId: scenario.id,
			framework,
			passed: replay.ok && policyViolations === 0,
			...(!replay.ok ? { failure: replay.divergence.message, divergence: replay.divergence } : {}),
			policyViolations,
			unpairedToolCalls,
		};
	} catch (error: unknown) {
		return {
			scenarioId: scenario.id,
			framework,
			passed: false,
			failure: error instanceof Error ? error.message : String(error),
			policyViolations: 0,
			unpairedToolCalls: 0,
		};
	} finally {
		await rm(workspace, { recursive: true, force: true });
	}
}

export async function runHarnessEval(
	manifestInput: HarnessEvalManifest | unknown,
	fixtures: Readonly<Record<string, HarnessEvalFixture>>,
): Promise<HarnessEvalReport> {
	const manifest = validateHarnessEvalManifest(manifestInput);
	for (const scenario of manifest.scenarios) {
		if (!fixtures[scenario.fixture]) throw new Error(`Harness eval fixture is not registered: ${scenario.fixture}`);
	}
	const results: HarnessEvalResult[] = [];
	for (const scenario of manifest.scenarios) {
		const fixture = fixtures[scenario.fixture];
		for (const framework of frameworks(scenario)) results.push(await runCase(scenario, framework, fixture));
	}
	const passedCount = results.filter((result) => result.passed).length;
	const metrics = {
		passRate: results.length === 0 ? 0 : passedCount / results.length,
		replayDivergences: results.filter((result) => result.divergence !== undefined).length,
		policyViolations: results.reduce((sum, result) => sum + result.policyViolations, 0),
		unpairedToolCalls: results.reduce((sum, result) => sum + result.unpairedToolCalls, 0),
	};
	const thresholds = manifest.thresholds;
	return {
		version: 1,
		passed:
			metrics.passRate >= thresholds.minimumPassRate &&
			metrics.replayDivergences <= thresholds.maximumReplayDivergences &&
			metrics.policyViolations <= thresholds.maximumPolicyViolations &&
			metrics.unpairedToolCalls <= thresholds.maximumUnpairedToolCalls,
		metrics,
		results,
	};
}
