/**
 * [WHO]: SAL terrain scan budget regression tests
 * [FROM]: Depends on node:test, temporary filesystem fixtures, and SAL terrain builder
 * [TO]: Consumed by release verification to prevent unbounded workspace scans
 * [HERE]: test/sal-terrain-budget.test.ts - proves SAL degrades safely for oversized workspaces and files
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildTerrainIndex, isSnapshotStale } from "../extensions/builtin/sal/terrain.js";

test("SAL terrain: refuses to recursively scan the user home directory", async () => {
	const snapshot = await buildTerrainIndex(homedir());

	assert.equal(snapshot.scan.truncated, true);
	assert.equal(snapshot.scan.reason, "unsafe-workspace-root");
	assert.equal(snapshot.scan.directoriesVisited, 0);
	assert.deepEqual(snapshot.nodes, []);
});

test("SAL terrain: stops collecting candidates at the configured file budget", async () => {
	const root = await mkdtemp(join(tmpdir(), "catui-sal-file-budget-"));
	try {
		for (let i = 0; i < 8; i += 1) {
			await writeFile(join(root, `file-${i}.ts`), `export const value${i} = ${i};\n`);
		}

		const snapshot = await buildTerrainIndex(root, {
			maxDirectories: 20,
			maxCandidateFiles: 3,
			maxFileBytes: 1024,
			maxDurationMs: 10_000,
		});

		assert.equal(snapshot.scan.truncated, true);
		assert.equal(snapshot.scan.reason, "candidate-file-budget");
		assert.equal(snapshot.scan.candidateFiles, 3);
		assert.equal(snapshot.nodes.filter((node) => node.kind === "file").length, 3);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("SAL terrain: stops descending at the configured directory budget", async () => {
	const root = await mkdtemp(join(tmpdir(), "catui-sal-dir-budget-"));
	try {
		for (let i = 0; i < 8; i += 1) {
			const dir = join(root, `module-${i}`);
			await mkdir(dir);
			await writeFile(join(dir, "index.ts"), `export const value = ${i};\n`);
		}

		const snapshot = await buildTerrainIndex(root, {
			maxDirectories: 3,
			maxCandidateFiles: 100,
			maxFileBytes: 1024,
			maxDurationMs: 10_000,
		});

		assert.equal(snapshot.scan.truncated, true);
		assert.equal(snapshot.scan.reason, "directory-budget");
		assert.equal(snapshot.scan.directoriesVisited, 3);
		assert.ok(snapshot.nodes.filter((node) => node.kind === "file").length <= 2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("SAL terrain: bounds the pending directory queue for a wide workspace", async () => {
	const root = await mkdtemp(join(tmpdir(), "catui-sal-wide-dir-budget-"));
	try {
		for (let i = 0; i < 20; i += 1) {
			await mkdir(join(root, `module-${i}`));
		}

		const options = {
			maxDirectories: 4,
			maxCandidateFiles: 100,
			maxFileBytes: 1024,
			maxDurationMs: 10_000,
		};
		const snapshot = await buildTerrainIndex(root, options);

		assert.equal(snapshot.scan.reason, "directory-budget");
		assert.equal(snapshot.scan.directoriesVisited, 4);
		assert.ok(snapshot.scan.peakPendingDirectories <= 3);
		assert.equal(await isSnapshotStale(snapshot, options), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("SAL terrain: reads only the configured prefix of source and module-map files", async () => {
	const root = await mkdtemp(join(tmpdir(), "catui-sal-read-budget-"));
	try {
		const padding = "x".repeat(512);
		await writeFile(
			join(root, "large.ts"),
			`${padding}\n/**\n * [WHO]: must stay outside the read budget\n * [FROM]: test\n * [TO]: test\n * [HERE]: test\n */\n`,
		);

		const snapshot = await buildTerrainIndex(root, {
			maxDirectories: 20,
			maxCandidateFiles: 20,
			maxFileBytes: 128,
			maxDurationMs: 10_000,
		});
		const fileNode = snapshot.nodes.find((node) => node.filePath === "large.ts");

		assert.ok(fileNode);
		assert.equal(fileNode.hasP3, false);
		assert.equal(snapshot.scan.truncatedFiles, 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("SAL terrain: returns a partial index when the scan time budget expires", async () => {
	const root = await mkdtemp(join(tmpdir(), "catui-sal-time-budget-"));
	try {
		for (let i = 0; i < 20; i += 1) {
			await writeFile(join(root, `file-${i}.ts`), `export const value${i} = ${i};\n`);
		}

		const snapshot = await buildTerrainIndex(root, {
			maxDirectories: 100,
			maxCandidateFiles: 100,
			maxFileBytes: 1024,
			maxDurationMs: 1,
		});

		assert.equal(snapshot.scan.truncated, true);
		assert.equal(snapshot.scan.reason, "time-budget");
		assert.ok(snapshot.scan.durationMs < 100);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
