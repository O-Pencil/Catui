import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NanoMemEngine } from "../src/engine.js";
import { saveEntries } from "../src/store.js";
import type { MemoryEntry } from "../src/types.js";

function makeFacet(id: string, overrides: Partial<MemoryEntry>): MemoryEntry {
	return {
		id,
		type: "pattern",
		name: id,
		summary: id,
		detail: id,
		tags: ["insights"],
		project: "demo",
		importance: 8,
		created: "2026-01-01T00:00:00.000Z",
		accessCount: 2,
		...overrides,
	};
}

test("generateInsights uses the shared report path with rules-based fallback", async () => {
	const memoryDir = await mkdtemp(join(tmpdir(), "nanomem-insights-report-"));
	try {
		await saveEntries(
			join(memoryDir, "facets.json"),
			[
				makeFacet("pattern:parallel", {
					type: "pattern",
					facetData: {
						kind: "pattern",
						trigger: "large code reviews",
						behavior: "split the work across focused agents",
					},
				}),
				makeFacet("struggle:scope", {
					type: "struggle",
					summary: "Scope drift during long tasks",
					facetData: {
						kind: "struggle",
						problem: "Scope drift during long tasks",
						attempts: ["kept adding related cleanup"],
						solution: "",
					},
				}),
			],
			Number.MAX_SAFE_INTEGER,
			() => 1,
		);

		const engine = new NanoMemEngine({ memoryDir });
		const report = await engine.generateInsights();

		assert.equal(report.patterns.length, 1);
		assert.equal(report.struggles.length, 1);
		assert.match(report.recommendations.join("\n"), /split the work across focused agents/);
		assert.equal(report.stats.facets, 2);
	} finally {
		await rm(memoryDir, { recursive: true, force: true });
	}
});
