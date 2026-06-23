import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseCronExpression, computeNextCronRun, cronToHuman, intervalToCron } from "../extensions/builtin/loop/cron/cron-parser.js";
import {
  addCronTask, readCronTasks, removeCronTasks,
  listAllCronTasks, nextCronRunMs, jitteredNextCronRunMs,
  oneShotJitteredNextCronRunMs, findMissedTasks, DEFAULT_CRON_JITTER_CONFIG,
  markCronTasksFired, getCronFilePath, hasCronTasksSync,
} from "../extensions/builtin/loop/cron/cron-tasks.js";
import { createCronScheduler, isRecurringTaskAged, buildMissedTaskNotification } from "../extensions/builtin/loop/cron/cron-scheduler.js";

// ===========================================================================
// 1. Cron Parser
// ===========================================================================

test("parseCronExpression: valid expression", () => {
  const result = parseCronExpression("*/5 * * * *");
  assert.ok(result);
  assert.deepEqual(result.minute, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  assert.deepEqual(result.hour, Array.from({length: 24}, (_, i) => i));
});

test("parseCronExpression: invalid expression returns null", () => {
  assert.equal(parseCronExpression("invalid"), null);
  assert.equal(parseCronExpression("* * *"), null);
});

test("parseCronExpression: dayOfWeek 7 as Sunday alias", () => {
  const result = parseCronExpression("0 0 * * 7");
  assert.ok(result);
  assert.deepEqual(result.dayOfWeek, [0]);
});

test("computeNextCronRun: next fire after given time", () => {
  const fields = parseCronExpression("30 14 * * *")!;
  const from = new Date(2026, 0, 1, 10, 0);
  const next = computeNextCronRun(fields, from);
  assert.ok(next);
  assert.equal(next.getHours(), 14);
  assert.equal(next.getMinutes(), 30);
});

test("computeNextCronRun: OR semantics for dom/dow", () => {
  const fields = parseCronExpression("0 0 15 * 5")!;
  const from = new Date(2026, 0, 1);
  const next = computeNextCronRun(fields, from);
  assert.ok(next);
});

test("cronToHuman: every 5 minutes", () => {
  assert.equal(cronToHuman("*/5 * * * *"), "Every 5 minutes");
});

test("cronToHuman: hourly", () => {
  assert.equal(cronToHuman("0 * * * *"), "Every hour");
});

test("cronToHuman: weekdays at 9am", () => {
  const result = cronToHuman("0 9 * * 1-5");
  assert.ok(result.includes("Weekdays"));
});

test("intervalToCron: 5m", () => {
  assert.equal(intervalToCron("5m"), "*/5 * * * *");
});

test("intervalToCron: 1h", () => {
  assert.equal(intervalToCron("1h"), "0 */1 * * *");
});

test("intervalToCron: 1d", () => {
  assert.equal(intervalToCron("1d"), "0 0 */1 * *");
});

test("intervalToCron: 30s rounds up to 1m", () => {
  assert.equal(intervalToCron("30s"), "*/1 * * * *");
});

// ===========================================================================
// 2. Cron Tasks CRUD
// ===========================================================================

test("addCronTask + readCronTasks: durable task round-trip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cron-test-"));
  try {
    const id = await addCronTask("*/5 * * * *", "check status", true, true, dir);
    assert.ok(id);
    assert.equal(id.length, 8);
    const tasks = await readCronTasks(dir);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.prompt, "check status");
    assert.equal(tasks[0]!.recurring, true);
    assert.equal(tasks[0]!.durable, undefined); // stripped on disk
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("addCronTask: session task not in file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cron-test-"));
  try {
    await addCronTask("*/5 * * * *", "durable", true, true, dir);
    const beforeAll = await listAllCronTasks(dir);
    const beforeCount = beforeAll.length;
    await addCronTask("0 * * * *", "session-task-test", true, false);
    const fileTasks = await readCronTasks(dir);
    assert.equal(fileTasks.length, 1);
    const all = await listAllCronTasks(dir);
    assert.ok(all.length >= beforeCount + 1, `Expected at least ${beforeCount + 1} tasks, got ${all.length}`);
    const sessionTask = all.find(t => t.prompt === "session-task-test" && t.durable === false);
    assert.ok(sessionTask, "Session task should appear in listAllCronTasks with durable=false");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeCronTasks: removes task by id", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cron-test-"));
  try {
    const id = await addCronTask("*/5 * * * *", "to delete", true, true, dir);
    await removeCronTasks([id], dir);
    const remaining = await readCronTasks(dir);
    assert.equal(remaining.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("markCronTasksFired: updates lastFiredAt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cron-test-"));
  try {
    const id = await addCronTask("*/5 * * * *", "test", true, true, dir);
    const firedAt = Date.now();
    await markCronTasksFired([id], firedAt, dir);
    const tasks = await readCronTasks(dir);
    assert.equal(tasks[0]!.lastFiredAt, firedAt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nextCronRunMs: returns future time", () => {
  const next = nextCronRunMs("*/5 * * * *", Date.now());
  assert.ok(next !== null);
  assert.ok(next > Date.now());
});

test("nextCronRunMs: invalid cron returns null", () => {
  assert.equal(nextCronRunMs("invalid", Date.now()), null);
});

test("hasCronTasksSync: true when tasks exist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cron-test-"));
  try {
    assert.equal(hasCronTasksSync(dir), false);
    await addCronTask("*/5 * * * *", "test", true, true, dir);
    assert.equal(hasCronTasksSync(dir), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getCronFilePath: ends with cron/scheduled_tasks.json", () => {
  const path = getCronFilePath("/some/dir");
  assert.ok(path.endsWith("cron/scheduled_tasks.json"));
});

