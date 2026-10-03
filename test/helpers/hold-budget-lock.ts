/**
 * [WHO]: A child that takes the real budget lock and holds it past the staleness window
 * [FROM]: Depends on node fs/path and the repository layout, not on the budget module
 * [TO]: Consumed by test/evolution-concurrent-budget.test.ts as a live lock owner
 * [HERE]: test/helpers/hold-budget-lock.ts - live lock owner for cross-process ownership tests
 *
 * Takes the lock the way a real owner does — the same path, the same `wx` create, its own pid
 * written inside — and then holds it. It deliberately does not import the budget module: a waiter
 * sees only a file, so simulating the owner from the file side is the faithful way to test that a
 * live owner is respected.
 *
 * Prints nothing. The parent watches the filesystem.
 */

import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [agentDir, rawMs] = process.argv.slice(2);
const holdMs = Number(rawMs ?? 500);
const lockPath = join(resolve(agentDir), "evolution", "v1", "budget.json.lock");

mkdirSync(join(resolve(agentDir), "evolution", "v1"), { recursive: true, mode: 0o700 });
const handle = openSync(lockPath, "wx", 0o600);
writeFileSync(handle, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, { encoding: "utf8" });

// Busy enough to be unambiguous, cheap enough not to stall the suite.
const until = Date.now() + holdMs;
while (Date.now() < until) { /* hold */ }

// Release the way a correct owner does, and prove the file we release is the one we took.
if (existsSync(lockPath)) {
	const mine = readFileSync(lockPath, "utf8").includes(String(process.pid));
	if (mine) unlinkSync(lockPath);
}
