import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import nanomemExtension from "../src/extension.js";

test("nanomem_remember stores explicit preferences through a traceable tool", async () => {
	const previousMemoryDir = process.env.NANOMEM_MEMORY_DIR;
	const memoryDir = await mkdtemp(join(tmpdir(), "nanomem-remember-tool-"));
	process.env.NANOMEM_MEMORY_DIR = memoryDir;
	try {
		const tools = new Map<string, any>();
		const api = {
			on: () => {},
			registerCommand: () => {},
			registerTool: (tool: any) => tools.set(tool.name, tool),
		};

		nanomemExtension(api as never);
		const tool = tools.get("nanomem_remember");
		assert.ok(tool, "nanomem_remember tool should be registered");

		const result = await tool.execute("call-remember", {
			type: "preference",
			name: "Chinese output",
			summary: "User prefers all assistant output in Chinese",
			detail: "The user wants all future assistant output to be written in Chinese.",
		});

		assert.match(result.content[0].text, /Remembered preference/);
		const preferences = JSON.parse(await readFile(join(memoryDir, "preferences.json"), "utf8")) as Array<{ type: string; summary: string; detail: string }>;
		assert.ok(preferences.some((entry) =>
			entry.type === "preference" &&
			entry.summary.includes("Chinese") &&
			entry.detail.includes("Chinese"),
		));
	} finally {
		if (previousMemoryDir === undefined) {
			delete process.env.NANOMEM_MEMORY_DIR;
		} else {
			process.env.NANOMEM_MEMORY_DIR = previousMemoryDir;
		}
		await rm(memoryDir, { recursive: true, force: true });
	}
});
