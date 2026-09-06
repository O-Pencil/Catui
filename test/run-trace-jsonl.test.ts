import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonlRunTraceSink, persistWorkspaceRunTrace, readRunTraceJsonl, redactWorkspaceRunTraceEvent } from "../core/runtime/run-trace-jsonl.js";
import type { RunTraceEventV1 } from "@catui/agent-core";

const started: RunTraceEventV1 = {
	version: 1, eventId: "e1", sequence: 1, timestamp: 1, runId: "r1", kind: "run.started",
	payload: { loopFramework: "standard", inputFingerprint: "sha256:in" },
};

const completedTrace: RunTraceEventV1 = {
	...started,
	eventId: "e2",
	sequence: 2,
	kind: "run.completed",
	payload: { stopReason: "stop", turnCount: 1, toolCallCount: 0, outputFingerprint: "sha256:out" },
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

test("workspace trace persistence writes run-specific and latest JSONL files", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-trace-workspace-"));
	try {
		const completed: RunTraceEventV1 = {
			...started,
			eventId: "e2",
			sequence: 2,
			kind: "run.completed",
			payload: { stopReason: "stop", turnCount: 1, toolCallCount: 1, outputFingerprint: "sha256:out" },
		};
		const result = await persistWorkspaceRunTrace(directory, [started, completed]);

		assert.equal(result.runId, "r1");
		assert.match(result.runPath, /\.catui\/traces\/r1\.jsonl$/);
		assert.match(result.latestPath, /\.catui\/traces\/latest\.jsonl$/);
		assert.deepEqual(await readRunTraceJsonl(result.runPath), [started, completed]);
		assert.deepEqual(await readRunTraceJsonl(result.latestPath), [started, completed]);
		assert.equal((await stat(result.runPath)).mode & 0o777, 0o600);
		assert.equal((await stat(result.latestPath)).mode & 0o777, 0o600);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("workspace trace persistence retains clear tool inputs", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-trace-input-"));
	try {
		const requested = {
			...started,
			eventId: "e2",
			sequence: 2,
			kind: "tool.requested",
			payload: {
				toolCallId: "call-1",
				toolName: "CronCreate",
				inputFingerprint: "sha256:input",
				input: { schedule: "0 9 * * *", prompt: "Drink water", channel: "console" },
			},
		} as RunTraceEventV1;
		const completed = {
			...started,
			eventId: "e3",
			sequence: 3,
			kind: "run.completed",
			payload: { stopReason: "stop", turnCount: 1, toolCallCount: 0, outputFingerprint: "sha256:out" },
		} as RunTraceEventV1;
		const result = await persistWorkspaceRunTrace(directory, [started, requested, completed]);

		assert.deepEqual((await readRunTraceJsonl(result.latestPath))[1], requested);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("workspace trace redaction preserves semantic arguments and masks nested credentials", async () => {
	const requested = {
		...started,
		eventId: "redact-2",
		sequence: 2,
		kind: "tool.requested",
		payload: {
			toolCallId: "call-1",
			toolName: "CronCreate",
			inputFingerprint: "sha256:input",
			input: {
				cron: "0 9 * * *",
				prompt: "Run with Authorization: Bearer secret-token-value",
				command: "export AWS_SECRET_ACCESS_KEY=aws-secret-value GITHUB_TOKEN=github-secret-value NPM_TOKEN=npm-secret-value GH_TOKEN=gh-secret-value && curl -H 'Authorization: Basic dXNlcjpwYXNz' -H 'Cookie: session=abcdef' example.invalid",
				headers: {
					Authorization: "Bearer top-secret",
					OPENAI_API_KEY: "sk-abcdefghijklmnop",
					integrationSecret: "do-not-persist",
					AWS_SECRET_ACCESS_KEY: "aws-secret-value",
					DATABASE_URL: "postgres://admin:database-password@example.invalid/app",
				},
			},
		},
	} as RunTraceEventV1;

	const redacted = await redactWorkspaceRunTraceEvent(requested);
	assert.equal(redacted.kind, "tool.requested");
	if (redacted.kind !== "tool.requested") return;
	assert.deepEqual(redacted.payload.input, {
		cron: "0 9 * * *",
		prompt: "Run with Authorization: Bearer [REDACTED_SECRET]",
		command: "export AWS_SECRET_ACCESS_KEY=[REDACTED_SECRET] GITHUB_TOKEN=[REDACTED_SECRET] NPM_TOKEN=[REDACTED_SECRET] GH_TOKEN=[REDACTED_SECRET] && curl -H 'Authorization: Basic [REDACTED_SECRET]' -H 'Cookie: [REDACTED_SECRET]' example.invalid",
		headers: {
			Authorization: "[REDACTED_SECRET]",
			OPENAI_API_KEY: "[REDACTED_SECRET]",
			integrationSecret: "[REDACTED_SECRET]",
			AWS_SECRET_ACCESS_KEY: "[REDACTED_SECRET]",
			DATABASE_URL: "[REDACTED_SECRET]",
		},
	});
});

test("workspace trace persistence redacts direct untrusted events before disk", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-trace-direct-redaction-"));
	try {
		const requested = {
			...started,
			eventId: "direct-redact-2",
			sequence: 2,
			kind: "tool.requested",
			payload: {
				toolCallId: "call-1",
				toolName: "bash",
				inputFingerprint: "sha256:input",
				input: { command: "echo ok", GITHUB_TOKEN: "github-secret-value" },
			},
		} as RunTraceEventV1;
		const completed = {
			...started,
			eventId: "direct-redact-3",
			sequence: 3,
			kind: "run.completed",
			payload: { stopReason: "stop", turnCount: 0, toolCallCount: 1, outputFingerprint: "sha256:out" },
		} as RunTraceEventV1;
		const persisted = await persistWorkspaceRunTrace(directory, [started, requested, completed]);
		const disk = await readRunTraceJsonl(persisted.runPath);
		const toolRequest = disk.find((event) => event.kind === "tool.requested");
		assert.equal(toolRequest?.kind, "tool.requested");
		if (toolRequest?.kind !== "tool.requested") return;
		assert.deepEqual(toolRequest.payload.input, {
			command: "echo ok",
			GITHUB_TOKEN: "[REDACTED_SECRET]",
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("workspace trace persistence prunes the oldest run files", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-trace-retention-"));
	try {
		for (const runId of ["retention-1", "retention-2", "retention-3"]) {
			const runStarted = { ...started, runId } as RunTraceEventV1;
			const runCompleted = {
				...started,
				runId,
				eventId: "e2",
				sequence: 2,
				kind: "run.completed",
				payload: { stopReason: "stop", turnCount: 1, toolCallCount: 0, outputFingerprint: "sha256:out" },
			} as RunTraceEventV1;
			await persistWorkspaceRunTrace(directory, [runStarted, runCompleted], { maxRunFiles: 2 });
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		const traceDirectory = join(directory, ".catui", "traces");
		const files = (await readdir(traceDirectory)).filter((name) => name !== "latest.jsonl");
		assert.equal(files.length, 2);
		assert.equal((await readRunTraceJsonl(join(traceDirectory, "latest.jsonl")))[0].runId, "retention-3");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("workspace trace persistence serializes concurrent latest and retention updates", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-trace-concurrent-"));
	try {
		const runIds = Array.from({ length: 12 }, (_, index) => `concurrent-${index}`);
		await Promise.all(runIds.map((runId) => {
			const runStarted = { ...started, runId } as RunTraceEventV1;
			const runCompleted = { ...completedTrace, runId } as RunTraceEventV1;
			return persistWorkspaceRunTrace(directory, [runStarted, runCompleted], { maxRunFiles: 3 });
		}));

		const traceDirectory = join(directory, ".catui", "traces");
		const runFiles = (await readdir(traceDirectory)).filter((name) => name.endsWith(".jsonl") && name !== "latest.jsonl");
		assert.equal(runFiles.length, 3);
		assert.equal((await readRunTraceJsonl(join(traceDirectory, "latest.jsonl")))[0].runId, runIds.at(-1));
		await Promise.all(runFiles.map((name) => readRunTraceJsonl(join(traceDirectory, name))));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("workspace trace persistence rejects a symlinked trace directory without pruning outside files", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-trace-symlink-workspace-"));
	const outside = await mkdtemp(join(tmpdir(), "catui-trace-symlink-outside-"));
	const outsideFiles = [join(outside, "keep-1.jsonl"), join(outside, "keep-2.jsonl")];
	try {
		await Promise.all(outsideFiles.map((path, index) => writeFile(path, `outside-${index}\n`, "utf8")));
		await mkdir(join(directory, ".catui"));
		await symlink(outside, join(directory, ".catui", "traces"), process.platform === "win32" ? "junction" : "dir");

		await assert.rejects(
			() => persistWorkspaceRunTrace(directory, [started, completedTrace], { maxRunFiles: 1 }),
			/symbolic links/,
		);
		assert.deepEqual(
			await Promise.all(outsideFiles.map((path) => readFile(path, "utf8"))),
			["outside-0\n", "outside-1\n"],
		);
		assert.equal((await readdir(outside)).some((name) => name.includes(started.runId)), false);
	} finally {
		await rm(directory, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	}
});
