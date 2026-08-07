import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileCheckpointStore } from "../core/runtime/checkpoint-store.js";

test("filesystem checkpoint store survives reconstruction and consumes once", async () => {
	const directory = mkdtempSync(join(tmpdir(), "catui-checkpoints-"));
	try {
		const first = new FileCheckpointStore(directory);
		await first.save({
			version: 1,
			id: "safe-id",
			createdAt: 100,
			expiresAt: 200,
			policyId: "approval",
			toolCall: { id: "call-1", name: "bash", input: { command: "deploy" } },
		});
		const second = new FileCheckpointStore(directory);
		assert.equal((await second.consume("safe-id", 150))?.toolCall.name, "bash");
		assert.equal(await first.consume("safe-id", 150), undefined);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("filesystem checkpoint store rejects unsafe ids", async () => {
	const directory = mkdtempSync(join(tmpdir(), "catui-checkpoints-"));
	try {
		const store = new FileCheckpointStore(directory);
		await assert.rejects(() => store.consume("../escape"), /checkpoint id/i);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("filesystem checkpoint store preserves a conditionally rejected claim", async () => {
	const directory = mkdtempSync(join(tmpdir(), "catui-checkpoints-"));
	try {
		const store = new FileCheckpointStore(directory);
		await store.save({
			version: 1, id: "guarded", createdAt: 100, policyId: "approval",
			toolCall: { id: "call-1", name: "bash", input: {} },
		});
		assert.equal(await store.consume("guarded", 101, () => false), undefined);
		assert.equal((await store.consume("guarded", 101, () => true))?.id, "guarded");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
