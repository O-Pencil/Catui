/**
 * [WHO]: Verifies NanoMem insights report generation and Claude-style section merging
 * [FROM]: Depends on node:test, node:assert, NanoMemEngine, full-insights, store helpers
 * [TO]: Guards /mem-insights report behavior and structured LLM section generation
 * [HERE]: packages/mem-core/test/insights-report.test.ts - focused insight report regression coverage
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NanoMemEngine } from "../src/engine.js";
import { buildFullInsightsReport, type ExportAllResult } from "../src/full-insights.js";
import { saveEntries } from "../src/store.js";
import type { Episode, MemoryEntry, WorkEntry } from "../src/types.js";

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

function makeEpisode(): Episode {
	return {
		sessionId: "s1",
		project: "demo/project",
		date: "2026-01-01",
		startedAt: "2026-01-01T00:00:00.000Z",
		endedAt: "2026-01-01T00:10:00.000Z",
		summary: "Built a report pipeline.",
		userGoal: "Improve insights",
		filesModified: ["src/report.ts"],
		toolsUsed: { read: 3, edit: 2 },
		keyObservations: [],
		errors: ["schema mismatch"],
		tags: ["insights"],
		importance: 8,
		consolidated: false,
	};
}

function makeWork(): WorkEntry {
	return {
		id: "work-1",
		goal: "Improve insights report",
		summary: "Added sectioned report generation",
		project: "demo/project",
		tags: ["insights"],
		importance: 8,
		created: "2026-01-01T00:00:00.000Z",
		accessCount: 0,
	};
}

test("generateFullInsights merges Claude-style parallel section output", async () => {
	const calls: string[] = [];
	const all: ExportAllResult = {
		knowledge: [],
		lessons: [
			makeFacet("lesson:json", {
				type: "lesson",
				summary: "Require JSON-only outputs for report sections.",
			}),
		],
		preferences: [],
		facets: [
			makeFacet("pattern:sections", {
				type: "pattern",
				facetData: {
					kind: "pattern",
					trigger: "insights reports get too broad",
					behavior: "split analysis into section-specific prompts",
				},
			}),
			makeFacet("struggle:single-prompt", {
				type: "struggle",
				summary: "Single prompt report generation is shallow",
				facetData: {
					kind: "struggle",
					problem: "Single prompt report generation is shallow",
					attempts: ["asked for all sections at once"],
					solution: "",
				},
			}),
		],
		work: [makeWork()],
		episodes: [makeEpisode()],
		meta: { totalSessions: 1, version: 1 },
	};

	const llm = async (_system: string, user: string): Promise<string> => {
		calls.push(user);
		if (user.includes('"quickWins"')) {
			return JSON.stringify({
				working: "Sectioned analysis is working.",
				hindering: "Single prompt reports are too shallow.",
				quickWins: "Keep JSON schemas per section.",
				ambitious: "Prepare richer session-facet analysis.",
			});
		}
		if (user.includes('"descriptions"')) return JSON.stringify({ descriptions: ["LLM project area description"] });
		if (user.includes('"wins"')) return JSON.stringify({ wins: [{ title: "Sectioned Analysis", description: "The report now asks focused questions per section." }] });
		if (user.includes('"frictions"')) return JSON.stringify({ frictions: [{ title: "One Big Prompt", description: "Broad prompts bury concrete friction.", examples: ["single prompt report generation"] }] });
		if (user.includes('"recommendations"')) return JSON.stringify({ recommendations: ["Keep each report section independently structured."] });
		if (user.includes('"featuresToTry"')) return JSON.stringify({ featuresToTry: [{ title: "Custom skill", oneLiner: "Turns repeat report review into a command", whyForYou: "You repeat insight report review.", exampleCode: "/mem-insights report.html" }] });
		if (user.includes('"usagePatterns"')) return JSON.stringify({ usagePatterns: [{ title: "Section first", summary: "Ask one section at a time", detail: "Generate facts before narrative.", pastePrompt: "Analyze this as separate sections first." }] });
		return "{}";
	};

	const report = await buildFullInsightsReport(all, llm, "en");

	assert.equal(calls.length, 7);
	assert.equal(report.projectAreas[0]?.description, "LLM project area description");
	assert.equal(report.wins[0]?.title, "Sectioned Analysis");
	assert.equal(report.frictions[0]?.title, "One Big Prompt");
	assert.equal(report.recommendations[0], "Keep each report section independently structured.");
	assert.equal(report.featuresToTry[0]?.title, "Custom skill");
	assert.equal(report.usagePatterns[0]?.title, "Section first");
	assert.equal(report.atAGlance.working, "Sectioned analysis is working.");
});
