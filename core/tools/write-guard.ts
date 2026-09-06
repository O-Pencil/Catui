/**
 * [WHO]: Provides createWorkspaceWriteGuard(), isPathWithinRoot()
 * [FROM]: Depends on node:fs/promises and node:path for canonical path validation
 * [TO]: Consumed by core/runtime/default-tools.ts, core/runtime/run-trace-jsonl.ts, and tool-boundary tests
 * [HERE]: core/tools/write-guard.ts - shared filesystem write boundary helpers
 */
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

function normalizePath(path: string): string {
	return resolve(isAbsolute(path) ? path : path);
}

function normalizeForComparison(path: string): string {
	return normalizePath(path).replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
	const root = normalizeForComparison(rootPath);
	const target = normalizeForComparison(targetPath);
	return target === root || target.startsWith(`${root}/`);
}

function isMissingPathError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function assertNoSymlinkTraversal(targetPath: string, workspaceRoot: string): Promise<void> {
	const canonicalRoot = await realpath(workspaceRoot);
	const relativePath = relative(workspaceRoot, targetPath);
	let currentPath = workspaceRoot;

	for (const segment of relativePath.split(sep).filter(Boolean)) {
		currentPath = join(currentPath, segment);
		try {
			const stats = await lstat(currentPath);
			if (stats.isSymbolicLink()) {
				throw new Error(`Write denied for ${targetPath}. Workspace writes may not traverse symbolic links: ${currentPath}`);
			}
			const canonicalCurrent = await realpath(currentPath);
			if (!isPathWithinRoot(canonicalCurrent, canonicalRoot)) {
				throw new Error(`Write denied for ${targetPath}. Resolved path escapes the current workspace: ${canonicalCurrent}`);
			}
		} catch (error: unknown) {
			if (isMissingPathError(error)) return;
			throw error;
		}
	}
}

export function createWorkspaceWriteGuard(cwd: string): (absolutePath: string) => Promise<void> {
	const workspaceRoot = normalizePath(cwd);
	return async (absolutePath: string) => {
		const targetPath = normalizePath(absolutePath);
		if (!isPathWithinRoot(targetPath, workspaceRoot)) {
			throw new Error(
				`Write denied for ${absolutePath}. Main session write tools may only write inside the current workspace: ${workspaceRoot}`,
			);
		}
		await assertNoSymlinkTraversal(targetPath, workspaceRoot);
	};
}
