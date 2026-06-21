import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { onTasksUpdated, startTaskFileWatcher, stopTaskFileWatcher } from "../extensions/builtin/task/task-store.js";

function createTempDir(): string {
	return mkdtempSync(join(tmpdir(), "catui-task-poll-"));
}

function cleanup(path: string): void {
	rmSync(path, { recursive: true, force: true });
}

test("task-store polling only notifies when disk state actually changes", async () => {
	const dir = createTempDir();
	let notifyCount = 0;
	const unsubscribe = onTasksUpdated(() => {
		notifyCount += 1;
	});

	try {
		startTaskFileWatcher(dir);

		// Wait for the initial snapshot seed to settle (startTaskFileWatcher
		// seeds the snapshot asynchronously).
		await new Promise((resolve) => setTimeout(resolve, 50));

		const baseline = notifyCount;

		// Wait for at least one poll cycle (5s) without any disk changes.
		// The diff guard should suppress the notification.
		await new Promise((resolve) => setTimeout(resolve, 5500));

		assert.equal(
			notifyCount,
			baseline,
			"no notification should fire when disk state has not changed",
		);

		// Now write a task file and wait for the next poll cycle.
		writeFileSync(join(dir, "1.json"), JSON.stringify({ id: "1", subject: "new", status: "pending" }));
		await new Promise((resolve) => setTimeout(resolve, 5500));

		assert.ok(
			notifyCount > baseline,
			"notification should fire after a disk change",
		);
	} finally {
		unsubscribe();
		stopTaskFileWatcher(dir);
		cleanup(dir);
	}
});
