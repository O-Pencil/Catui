/**
 * [WHO]: WriteTool, writeTool, createWriteTool, WriteToolInput
 * [FROM]: Depends on agent-core, node:fs/promises, path-utils.ts
 * [TO]: Consumed by core/tools/index.ts
 * [HERE]: core/tools/write.ts - filesystem creation/overwrite; consumed by orchestrator
 */
import type { AgentTool } from "@catui/agent-core";
import { type Static, Type } from "@sinclair/typebox";
import { existsSync } from "fs";
import { mkdir as fsMkdir, readFile as fsReadFile, stat as fsStat, writeFile as fsWriteFile } from "fs/promises";
import { dirname } from "path";
import * as Diff from "diff";
import { fileStateCache } from "./file-state-cache.js";
import { resolveToCwd } from "./path-utils.js";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

/**
 * Pluggable operations for the write tool.
 * Override these to delegate file writing to remote systems (e.g., SSH).
 */
export interface WriteOperations {
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Create directory (recursively) */
	mkdir: (dir: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export interface WriteToolOptions {
	/** Custom operations for file writing. Default: local filesystem */
	operations?: WriteOperations;
	/** Optional guard called with the resolved absolute path before writing. */
	beforeWrite?: (absolutePath: string) => void | Promise<void>;
}

export function createWriteTool(cwd: string, options?: WriteToolOptions): AgentTool<typeof writeSchema> {
	const ops = options?.operations ?? defaultWriteOperations;

	return {
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		parameters: writeSchema,
		execute: async (
			_toolCallId: string,
			rawArgs: Record<string, unknown>,
			signal?: AbortSignal,
		) => {
			// Accept both catui name (path) and anthropic-sdk name (file_path)
			const path = (rawArgs.path ?? rawArgs.file_path) as string;
			const content = rawArgs.content as string;
			const absolutePath = resolveToCwd(path, cwd);
			const dir = dirname(absolutePath);
			await options?.beforeWrite?.(absolutePath);

			return new Promise<{ content: Array<{ type: "text"; text: string }>; details: { structuredPatch: unknown } | undefined }>(
				(resolve, reject) => {
					// Check if already aborted
					if (signal?.aborted) {
						reject(new Error("Operation aborted"));
						return;
					}

					let aborted = false;

					// Set up abort handler
					const onAbort = () => {
						aborted = true;
						reject(new Error("Operation aborted"));
					};

					if (signal) {
						signal.addEventListener("abort", onAbort, { once: true });
					}

					// Perform the write operation
					(async () => {
						try {
							// Read old content for diff computation
							let oldContent: string | undefined;
							if (existsSync(absolutePath)) {
								try { oldContent = await fsReadFile(absolutePath, "utf-8"); } catch { /* ignore */ }
							}

							// Staleness check: if file exists and was previously read, verify mtime
							if (existsSync(absolutePath)) {
								const cachedState = fileStateCache.get(absolutePath);
								if (cachedState) {
									const currentStat = await fsStat(absolutePath);
									if (Math.floor(currentStat.mtimeMs) > cachedState.timestamp) {
										fileStateCache.delete(absolutePath);
										if (signal) {
											signal.removeEventListener("abort", onAbort);
										}
										reject(new Error(`Cannot write ${path}: file has been modified since it was last read. Use the read tool to re-read the file before writing.`));
										return;
									}
								}
							}

							// Create parent directories if needed
							await ops.mkdir(dir);

							// Check if aborted before writing
							if (aborted) {
								return;
							}

							// Write the file
							await ops.writeFile(absolutePath, content);

							// Update staleness cache
							fileStateCache.set(absolutePath, {
								content,
								timestamp: Math.floor(Date.now()),
								offset: undefined,
								limit: undefined,
							});

							// Check if aborted after writing
							if (aborted) {
								return;
							}

							// Clean up abort handler
							if (signal) {
								signal.removeEventListener("abort", onAbort);
							}

							// Compute structuredPatch for GUI diff rendering
							let structuredPatch: unknown;
							if (oldContent !== undefined) {
								try {
									structuredPatch = Diff.structuredPatch(absolutePath, absolutePath, oldContent, content, "", "");
								} catch { /* ignore diff errors */ }
							}

							resolve({
								content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
								details: structuredPatch ? { structuredPatch } : undefined,
							} as { content: Array<{ type: "text"; text: string }>; details: { structuredPatch: unknown } | undefined });
						} catch (error: unknown) {
							// Clean up abort handler
							if (signal) {
								signal.removeEventListener("abort", onAbort);
							}

							if (!aborted) {
								reject(error);
							}
						}
					})();
				},
			);
		},
	};
}

/** Default write tool using process.cwd() - for backwards compatibility */
export const writeTool = createWriteTool(process.cwd());
