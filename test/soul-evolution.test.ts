/**
 * [WHO]: Soul evolution trigger regression tests
 * [FROM]: Depends on node:test, packages/soul-core/src/evolution.ts, packages/soul-core/src/config.ts
 * [TO]: Consumed by repository test runner
 * [HERE]: test/soul-evolution.test.ts - guards Soul crisis trigger threshold behavior
 */

import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultConfig, getSoulConfig } from "../packages/soul-core/src/config.js";
import { SoulEvolutionEngine } from "../packages/soul-core/src/evolution.js";
import type {
	FailureMemory,
	InteractionContext,
	SoulMemory,
	SoulProfile,
} from "../packages/soul-core/src/types.js";

function createProfile(overrides: Partial<SoulProfile["stats"]> = {}): SoulProfile {
	const now = new Date("2026-01-01T00:00:00.000Z");

	return {
		id: "test-soul",
		version: 1,
		createdAt: now,
		lastEvolved: now,
		personality: {
			openness: 0.5,
			conscientiousness: 0.5,
			extraversion: 0.5,
			agreeableness: 0.5,
			neuroticism: 0.5,
			codeVerbosity: 0.5,
			abstractionLevel: 0.5,
			safetyMargin: 0.5,
			explorationDrive: 0.5,
		},
		cognitiveStyle: {
			reasoningStyle: "deductive",
			planningHorizon: "short",
			detailOrientation: "balanced",
			learningStrategy: "analytical",
		},
		values: {
			efficiency: 0.2,
			correctness: 0.2,
			simplicity: 0.2,
			maintainability: 0.2,
			innovation: 0.1,
			userExperience: 0.1,
		},
		emotionalState: {
			confidence: 0.5,
			curiosity: 0.5,
			frustration: 0.2,
			flow: 0.5,
			lastUpdate: now,
		},
		expertise: [],
		userRelationship: {
			interactionCount: 0,
			satisfactionScore: 0.5,
			communicationStyle: "technical",
			knownPreferences: [],
			firstInteraction: now,
			lastInteraction: now,
		},
		stats: {
			totalInteractions: 1,
			successRate: 0,
			avgQuality: 0,
			lastUpdate: now,
			...overrides,
		},
	};
}

function createContext(timestamp: Date): InteractionContext {
	return {
		project: "test",
		tags: ["bug-fix"],
		complexity: 0.5,
		toolUsage: {},
		timestamp,
	};
}

function createFailure(timestamp: Date): FailureMemory {
	return {
		id: `failure-${timestamp.toISOString()}`,
		category: "general",
		approach: "test",
		errorType: "tool-error",
		context: {
			domain: "test",
			complexity: 0.5,
			constraints: [],
		},
		lesson: "test failure",
		corrected: false,
		timestamp,
	};
}

function createMemory(failures: FailureMemory[]): SoulMemory {
	return {
		successes: [],
		failures,
		patterns: [],
		decisions: [],
	};
}

function createConfig(crisis: number) {
	const defaults = getDefaultConfig();
	return getSoulConfig({
		evolution: {
			...defaults.evolution,
			crisis,
		},
	});
}

test("SoulEvolutionEngine: crisis ignores a single early failure", () => {
	const config = createConfig(5);
	const engine = new SoulEvolutionEngine(config);
	const now = new Date("2026-01-01T00:10:00.000Z");

	assert.equal(
		engine.shouldEvolve(
			createProfile({ totalInteractions: 1, successRate: 0 }),
			createContext(now),
			"crisis",
			createMemory([createFailure(now)]),
		),
		false,
	);
});

test("SoulEvolutionEngine: crisis requires configured recent failure count", () => {
	const config = createConfig(3);
	const engine = new SoulEvolutionEngine(config);
	const now = new Date("2026-01-01T00:10:00.000Z");
	const failures = [
		createFailure(new Date("2026-01-01T00:08:00.000Z")),
		createFailure(new Date("2026-01-01T00:09:00.000Z")),
		createFailure(now),
	];

	assert.equal(
		engine.shouldEvolve(
			createProfile({ totalInteractions: 3, successRate: 0 }),
			createContext(now),
			"crisis",
			createMemory(failures),
		),
		true,
	);
});

test("SoulEvolutionEngine: crisis ignores stale failure clusters", () => {
	const config = createConfig(3);
	const engine = new SoulEvolutionEngine(config);
	const now = new Date("2026-01-01T02:00:00.000Z");
	const failures = [
		createFailure(new Date("2026-01-01T00:00:00.000Z")),
		createFailure(new Date("2026-01-01T00:01:00.000Z")),
		createFailure(new Date("2026-01-01T00:02:00.000Z")),
	];

	assert.equal(
		engine.shouldEvolve(
			createProfile({ totalInteractions: 3, successRate: 0 }),
			createContext(now),
			"crisis",
			createMemory(failures),
		),
		false,
	);
});
