import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createReadTool } from "../core/tools/read.js";

function createTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function getText(result: Awaited<ReturnType<ReturnType<typeof createReadTool>["execute"]>>): string {
	const block = result.content.find((content) => content.type === "text");
	assert.ok(block);
	return block.text;
}

test("read tool applies positive integer offset and limit", async () => {
	const cwd = createTempDir("nanopencil-read-");
	try {
		writeFileSync(join(cwd, "sample.txt"), "one\ntwo\nthree\nfour\n", "utf-8");
		const readTool = createReadTool(cwd);

		const result = await readTool.execute("read-lines", {
			path: "sample.txt",
			offset: 2,
			limit: 2,
		});

		assert.equal(getText(result), "two\nthree\n\n[2 more lines in file. Use offset=4 to continue.]");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("read tool rejects invalid offset and limit windows", async () => {
	const cwd = createTempDir("nanopencil-read-");
	try {
		writeFileSync(join(cwd, "sample.txt"), "one\ntwo\n", "utf-8");
		const readTool = createReadTool(cwd);

		await assert.rejects(
			() => readTool.execute("bad-offset", { path: "sample.txt", offset: 0 }),
			/offset must be a positive integer/,
		);
		await assert.rejects(
			() => readTool.execute("bad-limit", { path: "sample.txt", limit: 1.5 }),
			/limit must be a positive integer/,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
