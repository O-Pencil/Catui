/**
 * [WHO]: Harness eval manifests, stream scenarios, fixtures, contexts, metrics, and reports
 * [FROM]: Depends on agent-core framework and trace types
 * [TO]: Consumed by the eval runner, built-in corpus, CLI, and tests
 * [HERE]: core/harness-eval/types.ts - deterministic eval contracts
 */
import type { AgentLoopFramework, ReplayDivergence, RunTraceEventV1 } from "@catui/agent-core";

export interface HarnessEvalThresholds {
	minimumPassRate: number;
	maximumReplayDivergences: number;
	maximumPolicyViolations: number;
	maximumUnpairedToolCalls: number;
}

export interface HarnessEvalScenarioManifest {
	id: string;
	fixture: string;
	frameworks?: "both" | readonly AgentLoopFramework[];
}

export type HarnessEvalStreamMode = "isolated" | "sequential" | "interleaved";

export interface HarnessEvalStreamManifest {
	id: string;
	mode: HarnessEvalStreamMode;
	scenarios: readonly string[];
}

export interface HarnessEvalManifest {
	version: 1;
	thresholds: HarnessEvalThresholds;
	scenarios: readonly HarnessEvalScenarioManifest[];
	streams?: readonly HarnessEvalStreamManifest[];
}

export interface HarnessEvalContext {
	scenarioId: string;
	framework: AgentLoopFramework;
	streamId?: string;
	streamMode?: HarnessEvalStreamMode;
	streamPosition?: number;
	workspace: string;
	networkEnabled: false;
	now(): number;
	nextId(): string;
	fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface HarnessEvalFixtureResult {
	recorded: readonly RunTraceEventV1[];
	observed?: readonly RunTraceEventV1[];
	policyViolations?: number;
}

export type HarnessEvalFixture = (context: HarnessEvalContext) => Promise<HarnessEvalFixtureResult>;

export interface HarnessEvalResult {
	scenarioId: string;
	framework: AgentLoopFramework;
	streamId?: string;
	streamMode?: HarnessEvalStreamMode;
	streamPosition?: number;
	passed: boolean;
	failure?: string;
	divergence?: ReplayDivergence;
	policyViolations: number;
	unpairedToolCalls: number;
}

export interface HarnessEvalStreamReport {
	id: string;
	mode: HarnessEvalStreamMode;
	results: HarnessEvalResult[];
	metrics: HarnessEvalReport["metrics"];
	passed: boolean;
}

export interface HarnessEvalReport {
	version: 1;
	passed: boolean;
	metrics: {
		passRate: number;
		replayDivergences: number;
		policyViolations: number;
		unpairedToolCalls: number;
	};
	results: HarnessEvalResult[];
	streams?: HarnessEvalStreamReport[];
}
