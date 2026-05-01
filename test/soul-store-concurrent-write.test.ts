import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SoulStore } from "../packages/soul-core/src/store.js";
import { getSoulConfig } from "../packages/soul-core/src/config.js";
import type { SoulMemory } from "../packages/soul-core/src/types.js";

// Reproduces the concurrent-write corruption that produced the user-facing
// "Unexpected non-whitespace character after JSON at position 465309" on
// 1.13.10. Without atomic write, two SoulStore instances pointing at the same
// soulDir (parent agent + InProcessSubAgentBackend's createAgentSession both
// default to the shared dir) can race on writeFile and leave the target file
// holding [valid JSON of length N][trailing bytes from a prior longer write].
//
// With atomic tmp+rename, even worst-case interleaving gives us "last writer
// wins" — the target is always a complete JSON, never a hybrid.

function makeMemory(count: number, padBytes: number): SoulMemory {
	const successes = [];
	const padding = "x".repeat(padBytes);
	for (let i = 0; i < count; i += 1) {
		successes.push({
			id: `s-${i}`,
			category: "test",
			approach: padding,
			context: { domain: "test", complexity: "low" as const, constraints: [] },
			outcome: { iterations: 1, timeTaken: 0 },
			personalitySnapshot: {
				openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
				agreeableness: 0.5, neuroticism: 0.5, codeVerbosity: 0.5,
				abstractionLevel: 0.5, safetyMargin: 0.5, explorationDrive: 0.5,
			},
			timestamp: new Date(),
		});
	}
	return { successes, failures: [], patterns: [], decisions: [] };
}

const RETENTION = { successes: 10000, failures: 10000, patterns: 10000, decisions: 10000 };

test("SoulStore.saveMemory: 20 concurrent writes never leave file half-written", async () => {
	const dir = await mkdtemp(join(tmpdir(), "soul-concurrent-"));
	const config = getSoulConfig({ soulDir: dir });
	const memoryPath = join(dir, "memory.json");

	const stores = Array.from({ length: 4 }, () => new SoulStore(config));

	const writes: Promise<unknown>[] = [];
	for (let round = 0; round < 5; round += 1) {
		for (let s = 0; s < stores.length; s += 1) {
			const sizeVariance = 100 + ((round * stores.length + s) % 4) * 200;
			writes.push(stores[s].saveMemory(makeMemory(sizeVariance, 50), RETENTION));
		}
	}
	await Promise.all(writes);

	const raw = await readFile(memoryPath, "utf-8");
	assert.doesNotThrow(() => JSON.parse(raw), `final memory.json must be parseable, got ${raw.length} bytes`);
});

test("SoulStore: parallel saveMemory + saveProfile + saveEvolutions on same dir all stay valid", async () => {
	const dir = await mkdtemp(join(tmpdir(), "soul-concurrent-mixed-"));
	const config = getSoulConfig({ soulDir: dir });

	const a = new SoulStore(config);
	const b = new SoulStore(config);

	// Seed profile so saveProfile has a complete object to write.
	const profile = {
		id: "test", version: 1, createdAt: new Date(), lastEvolved: new Date(),
		personality: {
			openness: 0.5, conscientiousness: 0.5, extraversion: 0.5,
			agreeableness: 0.5, neuroticism: 0.5, codeVerbosity: 0.5,
			abstractionLevel: 0.5, safetyMargin: 0.5, explorationDrive: 0.5,
		},
		cognitiveStyle: {
			reasoningStyle: "deductive" as const, planningHorizon: "medium" as const,
			detailOrientation: "balanced" as const, learningStrategy: "hybrid" as const,
		},
		values: { efficiency: 0.2, correctness: 0.25, simplicity: 0.15, maintainability: 0.2, innovation: 0.1, userExperience: 0.1 },
		emotionalState: { confidence: 0.5, curiosity: 0.5, frustration: 0, flow: 0, lastUpdate: new Date() },
		expertise: [],
		userRelationship: { interactionCount: 0, satisfactionScore: 0.5, communicationStyle: "mixed" as const, knownPreferences: [], firstInteraction: new Date(), lastInteraction: new Date() },
		stats: { totalInteractions: 0, successRate: 0.5, avgQuality: 0.5, lastUpdate: new Date() },
	};

	const writes: Promise<unknown>[] = [];
	for (let i = 0; i < 8; i += 1) {
		writes.push(a.saveMemory(makeMemory(50 + i * 30, 40), RETENTION));
		writes.push(b.saveMemory(makeMemory(20 + i * 10, 60), RETENTION));
		writes.push(a.saveProfile({ ...profile, version: i }));
		writes.push(b.saveEvolutions([
			{ trigger: "natural", personalityDelta: {}, valueDelta: {}, confidence: 0.5, reasoning: `r${i}`, timestamp: new Date() },
		]));
	}
	await Promise.all(writes);

	const memRaw = await readFile(join(dir, "memory.json"), "utf-8");
	const profRaw = await readFile(join(dir, "profile.json"), "utf-8");
	const evoRaw = await readFile(join(dir, "evolutions.json"), "utf-8");
	assert.doesNotThrow(() => JSON.parse(memRaw), "memory.json must parse");
	assert.doesNotThrow(() => JSON.parse(profRaw), "profile.json must parse");
	assert.doesNotThrow(() => JSON.parse(evoRaw), "evolutions.json must parse");
});
