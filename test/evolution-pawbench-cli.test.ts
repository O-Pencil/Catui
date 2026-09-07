/**
 * [WHO]: Focused contract tests for the private offline PawBench evolution CLI
 * [FROM]: Depends on node test/fs helpers plus the PawBench CLI and benchmark snapshot parser
 * [TO]: Verifies bounded private import and diagnosis file workflows without extending the importer contract suite
 * [HERE]: test/evolution-pawbench-cli.test.ts - offline PawBench CLI boundary tests
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	link,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	diagnoseEvolutionBenchmarkFailures,
	verifyEvolutionFailureCohortReport,
} from "../extensions/optional/evolution/benchmark-diagnosis.ts";
import { parseBenchmarkSnapshot } from "../extensions/optional/evolution/benchmark-evidence.ts";
import {
	importPawBenchEvolutionSnapshot,
	MAX_PAWBENCH_SOURCE_BYTES,
} from "../extensions/optional/evolution/pawbench-import.ts";
import {
	PAWBENCH_CHECKPOINT_MAX_BYTES,
	runEvolutionPawBenchCli,
} from "../scripts/evolution-pawbench.ts";

function checkpointSource(): string {
	return `${JSON.stringify({
		benchmark: "pawbench",
		model: "official/test-model",
		timestamp: "2026-08-26T02:00:00.000Z",
		summary: {
			total_runs: 1,
			tasks_completed: 1,
			passed: 0,
			pass_rate: 0,
			avg_score: 0.4,
			runs_per_task: 1,
			total_time: 2,
			avg_execution_time: 2,
			total_usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3, estimated: false },
			errors: { total: 0, timed_out: 0, failed: 0 },
			by_label: {},
			"pass@1": 0,
			"pass^1": 0,
			"pass@1_count": 0,
			"pass^1_count": 0,
		},
		results: [{
			task_id: "official-task-1",
			task_name: "official fixture task",
			score: 4,
			max_score: 10,
			passed: false,
			grading_type: "weighted",
			breakdown: { correctness: 0.4 },
			notes: "private note sentinel",
			execution_time: 2,
			status: "success",
			usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3, estimated: false },
			transcript_length: 2,
			timed_out: false,
			error: "",
			anomaly: { has_error: false },
			labels: { scenario: "Coding" },
		}],
	}, null, 2)}\n`;
}

function manifestFor(source: string): Record<string, unknown> {
	return {
		schemaVersion: 1,
		kind: "catui-pawbench-import-manifest",
		sourceSha256: `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`,
		role: "candidate",
		candidateId: "candidate-private-sentinel",
		candidateContentHash: `sha256:${"c".repeat(64)}`,
		createdAt: "2026-08-26T02:05:00.000Z",
		corpus: { id: "pawbench", version: "2026.08", digest: `sha256:${"a".repeat(64)}` },
		harness: { revisionId: "pawbench-r1", commitSha: "b".repeat(40) },
		execution: {
			model: "official/test-model",
			modelVersion: "2026-08-26",
			temperature: 0,
			maxTokens: 1_024,
			timeoutMs: 60_000,
			budgetUsd: 1,
		},
		resultIndex: {
			"0": {
				repetition: 1,
				split: "heldout",
				costUsd: 0.01,
				traceAudit: { policyViolations: 0, replayDivergences: 0, unpairedToolCalls: 0 },
			},
		},
	};
}

test("CLI and direct importer share the 64 MiB PawBench checkpoint boundary", () => {
	assert.equal(MAX_PAWBENCH_SOURCE_BYTES, 64 * 1024 * 1024);
	assert.equal(PAWBENCH_CHECKPOINT_MAX_BYTES, MAX_PAWBENCH_SOURCE_BYTES);
});

test("import writes a private parser-valid snapshot and prints only role and run count", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-pawbench-cli-"));
	try {
		const checkpointPath = join(directory, "checkpoint.json");
		const manifestPath = join(directory, "manifest.json");
		const outputPath = join(directory, "nested", "snapshot.json");
		const source = checkpointSource();
		await writeFile(checkpointPath, source, "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifestFor(source))}\n`, "utf8");
		const stdout: string[] = [];
		const stderr: string[] = [];

		const exitCode = await runEvolutionPawBenchCli([
			"import",
			"--checkpoint", checkpointPath,
			"--manifest", manifestPath,
			"--output", outputPath,
		], {
			stdout: (line) => stdout.push(line),
			stderr: (line) => stderr.push(line),
		});

		assert.equal(exitCode, 0);
		assert.deepEqual(stdout, ["IMPORTED candidate 1"]);
		assert.deepEqual(stderr, []);
		assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
		const output = await readFile(outputPath, "utf8");
		assert.equal(output.endsWith("\n"), true);
		assert.equal(parseBenchmarkSnapshot(JSON.parse(output)).runs.length, 1);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("diagnose writes a private verified report with an injected canonical timestamp", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-pawbench-cli-"));
	try {
		const snapshotPath = join(directory, "snapshot.json");
		const outputPath = join(directory, "diagnosis.json");
		const source = checkpointSource();
		const snapshot = importPawBenchEvolutionSnapshot(source, manifestFor(source));
		await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`, "utf8");
		await writeFile(outputPath, "stale public output\n", { encoding: "utf8", mode: 0o644 });
		const stdout: string[] = [];
		const stderr: string[] = [];

		const exitCode = await runEvolutionPawBenchCli([
			"diagnose",
			"--snapshot", snapshotPath,
			"--output", outputPath,
		], {
			stdout: (line) => stdout.push(line),
			stderr: (line) => stderr.push(line),
			generatedAt: "2026-08-26T04:00:00.000Z",
		});

		assert.equal(exitCode, 0);
		assert.deepEqual(stdout, ["DIAGNOSED 1"]);
		assert.deepEqual(stderr, []);
		assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
		const output = await readFile(outputPath, "utf8");
		assert.equal(output.endsWith("\n"), true);
		const report = JSON.parse(output) as unknown;
		assert.equal(verifyEvolutionFailureCohortReport(report), true);
		assert.equal((report as { generatedAt: string }).generatedAt, "2026-08-26T04:00:00.000Z");
		assert.deepEqual((await readdir(directory)).sort(), ["diagnosis.json", "snapshot.json"]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("diagnose defaults generatedAt to the current canonical ISO timestamp", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-pawbench-cli-"));
	try {
		const snapshotPath = join(directory, "snapshot.json");
		const outputPath = join(directory, "diagnosis.json");
		const source = checkpointSource();
		const snapshot = importPawBenchEvolutionSnapshot(source, manifestFor(source));
		await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`, "utf8");
		const before = Date.now();

		const exitCode = await runEvolutionPawBenchCli([
			"diagnose",
			"--snapshot", snapshotPath,
			"--output", outputPath,
		], {
			stdout: () => undefined,
			stderr: () => undefined,
		});

		const after = Date.now();
		assert.equal(exitCode, 0);
		const report = JSON.parse(await readFile(outputPath, "utf8")) as { generatedAt: string };
		assert.equal(new Date(report.generatedAt).toISOString(), report.generatedAt);
		assert.ok(Date.parse(report.generatedAt) >= before);
		assert.ok(Date.parse(report.generatedAt) <= after);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("unknown and incomplete command lines return a compact usage error", async () => {
	const invalidArguments: string[][] = [
		[],
		["unknown"],
		["import", "--checkpoint", "checkpoint.json"],
		["import", "--checkpoint", "checkpoint.json", "--manifest", "manifest.json", "--output"],
		["diagnose", "--snapshot", "snapshot.json"],
		["diagnose", "--snapshot", "snapshot.json", "--output", "report.json", "extra"],
		["diagnose", "--snapshot", "snapshot.json", "--output", "report.json", "--unknown"],
		["diagnose", "--snapshot", "first.json", "--snapshot", "second.json", "--output", "report.json"],
	];
	for (const args of invalidArguments) {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const exitCode = await runEvolutionPawBenchCli(args, {
			stdout: (line) => stdout.push(line),
			stderr: (line) => stderr.push(line),
		});
		assert.equal(exitCode, 2, args.join(" "));
		assert.deepEqual(stdout, [], args.join(" "));
		assert.deepEqual(stderr, ["Evolution PawBench error: invalid arguments"], args.join(" "));
	}
});

test("invalid evidence errors do not disclose untrusted checkpoint or snapshot fields", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-pawbench-cli-"));
	try {
		const sentinels = [
			"secret-task-id",
			"private-model-name",
			"private-notes",
			"private-error-text",
			"api_key=credential-sentinel",
			"raw-input-sentinel",
		];
		const checkpointPath = join(directory, "checkpoint.json");
		const manifestPath = join(directory, "manifest.json");
		const snapshotPath = join(directory, "snapshot.json");
		const outputPath = join(directory, "output.json");
		await writeFile(checkpointPath, JSON.stringify({
			task_id: sentinels[0],
			model: sentinels[1],
			notes: sentinels[2],
			error: sentinels[3],
			credential: sentinels[4],
			contents: sentinels[5],
		}), "utf8");
		await writeFile(manifestPath, "{}\n", "utf8");
		await writeFile(snapshotPath, JSON.stringify({
			taskId: sentinels[0],
			model: sentinels[1],
			notes: sentinels[2],
			error: sentinels[3],
			credential: sentinels[4],
			contents: sentinels[5],
		}), "utf8");

		for (const args of [
			["import", "--checkpoint", checkpointPath, "--manifest", manifestPath, "--output", outputPath],
			["diagnose", "--snapshot", snapshotPath, "--output", outputPath],
		]) {
			const stdout: string[] = [];
			const stderr: string[] = [];
			const exitCode = await runEvolutionPawBenchCli(args, {
				stdout: (line) => stdout.push(line),
				stderr: (line) => stderr.push(line),
			});
			assert.equal(exitCode, 2);
			assert.deepEqual(stdout, []);
			assert.equal(stderr.length, 1);
			for (const sentinel of sentinels) {
				assert.doesNotMatch(stderr[0]!, new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
			}
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("import rejects a symlink input without following it", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-pawbench-cli-"));
	try {
		const realCheckpointPath = join(directory, "real-checkpoint.json");
		const checkpointPath = join(directory, "checkpoint-link.json");
		const manifestPath = join(directory, "manifest.json");
		const outputPath = join(directory, "snapshot.json");
		const source = checkpointSource();
		await writeFile(realCheckpointPath, source, "utf8");
		await symlink(realCheckpointPath, checkpointPath);
		await writeFile(manifestPath, `${JSON.stringify(manifestFor(source))}\n`, "utf8");
		const stdout: string[] = [];
		const stderr: string[] = [];

		const exitCode = await runEvolutionPawBenchCli([
			"import",
			"--checkpoint", checkpointPath,
			"--manifest", manifestPath,
			"--output", outputPath,
		], {
			stdout: (line) => stdout.push(line),
			stderr: (line) => stderr.push(line),
		});

		assert.equal(exitCode, 2);
		assert.deepEqual(stdout, []);
		assert.deepEqual(stderr, ["Evolution PawBench error: import failed"]);
		await assert.rejects(stat(outputPath));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("diagnose rejects FIFO, directory, and device inputs without blocking", { timeout: 2_000 }, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "catui-pawbench-cli-"));
	try {
		const fifoPath = join(directory, "snapshot.fifo");
		const fifoResult = spawnSync("mkfifo", [fifoPath], { stdio: "ignore" });
		if (fifoResult.error !== undefined || fifoResult.status !== 0) {
			t.diagnostic("mkfifo is unavailable; FIFO assertion skipped");
		} else {
			const stderr: string[] = [];
			const exitCode = await runEvolutionPawBenchCli([
				"diagnose",
				"--snapshot", fifoPath,
				"--output", join(directory, "fifo-output.json"),
			], {
				stdout: () => undefined,
				stderr: (line) => stderr.push(line),
			});
			assert.equal(exitCode, 2);
			assert.deepEqual(stderr, ["Evolution PawBench error: diagnosis failed"]);
		}

		const directoryInput = join(directory, "snapshot-directory");
		await mkdir(directoryInput);
		for (const [name, snapshotPath] of [["directory", directoryInput], ["device", "/dev/null"]] as const) {
			const stderr: string[] = [];
			const exitCode = await runEvolutionPawBenchCli([
				"diagnose",
				"--snapshot", snapshotPath,
				"--output", join(directory, `${name}-output.json`),
			], {
				stdout: () => undefined,
				stderr: (line) => stderr.push(line),
			});
			assert.equal(exitCode, 2);
			assert.deepEqual(stderr, ["Evolution PawBench error: diagnosis failed"]);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("import rejects lexical aliases, hardlink aliases, and symlink output destinations", async (t) => {
	for (const kind of ["same-path", "hardlink", "symlink", "directory"] as const) {
		await t.test(kind, async () => {
			const directory = await mkdtemp(join(tmpdir(), "catui-pawbench-cli-"));
			try {
				const checkpointPath = join(directory, "checkpoint.json");
				const manifestPath = join(directory, "manifest.json");
				const ordinaryOutputPath = join(directory, "snapshot.json");
				const symlinkTargetPath = join(directory, "existing-artifact.json");
				const source = checkpointSource();
				await writeFile(checkpointPath, source, "utf8");
				await writeFile(manifestPath, `${JSON.stringify(manifestFor(source))}\n`, "utf8");
				let outputPath = ordinaryOutputPath;
				if (kind === "same-path") outputPath = join(directory, "unused", "..", "checkpoint.json");
				if (kind === "hardlink") await link(checkpointPath, outputPath);
				if (kind === "symlink") {
					await writeFile(symlinkTargetPath, "preserved artifact\n", "utf8");
					await symlink(symlinkTargetPath, outputPath);
				}
				if (kind === "directory") await mkdir(outputPath);

				const stdout: string[] = [];
				const stderr: string[] = [];
				const exitCode = await runEvolutionPawBenchCli([
					"import",
					"--checkpoint", checkpointPath,
					"--manifest", manifestPath,
					"--output", outputPath,
				], {
					stdout: (line) => stdout.push(line),
					stderr: (line) => stderr.push(line),
				});

				assert.equal(exitCode, 2);
				assert.deepEqual(stdout, []);
				assert.deepEqual(stderr, ["Evolution PawBench error: import failed"]);
				assert.equal(await readFile(checkpointPath, "utf8"), source);
				if (kind === "symlink") {
					assert.equal(await readFile(symlinkTargetPath, "utf8"), "preserved artifact\n");
				}
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		});
	}
});

test("failed validation preserves an existing artifact and leaves no temporary output", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-pawbench-cli-"));
	try {
		const snapshotPath = join(directory, "invalid-snapshot.json");
		const outputPath = join(directory, "existing-report.json");
		const source = checkpointSource();
		const validSnapshot = importPawBenchEvolutionSnapshot(source, manifestFor(source));
		const validReport = diagnoseEvolutionBenchmarkFailures(validSnapshot, {
			generatedAt: "2026-08-26T04:30:00.000Z",
		});
		assert.equal(verifyEvolutionFailureCohortReport(validReport), true);
		const originalArtifact = `${JSON.stringify(validReport, null, 2)}\n`;
		await writeFile(snapshotPath, "{}\n", "utf8");
		await writeFile(outputPath, originalArtifact, "utf8");
		const stderr: string[] = [];

		const exitCode = await runEvolutionPawBenchCli([
			"diagnose",
			"--snapshot", snapshotPath,
			"--output", outputPath,
		], {
			stdout: () => undefined,
			stderr: (line) => stderr.push(line),
		});

		assert.equal(exitCode, 2);
		assert.deepEqual(stderr, ["Evolution PawBench error: diagnosis failed"]);
		assert.equal(await readFile(outputPath, "utf8"), originalArtifact);
		assert.deepEqual((await readdir(directory)).sort(), ["existing-report.json", "invalid-snapshot.json"]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("import rejects invalid UTF-8 bytes before lossy decoding can satisfy the manifest digest", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-pawbench-cli-"));
	try {
		const checkpointPath = join(directory, "checkpoint.json");
		const manifestPath = join(directory, "manifest.json");
		const outputPath = join(directory, "snapshot.json");
		const validBytes = Buffer.from(checkpointSource(), "utf8");
		const marker = Buffer.from("private note sentinel", "utf8");
		const markerOffset = validBytes.indexOf(marker);
		assert.notEqual(markerOffset, -1);
		const invalidBytes = Buffer.concat([
			validBytes.subarray(0, markerOffset),
			Buffer.from([0xc3, 0x28]),
			validBytes.subarray(markerOffset + marker.length),
		]);
		const lossySource = invalidBytes.toString("utf8");
		assert.doesNotThrow(() => JSON.parse(lossySource));
		await writeFile(checkpointPath, invalidBytes);
		await writeFile(manifestPath, `${JSON.stringify(manifestFor(lossySource))}\n`, "utf8");
		const stdout: string[] = [];
		const stderr: string[] = [];

		const exitCode = await runEvolutionPawBenchCli([
			"import",
			"--checkpoint", checkpointPath,
			"--manifest", manifestPath,
			"--output", outputPath,
		], {
			stdout: (line) => stdout.push(line),
			stderr: (line) => stderr.push(line),
		});

		assert.equal(exitCode, 2);
		assert.deepEqual(stdout, []);
		assert.deepEqual(stderr, ["Evolution PawBench error: import failed"]);
		await assert.rejects(stat(outputPath));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("oversized sparse checkpoint, manifest, and snapshot files are refused before JSON parsing", async () => {
	const directory = await mkdtemp(join(tmpdir(), "catui-pawbench-cli-"));
	try {
		const checkpointPath = join(directory, "checkpoint.json");
		const manifestPath = join(directory, "manifest.json");
		const snapshotPath = join(directory, "snapshot.json");
		const outputPath = join(directory, "output.json");
		await writeFile(checkpointPath, "not-json", "utf8");
		await writeFile(manifestPath, "not-json", "utf8");
		await writeFile(snapshotPath, "not-json", "utf8");

		const cases: Array<{ args: string[]; oversizePath: string; bytes: number }> = [
			{
				args: ["import", "--checkpoint", checkpointPath, "--manifest", manifestPath, "--output", outputPath],
				oversizePath: checkpointPath,
				bytes: 64 * 1024 * 1024 + 1,
			},
			{
				args: ["import", "--checkpoint", checkpointPath, "--manifest", manifestPath, "--output", outputPath],
				oversizePath: manifestPath,
				bytes: 16 * 1024 * 1024 + 1,
			},
			{
				args: ["diagnose", "--snapshot", snapshotPath, "--output", outputPath],
				oversizePath: snapshotPath,
				bytes: 64 * 1024 * 1024 + 1,
			},
		];

		for (const fixture of cases) {
			await truncate(checkpointPath, fixture.oversizePath === checkpointPath ? fixture.bytes : 8);
			await truncate(manifestPath, fixture.oversizePath === manifestPath ? fixture.bytes : 8);
			await truncate(snapshotPath, fixture.oversizePath === snapshotPath ? fixture.bytes : 8);
			const stdout: string[] = [];
			const stderr: string[] = [];
			const exitCode = await runEvolutionPawBenchCli(fixture.args, {
				stdout: (line) => stdout.push(line),
				stderr: (line) => stderr.push(line),
			});

			assert.equal(exitCode, 2);
			assert.deepEqual(stdout, []);
			assert.deepEqual(stderr, ["Evolution PawBench error: input exceeds size limit"]);
			await assert.rejects(stat(outputPath));
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
