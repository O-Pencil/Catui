/**
 * [WHO]: Provides SimplifyController, processFilesParallel(), getContentHash()
 * [FROM]: Depends on node crypto/fs/path and simplify result types
 * [TO]: Consumed by extensions/optional/simplify/index.ts for caching and concurrency
 * [HERE]: extensions/optional/simplify/simplify-controller.ts - simplify state and parallel processing helpers
 */

import { createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SimplifyResult } from "./simplify-types.js";

// =============================================================================
// Content Hashing
// =============================================================================

/**
 * Generate a short hash for content caching
 * Uses SHA-256 truncated to 16 hex characters
 */
export function getContentHash(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// =============================================================================
// Concurrent Processing
// =============================================================================

/**
 * Process items in parallel with a concurrency limit
 *
 * @param items - Items to process
 * @param limit - Maximum concurrent operations
 * @param processor - Async function to process each item
 * @param onProgress - Optional progress callback (completed, total)
 * @returns Array of successful results (nulls filtered out)
 */
export async function processFilesParallel<T, R>(
	items: T[],
	limit: number,
	processor: (item: T) => Promise<R | null>,
	onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
	const results: R[] = [];
	let completed = 0;

	for (let i = 0; i < items.length; i += limit) {
		const batch = items.slice(i, i + limit);
		const batchResults = await Promise.all(batch.map(processor));
		for (const result of batchResults) {
			if (result !== null) {
				results.push(result);
			}
			completed++;
			onProgress?.(completed, items.length);
		}
	}

	return results;
}

// =============================================================================
// Simplify Controller
// =============================================================================

/**
 * Controller for managing simplify operation state
 *
 * Responsibilities:
 * - Content hash caching (skip unchanged files)
 * - Backup management (for rollback on test failure)
 * - Applied changes tracking (for summary)
 */
export class SimplifyController {
	private cache = new Map<string, SimplifyResult>();
	private backups = new Map<string, string>();
	private applied: SimplifyResult[] = [];

	/**
	 * Check if a file+hash combination is cached
	 */
	getCached(file: string, hash: string): SimplifyResult | undefined {
		return this.cache.get(`${file}:${hash}`);
	}

	/**
	 * Cache a result for a file+hash combination
	 */
	setCached(file: string, hash: string, result: SimplifyResult): void {
		this.cache.set(`${file}:${hash}`, result);
	}

	/**
	 * Backup original file content before modification
	 */
	backup(file: string, content: string): void {
		if (!this.backups.has(file)) {
			this.backups.set(file, content);
		}
	}

	/**
	 * Record an applied simplification
	 */
	recordApply(result: SimplifyResult): void {
		this.applied.push(result);
	}

	/**
	 * Rollback all applied changes by restoring backups
	 */
	rollback(cwd: string): void {
		for (const [file, content] of this.backups) {
			const fullPath = join(cwd, file);
			try {
				writeFileSync(fullPath, content, "utf-8");
			} catch (error) {
				// Log but don't throw - best effort rollback
				console.error(`Failed to rollback ${file}:`, error);
			}
		}
	}

	/**
	 * Get summary statistics
	 */
	getSummary(): { applied: number; linesSaved: number; rolledBack: number } {
		const linesSaved = this.applied.reduce(
			(sum, r) => sum + (r.original.split("\n").length - r.simplified.split("\n").length),
			0,
		);
		return {
			applied: this.applied.length,
			linesSaved,
			rolledBack: this.backups.size - this.applied.length,
		};
	}

	/**
	 * Check if there are any backups (for rollback purposes)
	 */
	hasBackups(): boolean {
		return this.backups.size > 0;
	}

	/**
	 * Clear all state (for cleanup)
	 */
	clear(): void {
		this.cache.clear();
		this.backups.clear();
		this.applied = [];
	}
}
