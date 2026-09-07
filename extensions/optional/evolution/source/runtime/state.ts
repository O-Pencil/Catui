/**
 * [WHO]: Atomic durable state, single-supervisor lease and pre-call budget reservation
 * [FROM]: Node filesystem, proper-lockfile and local state contracts
 * [TO]: Source evolution supervisor and delivery workers
 * [HERE]: extensions/optional/evolution/source/runtime/state.ts - persistence owner
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import type { SourceConfig, SourceState } from "../types.js";
import { calendar } from "./config.js";

export async function atomicJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.${randomUUID()}.tmp`;
	await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
	await rename(tmp, path);
}
export async function readJson<T>(path: string): Promise<T | undefined> {
	try { return JSON.parse(await readFile(path, "utf8")) as T; }
	catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; }
}
export async function loadState(root: string): Promise<SourceState> {
	const state = await readJson<SourceState>(join(root, "state.json"));
	if (state && (state.version !== 1 || !Array.isArray(state.jobs) || !Array.isArray(state.observations))) throw new Error("Invalid source evolution ledger; refusing to reset it");
	return state ?? { version: 1, observations: [], jobs: [], budgets: {}, seen: [], dropped: 0 };
}
const saves = new Map<string, Promise<void>>();
export function saveState(root: string, state: SourceState): Promise<void> {
	const next = (saves.get(root) ?? Promise.resolve()).catch(() => {}).then(() => atomicJson(join(root, "state.json"), state));
	saves.set(root, next);
	return next;
}
export async function supervisorLease(root: string): Promise<() => Promise<void>> {
	await mkdir(root, { recursive: true, mode: 0o700 });
	return lockfile.lock(root, { realpath: true, stale: 30000, update: 5000, retries: 0 });
}
export async function reserveCall(root: string, state: SourceState, config: SourceConfig): Promise<void> {
	const day = calendar(config).day;
	const budget = state.budgets[day] ??= { calls: 0, jobs: 0 };
	if (budget.calls >= config.maxWorkerRunsPerDay) throw new Error("Daily worker-run budget exhausted");
	budget.calls++;
	await saveState(root, state);
}
