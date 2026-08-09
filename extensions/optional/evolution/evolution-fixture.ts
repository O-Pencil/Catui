/**
 * [WHO]: Provides trace path discovery/resolution and eval_fixture content construction
 * [FROM]: Depends on workspace filesystem metadata and validated runtime run-trace JSONL reader
 * [TO]: Consumed by evolution_refine and turn_end auto-observer fixture proposal paths
 * [HERE]: extensions/optional/evolution/evolution-fixture.ts - non-executable trace-to-fixture adapter
 */

import { readdirSync, statSync, type Dirent } from "node:fs";
import { relative, resolve } from "node:path";
import { readRunTraceJsonl } from "../../../core/runtime/run-trace-jsonl.js";

export function assertWorkspacePath(cwd: string, rawPath: string): string {
	const resolvedCwd = resolve(cwd);
	const resolvedPath = resolve(cwd, rawPath);
	const rel = relative(resolvedCwd, resolvedPath);
	if (rel.startsWith("..") || rel === "") throw new Error("Trace path must stay inside the current workspace.");
	return resolvedPath;
}

export function latestTracePath(cwd: string): string {
	const traceDir = resolve(cwd, ".catui", "traces");
	const candidates = workspaceTracePaths(cwd);
	if (candidates.length === 0) throw new Error("No workspace run trace JSONL files found in .catui/traces.");
	return candidates[0] ?? "";
}

export function resolveTracePath(cwd: string, rawPath: string): string {
	if (rawPath === "latest") return latestTracePath(cwd);
	return assertWorkspacePath(cwd, rawPath);
}

export function workspaceTracePaths(cwd: string, maxTraces = 10): string[] {
	if (!Number.isInteger(maxTraces) || maxTraces < 1 || maxTraces > 50) throw new Error("maxTraces must be an integer between 1 and 50.");
	const traceDir = resolve(cwd, ".catui", "traces");
	let entries: Dirent[];
	try {
		entries = readdirSync(traceDir, { withFileTypes: true });
	} catch (error) {
		if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
		throw error;
	}
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
		.map((entry) => {
			const path = resolve(traceDir, entry.name);
			return { path, mtimeMs: statSync(path).mtimeMs };
		})
		.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
		.slice(0, maxTraces)
		.map((candidate) => candidate.path);
}

export async function evalFixtureContent(
	cwd: string,
	tracePath: string,
	observedOutputFingerprint: string | undefined,
): Promise<{ content: string; resolvedTracePath: string }> {
	const resolvedTracePath = resolveTracePath(cwd, tracePath);
	const recorded = await readRunTraceJsonl(resolvedTracePath);
	const observed = structuredClone(recorded);
	if (observedOutputFingerprint) {
		const completed = observed.find((event) => event.kind === "run.completed");
		if (!completed) throw new Error("Trace does not contain run.completed.");
		completed.payload = { ...completed.payload, outputFingerprint: observedOutputFingerprint };
	}
	return { content: JSON.stringify({ recorded, observed, policyViolations: 0 }), resolvedTracePath };
}
