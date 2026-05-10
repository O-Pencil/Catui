import test from "node:test";
import assert from "node:assert/strict";
import { NanoMemEngine } from "../src/engine.js";
import { computeStructuralBoost } from "../src/engine-scoring-v2.js";
import { TURN_CONTEXT_GLOBAL_KEY } from "../src/turn-context.js";
import type { BaseMemoryV2 } from "../src/types-v2.js";

// These tests verify that mem-core reads structural anchors from the generic
// turn-context bus. Any extension (SAL, or a future locator) may be the producer.
// mem-core itself names no producer.

function setAnchor(value: { modulePath?: string; filePath?: string; candidatePaths?: string[] } | undefined): void {
	(globalThis as any)[TURN_CONTEXT_GLOBAL_KEY] = { structuralAnchor: value };
}

function clearAnchor(): void {
	(globalThis as any)[TURN_CONTEXT_GLOBAL_KEY] = {};
}

test("turn-context bus: currentStructuralAnchor reads only the selected anchor", () => {
	const engine = new NanoMemEngine({ structuralWeight: 0.15 });
	setAnchor({
		modulePath: "core/runtime",
		filePath: "core/runtime/agent-session.ts",
		candidatePaths: [
			"core/runtime",
			"core/runtime/agent-session.ts",
			"core/session",
			"core/session/session-manager.ts",
		],
	});

	try {
		assert.deepEqual((engine as any).currentStructuralAnchor(), {
			modulePath: "core/runtime",
			filePath: "core/runtime/agent-session.ts",
		});
	} finally {
		clearAnchor();
	}
});

test("turn-context bus: computeStructuralBoost uses episode filesModified paths", () => {
	const entry: BaseMemoryV2 & { filesModified: string[] } = {
		id: "episode:test",
		kind: "episode",
		accessCount: 0,
		importance: 7,
		salience: 7,
		confidence: 0.9,
		retention: "key-event",
		stability: "stable",
		tags: ["runtime"],
		scope: { project: "demo" },
		createdAt: "2026-04-10T00:00:00.000Z",
		updatedAt: "2026-04-10T00:00:00.000Z",
		filesModified: ["core/runtime/agent-session.ts"],
	};

	setAnchor({
		filePath: "core/runtime/agent-session.ts",
		candidatePaths: ["core/runtime/agent-session.ts"],
	});

	try {
		assert.equal(computeStructuralBoost(entry), 1);
	} finally {
		clearAnchor();
	}
});

test("turn-context bus: computeStructuralBoost uses candidatePaths for structural overlap", () => {
	const engine = new NanoMemEngine({ structuralWeight: 0.15 });
	const entry: BaseMemoryV2 = {
		id: "sem:test",
		kind: "semantic",
		accessCount: 0,
		importance: 7,
		salience: 7,
		confidence: 0.9,
		retention: "key-event",
		stability: "stable",
		tags: ["runtime"],
		scope: { project: "demo" },
		createdAt: "2026-04-10T00:00:00.000Z",
		updatedAt: "2026-04-10T00:00:00.000Z",
		structuralAnchor: {
			modulePath: "core/runtime",
			filePath: "core/runtime/sdk.ts",
		},
		evidence: [
			{
				id: "ev-1",
				sourceType: "file",
				filePath: "core/runtime/sdk.ts",
				createdAt: "2026-04-10T00:00:00.000Z",
			},
		],
	};

	setAnchor({
		modulePath: "core/runtime",
		filePath: "core/runtime/agent-session.ts",
		candidatePaths: ["core/runtime", "core/runtime/agent-session.ts"],
	});

	try {
		assert.equal((engine as any).computeStructuralBoost(entry), 1);
	} finally {
		clearAnchor();
	}
});