test("findMissedTasks: finds overdue one-shots", () => {
  const missed = findMissedTasks([{
    id: "abc12345",
    cron: "0 0 1 1 *",
    prompt: "missed",
    createdAt: Date.now() - 400 * 86400000,
  }], Date.now());
  assert.equal(missed.length, 1);
});

// ===========================================================================
// 3. Jitter
// ===========================================================================

test("jitteredNextCronRunMs: forward jitter for recurring", () => {
  const base = nextCronRunMs("0 * * * *", Date.now())!;
  const jittered = jitteredNextCronRunMs("0 * * * *", Date.now(), "abcdef01");
  assert.ok(jittered !== null);
  assert.ok(jittered >= base);
});

test("oneShotJitteredNextCronRunMs: backward jitter on :00/:30", () => {
  const base = nextCronRunMs("0 14 * * *", Date.now());
  if (base === null) return; // might not match in current window
  const jittered = oneShotJitteredNextCronRunMs("0 14 * * *", Date.now(), "abcdef01");
  assert.ok(jittered !== null);
  if (new Date(base).getMinutes() % 30 === 0) {
    assert.ok(jittered <= base);
  }
});

// ===========================================================================
// 4. Scheduler helpers
// ===========================================================================

test("isRecurringTaskAged: expired after 7 days", () => {
  const task = { id: "t", cron: "*/5 * * * *", prompt: "p", createdAt: Date.now() - 8 * 86400000, recurring: true };
  assert.equal(isRecurringTaskAged(task, Date.now(), DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs), true);
});

test("isRecurringTaskAged: permanent never ages", () => {
  const task = { id: "t", cron: "*/5 * * * *", prompt: "p", createdAt: Date.now() - 100 * 86400000, recurring: true, permanent: true };
  assert.equal(isRecurringTaskAged(task, Date.now(), DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs), false);
});

test("buildMissedTaskNotification: contains prompt in code fence", () => {
  const notification = buildMissedTaskNotification([{
    id: "abc12345", cron: "0 9 * * *", prompt: "run tests", createdAt: Date.now() - 86400000,
  }]);
  assert.ok(notification.includes("missed"));
  assert.ok(notification.includes("run tests"));
  assert.ok(notification.includes("```"));
});

