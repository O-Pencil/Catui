import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	buildInsightInjection,
	loadRecentInsights,
	projectKeyFromCwd,
	storeInsight,
} from "../extensions/defaults/idle-think/insights.js";

function withMemoryDir(fn: (memoryDir: string) => Promise<void>): Promise<void> {
	const previous = process.env.NANOMEM_MEMORY_DIR;
	const memoryDir = mkdtempSync(join(tmpdir(), "idle-think-insights-"));
	process.env.NANOMEM_MEMORY_DIR = memoryDir;

	return fn(memoryDir).finally(() => {
		if (previous === undefined) {
			delete process.env.NANOMEM_MEMORY_DIR;
		} else {
			process.env.NANOMEM_MEMORY_DIR = previous;
		}
		rmSync(memoryDir, { recursive: true, force: true });
	});
}

test("idle-think insights are scoped to the current project before injection", async () => {
	await withMemoryDir(async (memoryDir) => {
		await storeInsight("Project A should be injected.", "owner/project-a");
		await storeInsight("Project B should stay out.", "owner/project-b");

		const projectA = await loadRecentInsights(5, "owner/project-a");
		const injection = await buildInsightInjection("owner/project-a");
		const raw = JSON.parse(readFileSync(join(memoryDir, "knowledge.json"), "utf-8")) as unknown[];

		assert.equal(projectA.length, 1);
		assert.match(projectA[0]?.summary ?? "", /Project A/);
		assert.match(injection ?? "", /about this project/);
		assert.match(injection ?? "", /Project A should be injected/);
		assert.doesNotMatch(injection ?? "", /Project B should stay out/);
		assert.equal(raw.length, 2);
	});
});

test("idle-think insight loading ignores malformed knowledge entries", async () => {
	await withMemoryDir(async (memoryDir) => {
		mkdirSync(memoryDir, { recursive: true });
		writeFileSync(
			join(memoryDir, "knowledge.json"),
			JSON.stringify([
				{ id: "bad-tags", type: "fact", tags: null, project: "owner/project-a" },
				{
					id: "valid-other",
					type: "fact",
					name: "other",
					summary: "Other project insight",
					detail: "Other project insight",
					tags: ["idle-think", "auto-exploration"],
					project: "owner/project-b",
					importance: 0.5,
					created: "2026-01-02T00:00:00.000Z",
					accessCount: 0,
				},
				{
					id: "valid-current",
					type: "fact",
					name: "current",
					summary: "Current project insight",
					detail: "Current project insight",
					tags: ["idle-think", "auto-exploration"],
					project: "owner/project-a",
					importance: 0.5,
					created: "2026-01-03T00:00:00.000Z",
					accessCount: 0,
				},
			]),
			"utf-8",
		);

		const insights = await loadRecentInsights(5, "owner/project-a");
		const injection = await buildInsightInjection("owner/project-a");

		assert.equal(insights.length, 1);
		assert.equal(insights[0]?.id, "valid-current");
		assert.match(injection ?? "", /Current project insight/);
		assert.doesNotMatch(injection ?? "", /Other project insight/);
	});
});

test("projectKeyFromCwd derives stable two-segment project keys", () => {
	assert.equal(projectKeyFromCwd("/Users/alice/Dev/nanoPencil"), "Dev/nanoPencil");
	assert.equal(projectKeyFromCwd("nanoPencil"), "nanoPencil");
});
