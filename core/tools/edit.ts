/**
 * [WHO]: EditTool, editTool, createEditTool, EditToolInput, EditOperations
 * [FROM]: Depends on agent-core, node:fs, edit-diff.ts, path-utils.ts
 * [TO]: Consumed by core/tools/index.ts
 * [HERE]: core/tools/edit.ts - filesystem mutation via diff application; consumed by orchestrator
 */
import type { AgentTool } from "@catui/agent-core";
import { type Static, Type } from "@sinclair/typebox";
import { constants } from "fs";
import * as Diff from "diff";
import { access as fsAccess, readFile as fsReadFile, stat as fsStat, writeFile as fsWriteFile } from "fs/promises";
import { fileStateCache } from "./file-state-cache.js";
import {
	detectLineEnding,
	fuzzyFindText,
	generateDiffString,
	normalizeForFuzzyMatch,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "./edit-diff.js";
import { resolveToCwd } from "./path-utils.js";

const editSchema = Type.Object({
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	oldText: Type.String({ description: "Exact text to find and replace (must match exactly)" }),
	newText: Type.String({ description: "New text to replace the old text with" }),
});

export type EditToolInput = Static<typeof editSchema>;

export interface EditToolDetails {
	/** Unified diff of the changes made */
	diff: string;
	/** Line number of the first change in the new file (for editor navigation) */
	firstChangedLine?: number;
	/** Structured patch data (hunks with line-level detail) for GUI diff rendering */
	structuredPatch?: unknown;
}

/**
 * Pluggable operations for the edit tool.
 * Override these to delegate file editing to remote systems (e.g., SSH).
 */
export interface EditOperations {
	/** Read file contents as a Buffer */
	readFile: (absolutePath: string) => Promise<Buffer>;
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Check if file is readable and writable (throw if not) */
	access: (absolutePath: string) => Promise<void>;
}

const defaultEditOperations: EditOperations = {
	readFile: (path) => fsReadFile(path),
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
};

export interface EditToolOptions {
	/** Custom operations for file editing. Default: local filesystem */
	operations?: EditOperations;
	/** Optional guard called with the resolved absolute path before writing. */
	beforeWrite?: (absolutePath: string) => void | Promise<void>;
}

export function createEditTool(cwd: string, options?: EditToolOptions): AgentTool<typeof editSchema> {
	const ops = options?.operations ?? defaultEditOperations;

	return {
		name: "edit",
		label: "edit",
		description:
			"Edit a file by replacing exact text. The oldText must match exactly (including whitespace). Use this for precise, surgical edits.",
		parameters: editSchema,
		validateInput: (rawArgs: Record<string, unknown>) => {
			const path = (rawArgs.path ?? rawArgs.file_path) as string;
			const absolutePath = resolveToCwd(path, cwd);
			if (!fileStateCache.has(absolutePath)) {
				return `Cannot edit ${path}: file has not been read yet. Use the read tool first.`;
			}
		},
		execute: async (
			_toolCallId: string,
			rawArgs: Record<string, unknown>,
			signal?: AbortSignal,
		) => {
			// Accept both catui names (path/oldText/newText) and anthropic-sdk names (file_path/old_string/new_string)
			const path = (rawArgs.path ?? rawArgs.file_path) as string;
			const oldText = (rawArgs.oldText ?? rawArgs.old_string) as string;
			const newText = (rawArgs.newText ?? rawArgs.new_string) as string;
			const absolutePath = resolveToCwd(path, cwd);
			await options?.beforeWrite?.(absolutePath);

			return new Promise<{
				content: Array<{ type: "text"; text: string }>;
				details: EditToolDetails | undefined;
			}>((resolve, reject) => {
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

				// Perform the edit operation
				(async () => {
					try {
						// Check if file exists
						try {
							await ops.access(absolutePath);
						} catch {
							if (signal) {
								signal.removeEventListener("abort", onAbort);
							}
							reject(new Error(`File not found: ${path}`));
							return;
						}

						// Staleness check: detect external modifications (cache existence checked in validateInput)
						const cachedState = fileStateCache.get(absolutePath);
						if (cachedState) {
							const currentStat = await fsStat(absolutePath);
							if (Math.floor(currentStat.mtimeMs) > cachedState.timestamp) {
								fileStateCache.delete(absolutePath);
								if (signal) {
									signal.removeEventListener("abort", onAbort);
								}
								reject(new Error(`Cannot edit ${path}: file has been modified since it was last read. Use the read tool to re-read the file before editing.`));
								return;
							}
						}

						// Check if aborted before reading
						if (aborted) {
							return;
						}

						// Read the file
						const buffer = await ops.readFile(absolutePath);
						const rawContent = buffer.toString("utf-8");

						// Check if aborted after reading
						if (aborted) {
							return;
						}

						// Strip BOM before matching (LLM won't include invisible BOM in oldText)
						const { bom, text: content } = stripBom(rawContent);

						const originalEnding = detectLineEnding(content);
						const normalizedContent = normalizeToLF(content);
						const normalizedOldText = normalizeToLF(oldText);
						const normalizedNewText = normalizeToLF(newText);

						// Find the old text using fuzzy matching (tries exact match first, then fuzzy)
						const matchResult = fuzzyFindText(normalizedContent, normalizedOldText);

						if (!matchResult.found) {
							if (signal) {
								signal.removeEventListener("abort", onAbort);
							}
							reject(
								new Error(
									`Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
								),
							);
							return;
						}

						// Count occurrences using fuzzy-normalized content for consistency
						const fuzzyContent = normalizeForFuzzyMatch(normalizedContent);
						const fuzzyOldText = normalizeForFuzzyMatch(normalizedOldText);
						const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;

						if (occurrences > 1) {
							if (signal) {
								signal.removeEventListener("abort", onAbort);
							}
							reject(
								new Error(
									`Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
								),
							);
							return;
						}

						// Check if aborted before writing
						if (aborted) {
							return;
						}

						// Perform replacement using the matched text position
						// When fuzzy matching was used, contentForReplacement is the normalized version
						const baseContent = matchResult.contentForReplacement;
						const newContent =
							baseContent.substring(0, matchResult.index) +
							normalizedNewText +
							baseContent.substring(matchResult.index + matchResult.matchLength);

						// Verify the replacement actually changed something
						if (baseContent === newContent) {
							if (signal) {
								signal.removeEventListener("abort", onAbort);
							}
							reject(
								new Error(
									`No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
								),
							);
							return;
						}

						const finalContent = bom + restoreLineEndings(newContent, originalEnding);
						await ops.writeFile(absolutePath, finalContent);

						// Update staleness cache with new content
						const postWriteStat = await fsStat(absolutePath);
						fileStateCache.set(absolutePath, {
							content: finalContent,
							timestamp: Math.floor(postWriteStat.mtimeMs),
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

						const diffResult = generateDiffString(baseContent, newContent);
						let structuredPatch: unknown;
						try {
							structuredPatch = Diff.structuredPatch(path, path, baseContent, newContent, "", "");
						} catch { /* ignore diff errors */ }
						resolve({
							content: [
								{
									type: "text",
									text: `Successfully replaced text in ${path}.`,
								},
							],
							details: { diff: diffResult.diff, firstChangedLine: diffResult.firstChangedLine, structuredPatch },
						});
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
			});
		},
	};
}

/** Default edit tool using process.cwd() - for backwards compatibility */
export const editTool = createEditTool(process.cwd());
