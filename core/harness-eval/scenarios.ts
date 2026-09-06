/**
 * [WHO]: Built-in harness eval manifest and eight executable semantic regression fixtures
 * [FROM]: Depends on executable scripted-model fixtures in agent-fixtures.ts
 * [TO]: Consumed by scripts/harness-eval.ts and CI
 * [HERE]: core/harness-eval/scenarios.ts - required offline evaluation corpus
 */
import { EXECUTABLE_HARNESS_EVAL_FIXTURES } from "./agent-fixtures.js";
import type { HarnessEvalManifest } from "./types.js";

type ScenarioKind =
	| "policy-ordering"
	| "approval-checkpoint"
	| "livelock"
	| "tool-exception-pairing"
	| "steering-followup"
	| "recovery-continuation"
	| "compaction-boundary"
	| "concurrent-safe-tools";

const scenarioKinds: readonly ScenarioKind[] = [
	"policy-ordering",
	"approval-checkpoint",
	"livelock",
	"tool-exception-pairing",
	"steering-followup",
	"recovery-continuation",
	"compaction-boundary",
	"concurrent-safe-tools",
];

export const BUILTIN_HARNESS_EVAL_MANIFEST: HarnessEvalManifest = {
	version: 1,
	thresholds: {
		minimumPassRate: 1,
		maximumReplayDivergences: 0,
		maximumPolicyViolations: 0,
		maximumUnpairedToolCalls: 0,
	},
	scenarios: scenarioKinds.map((kind) => ({ id: kind, fixture: kind, frameworks: "both" })),
};

export const BUILTIN_HARNESS_EVAL_FIXTURES = EXECUTABLE_HARNESS_EVAL_FIXTURES;