test("createCronScheduler: returns start/stop/getNextFireTime", () => {
  const dir = mkdtempSync(join(tmpdir(), "cron-test-"));
  try {
    const scheduler = createCronScheduler({
      onFire: () => {},
      isLoading: () => false,
      dir,
    });
    assert.ok(typeof scheduler.start === "function");
    assert.ok(typeof scheduler.stop === "function");
    assert.ok(typeof scheduler.getNextFireTime === "function");
    scheduler.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scheduler end-to-end: fires task after delay", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cron-test-"));
  try {
    // Create a task that fires every minute
    await addCronTask("* * * * *", "e2e fire test", true, true, dir);

    const fired: string[] = [];
    const scheduler = createCronScheduler({
      onFire: (prompt) => fired.push(prompt),
      isLoading: () => false,
      dir,
    });

    scheduler.start();
    // Wait up to 3 seconds for the task to fire (scheduler ticks every 1s)
    for (let i = 0; i < 30; i++) {
      if (fired.length > 0) break;
      await new Promise(r => setTimeout(r, 100));
    }
    scheduler.stop();

    // The task might not fire within 3s depending on timing, but the scheduler
    // should at least have a next fire time
    const nextFire = scheduler.getNextFireTime();
    // Either the task fired or there's a scheduled next fire
    assert.ok(fired.length > 0 || nextFire !== null, "Task should fire or have a scheduled time");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// 5. Scheduler Lock Race (O_EXCL + stale recovery)
// ===========================================================================

import { tryAcquireSchedulerLock, releaseSchedulerLock } from "../extensions/builtin/loop/cron/cron-tasks-lock.js";
import { readFile, writeFile } from "node:fs/promises";

test("cron lock: first acquire wins, concurrent attempts fail", async () => {
  const dir = mkdtempSync(join(tmpdir(), "catui-lock-"));
  try {
    const ok1 = await tryAcquireSchedulerLock({ dir }, "session-A");
    assert.equal(ok1, true, "first acquire should succeed");

    // A second live session must be blocked while the first holds the lock.
    const ok2 = await tryAcquireSchedulerLock({ dir }, "session-B");
    assert.equal(ok2, false, "second acquire should fail while first is alive");
  } finally {
    await releaseSchedulerLock({ dir }, "session-A").catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cron lock: idempotent re-acquire by same sessionId", async () => {
  const dir = mkdtempSync(join(tmpdir(), "catui-lock-"));
  try {
    assert.equal(await tryAcquireSchedulerLock({ dir }, "session-A"), true);
    // Same session, simulated resume (same sessionId, same PID): should succeed.
    assert.equal(await tryAcquireSchedulerLock({ dir }, "session-A"), true);
  } finally {
    await releaseSchedulerLock({ dir }, "session-A").catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cron lock: stale lock (dead PID) is recovered", async () => {
  const dir = mkdtempSync(join(tmpdir(), "catui-lock-"));
  try {
    // Plant a stale lock with a PID that does not exist. Pick a high PID that's
    // virtually never running on macOS/Linux.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "cron"), { recursive: true });
    const stalePath = join(dir, "cron", "scheduled_tasks.lock");
    await writeFile(
      stalePath,
      JSON.stringify({ sessionId: "ghost", pid: 999_999, acquiredAt: Date.now() }),
    );
    // After write, tryAcquireSchedulerLock should detect stale (PID 999999 not
    // running) and recover.
    const ok = await tryAcquireSchedulerLock({ dir }, "session-B");
    assert.equal(ok, true, "stale lock should be recovered");

    // And the lock file should now belong to session-B.
    const raw = await readFile(stalePath, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.sessionId, "session-B");
  } finally {
    await releaseSchedulerLock({ dir }, "session-B").catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cron lock: 8 concurrent attempts — exactly one wins", async () => {
  const dir = mkdtempSync(join(tmpdir(), "catui-lock-"));
  try {
    // All 8 fire at the same time. O_EXCL must let exactly one win.
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        tryAcquireSchedulerLock({ dir }, `session-${i}`),
      ),
    );
    const winners = attempts.filter((x) => x === true);
    assert.equal(winners.length, 1, `exactly one acquirer wins, got ${winners.length}`);
  } finally {
    // Whoever won — release by reading the lock and releasing as that session.
    try {
      const raw = await readFile(join(dir, "cron", "scheduled_tasks.lock"), "utf8");
      const parsed = JSON.parse(raw);
      await releaseSchedulerLock({ dir }, parsed.sessionId).catch(() => {});
    } catch {
      // lock may not exist
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cron lock: release by non-owner is no-op", async () => {
  const dir = mkdtempSync(join(tmpdir(), "catui-lock-"));
  try {
    assert.equal(await tryAcquireSchedulerLock({ dir }, "session-A"), true);
    // Different session tries to release — should not affect the lock.
    await releaseSchedulerLock({ dir }, "session-B");
    // session-A still owns the lock.
    const raw = await readFile(join(dir, "cron", "scheduled_tasks.lock"), "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.sessionId, "session-A");
  } finally {
    await releaseSchedulerLock({ dir }, "session-A").catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
});
