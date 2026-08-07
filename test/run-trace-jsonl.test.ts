import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonlRunTraceSink, readRunTraceJsonl } from "../core/runtime/run-trace-jsonl.js";
import type { RunTraceEventV1 } from "@catui/agent-core";

const started: RunTraceEventV1 = {
	version: 1, eventId: "e1", sequence: 1, timestamp: 1, runId: "r1", kind: "run.started",
	payload: { loopFramework: "standard", inputFingerprint: "sha256:in" },
};

test("JSONL trace storage round trips validated events with owner-only permissions", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-trace-"));
	try {
		const path = join(directory, "run.jsonl");
		const sink = new JsonlRunTraceSink(path);
		await sink.append(started);
		await sink.append({ ...started, eventId: "e2", sequence: 2, kind: "run.completed", payload: { stopReason: "stop", turnCount: 0, toolCallCount: 0, outputFingerprint: "sha256:out" } });
		assert.deepEqual(await readRunTraceJsonl(path), [started, { ...started, eventId: "e2", sequence: 2, kind: "run.completed", payload: { stopReason: "stop", turnCount: 0, toolCallCount: 0, outputFingerprint: "sha256:out" } }]);
		assert.equal((await stat(path)).mode & 0o777, 0o600);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("JSONL trace reader rejects invalid JSON, unsupported versions, and sequence gaps", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-trace-invalid-"));
	try {
		const path = join(directory, "run.jsonl");
		await writeFile(path, "not-json\n", "utf8");
		await assert.rejects(readRunTraceJsonl(path), /line 1/i);
		await writeFile(path, `${JSON.stringify({ ...started, version: 2 })}\n`, "utf8");
		await assert.rejects(readRunTraceJsonl(path), /version/i);
		await writeFile(path, `${JSON.stringify(started)}\n${JSON.stringify({ ...started, eventId: "e3", sequence: 3 })}\n`, "utf8");
		await assert.rejects(readRunTraceJsonl(path), /sequence/i);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("JSONL trace storage enforces line and file byte limits", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-trace-limit-"));
	try {
		const path = join(directory, "run.jsonl");
		await assert.rejects(new JsonlRunTraceSink(path, { maxLineBytes: 16 }).append(started), /line/i);
		await writeFile(path, `${JSON.stringify(started)}\n`, "utf8");
		await assert.rejects(readRunTraceJsonl(path, { maxFileBytes: 16 }), /file/i);
		await assert.rejects(readRunTraceJsonl(path, { maxLineBytes: 16 }), /line/i);
		assert.match(await readFile(path, "utf8"), /run.started/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
