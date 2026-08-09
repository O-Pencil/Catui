/**
 * [WHO]: Manifest validation, isolated/sequential/interleaved fixture execution, replay metrics, and threshold decisions
 * [FROM]: Depends on agent-core replay plus temporary filesystem workspaces
 * [TO]: Consumed by the harness eval CLI and tests
 * [HERE]: core/harness-eval/runner.ts - deterministic regression gate engine
 */
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
	HarnessEvalStreamManifest,
	HarnessEvalStreamMode,
	HarnessEvalStreamReport,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFramework(value: unknown): value is AgentLoopFramework {
	return value === "standard" || value === "weak-model-compatible";
}

function isStreamMode(value: unknown): value is HarnessEvalStreamMode {
	return value === "isolated" || value === "sequential" || value === "interleaved";
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
	if (value.streams !== undefined) {
		if (!Array.isArray(value.streams) || value.streams.length === 0) throw new Error("Harness eval streams must be a non-empty array");
		const streamIds = new Set<string>();
		for (const stream of value.streams) {
			if (!isRecord(stream) || typeof stream.id !== "string" || stream.id.length === 0 || !isStreamMode(stream.mode)) {
				throw new Error("Harness eval stream id and mode are invalid");
			}
			if (streamIds.has(stream.id)) throw new Error(`Duplicate harness eval stream: ${stream.id}`);
			streamIds.add(stream.id);
			if (!Array.isArray(stream.scenarios) || stream.scenarios.length === 0 || !stream.scenarios.every((scenario) => typeof scenario === "string" && ids.has(scenario))) {
				throw new Error(`Harness eval stream ${stream.id} references unknown scenarios`);
			}
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

function createContext(
	scenarioId: string,
	framework: AgentLoopFramework,
	workspace: string,
	stream?: { id: string; mode: HarnessEvalStreamMode; position: number },
): HarnessEvalContext {
	let clock = 0;
	let identifier = 0;
	return {
		scenarioId,
		framework,
		...(stream ? { streamId: stream.id, streamMode: stream.mode, streamPosition: stream.position } : {}),
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
	options: { workspace?: string; stream?: { id: string; mode: HarnessEvalStreamMode; position: number } } = {},
): Promise<HarnessEvalResult> {
	const ownsWorkspace = !options.workspace;
	const workspace = options.workspace ?? await mkdtemp(join(tmpdir(), `catui-eval-${scenario.id}-`));
	try {
		const result = await fixture(createContext(scenario.id, framework, workspace, options.stream));
		const replay = replayRunTrace(result.recorded, result.observed);
		const policyViolations = result.policyViolations ?? 0;
		const unpairedToolCalls = !replay.ok && replay.divergence.fieldPath.startsWith("tool.") ? 1 : 0;
		return {
			scenarioId: scenario.id,
			framework,
			...(options.stream ? { streamId: options.stream.id, streamMode: options.stream.mode, streamPosition: options.stream.position } : {}),
			passed: replay.ok && policyViolations === 0,
			...(!replay.ok ? { failure: replay.divergence.message, divergence: replay.divergence } : {}),
			policyViolations,
			unpairedToolCalls,
		};
	} catch (error: unknown) {
		return {
			scenarioId: scenario.id,
			framework,
			...(options.stream ? { streamId: options.stream.id, streamMode: options.stream.mode, streamPosition: options.stream.position } : {}),
			passed: false,
			failure: error instanceof Error ? error.message : String(error),
			policyViolations: 0,
			unpairedToolCalls: 0,
		};
	} finally {
		if (ownsWorkspace) await rm(workspace, { recursive: true, force: true });
	}
}

function metricsFor(results: readonly HarnessEvalResult[]): HarnessEvalReport["metrics"] {
	const passedCount = results.filter((result) => result.passed).length;
	return {
		passRate: results.length === 0 ? 0 : passedCount / results.length,
		replayDivergences: results.filter((result) => result.divergence !== undefined).length,
		policyViolations: results.reduce((sum, result) => sum + result.policyViolations, 0),
		unpairedToolCalls: results.reduce((sum, result) => sum + result.unpairedToolCalls, 0),
	};
}

function passesThresholds(metrics: HarnessEvalReport["metrics"], manifest: HarnessEvalManifest): boolean {
	const thresholds = manifest.thresholds;
	return (
		metrics.passRate >= thresholds.minimumPassRate &&
		metrics.replayDivergences <= thresholds.maximumReplayDivergences &&
		metrics.policyViolations <= thresholds.maximumPolicyViolations &&
		metrics.unpairedToolCalls <= thresholds.maximumUnpairedToolCalls
	);
}

function scenarioById(manifest: HarnessEvalManifest): Map<string, HarnessEvalScenarioManifest> {
	return new Map(manifest.scenarios.map((scenario) => [scenario.id, scenario]));
}

async function runStream(
	stream: HarnessEvalStreamManifest,
	manifest: HarnessEvalManifest,
	fixtures: Readonly<Record<string, HarnessEvalFixture>>,
): Promise<HarnessEvalStreamReport> {
	const scenarios = scenarioById(manifest);
	const results: HarnessEvalResult[] = [];
	const sharedWorkspace = stream.mode === "isolated" ? undefined : await mkdtemp(join(tmpdir(), `catui-eval-stream-${stream.id}-`));
	try {
		for (const [position, scenarioId] of stream.scenarios.entries()) {
			const scenario = scenarios.get(scenarioId);
			if (!scenario) throw new Error(`Harness eval stream ${stream.id} references unknown scenario: ${scenarioId}`);
			const fixture = fixtures[scenario.fixture];
			if (!fixture) throw new Error(`Harness eval fixture is not registered: ${scenario.fixture}`);
			for (const framework of frameworks(scenario)) {
				results.push(await runCase(scenario, framework, fixture, {
					workspace: sharedWorkspace,
					stream: { id: stream.id, mode: stream.mode, position },
				}));
			}
		}
	} finally {
		if (sharedWorkspace) await rm(sharedWorkspace, { recursive: true, force: true });
	}
	const metrics = metricsFor(results);
	return { id: stream.id, mode: stream.mode, results, metrics, passed: passesThresholds(metrics, manifest) };
}

export async function runHarnessEval(
	manifestInput: HarnessEvalManifest | unknown,
	fixtures: Readonly<Record<string, HarnessEvalFixture>>,
): Promise<HarnessEvalReport> {
	const manifest = validateHarnessEvalManifest(manifestInput);
	for (const scenario of manifest.scenarios) {
		if (!fixtures[scenario.fixture]) throw new Error(`Harness eval fixture is not registered: ${scenario.fixture}`);
	}
	let streamReports: HarnessEvalStreamReport[] | undefined;
	let results: HarnessEvalResult[] = [];
	if (manifest.streams && manifest.streams.length > 0) {
		streamReports = [];
		for (const stream of manifest.streams) streamReports.push(await runStream(stream, manifest, fixtures));
		results = streamReports.flatMap((stream) => stream.results);
	} else {
		for (const scenario of manifest.scenarios) {
			const fixture = fixtures[scenario.fixture];
			for (const framework of frameworks(scenario)) results.push(await runCase(scenario, framework, fixture));
		}
	}
	const metrics = metricsFor(results);
	return {
		version: 1,
		passed: passesThresholds(metrics, manifest) && (streamReports?.every((stream) => stream.passed) ?? true),
		metrics,
		results,
		...(streamReports ? { streams: streamReports } : {}),
	};
}
