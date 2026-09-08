/**
 * [WHO]: Regression coverage for the interactive evolution remote-push settings toggle IO
 * [FROM]: Node test/assert/fs and modes/interactive/services/evolution-settings.ts
 * [TO]: Required harness test command and CI
 * [HERE]: test/evolution-settings-toggle.test.ts - settings toggle contract
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEvolutionRemotePush, setEvolutionRemotePush } from "../modes/interactive/services/evolution-settings.js";

test("evolution remote push toggle is hidden when unconfigured and defaults to false for legacy configs", async t => {
	const root = await mkdtemp(join(tmpdir(), "catui-evolution-settings-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	assert.equal(readEvolutionRemotePush(root), undefined);

	const dir = join(root, "evolution", "source");
	await rm(dir, { recursive: true, force: true }).catch(() => {});
	const { mkdir } = await import("node:fs/promises");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "config.json"), JSON.stringify({ version: 1, enabled: true, autoMerge: true }));
	assert.equal(readEvolutionRemotePush(root), false);

	await writeFile(join(dir, "config.json"), JSON.stringify({ version: 1, enabled: true, allowRemotePush: true }));
	assert.equal(readEvolutionRemotePush(root), true);

	await writeFile(join(dir, "config.json"), "{corrupt");
	assert.equal(readEvolutionRemotePush(root), undefined);
});

test("toggling remote push preserves the rest of the config and leaves no temporary files", async t => {
	const root = await mkdtemp(join(tmpdir(), "catui-evolution-settings-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const dir = join(root, "evolution", "source");
	const { mkdir } = await import("node:fs/promises");
	await mkdir(dir, { recursive: true });
	const path = join(dir, "config.json");
	await writeFile(path, JSON.stringify({ version: 1, enabled: true, autoMerge: true, allowRemotePush: false, model: "test/model" }, null, 2));

	setEvolutionRemotePush(true, root);
	const after = JSON.parse(await readFile(path, "utf8"));
	assert.equal(after.allowRemotePush, true);
	assert.equal(after.model, "test/model");
	assert.equal(after.autoMerge, true);
	assert.deepEqual((await readdir(dir)).sort(), ["config.json"]);

	setEvolutionRemotePush(false, root);
	assert.equal(JSON.parse(await readFile(path, "utf8")).allowRemotePush, false);
});
