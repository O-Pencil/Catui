/**
 * [WHO]: Provides FileStateCache, FileState, fileStateCache singleton
 * [FROM]: No external dependencies (pure LRU via Map insertion order)
 * [TO]: Consumed by core/tools/read.ts, core/tools/edit.ts, core/tools/write.ts
 * [HERE]: core/tools/file-state-cache.ts - LRU cache tracking file read state for staleness detection
 */
import { normalize, resolve } from "node:path";

export interface FileState {
	/** File content at read time */
	content: string;
	/** mtimeMs from fs.stat(), floored to integer */
	timestamp: number;
	/** offset parameter used during read (1-indexed) */
	offset: number | undefined;
	/** limit parameter used during read */
	limit: number | undefined;
}

/** Max entries in the LRU cache */
const MAX_ENTRIES = 100;
/** Max total content size in bytes (25MB) */
const MAX_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * LRU file state cache with no external dependencies.
 * Uses Map insertion order (iterators return entries in insertion order)
 * to implement LRU eviction — on every access the entry is deleted and
 * re-inserted so it moves to the "newest" position.
 */
class FileStateCache {
	private cache = new Map<string, FileState>();
	private totalBytes = 0;

	private normalizeKey(key: string): string {
		return normalize(resolve(key));
	}

	get(key: string): FileState | undefined {
		const k = this.normalizeKey(key);
		const entry = this.cache.get(k);
		if (!entry) return undefined;
		// Move to newest position (LRU touch)
		this.cache.delete(k);
		this.cache.set(k, entry);
		return entry;
	}

	set(key: string, value: FileState): void {
		const k = this.normalizeKey(key);
		const entrySize = Buffer.byteLength(value.content);

		// Remove old entry if exists
		const old = this.cache.get(k);
		if (old) {
			this.totalBytes -= Buffer.byteLength(old.content);
			this.cache.delete(k);
		}

		// Evict oldest entries until we fit
		while (this.cache.size >= MAX_ENTRIES || this.totalBytes + entrySize > MAX_SIZE_BYTES) {
			const oldest = this.cache.keys().next().value;
			if (oldest === undefined) break;
			const evicted = this.cache.get(oldest)!;
			this.totalBytes -= Buffer.byteLength(evicted.content);
			this.cache.delete(oldest);
		}

		this.cache.set(k, value);
		this.totalBytes += entrySize;
	}

	has(key: string): boolean {
		return this.cache.has(this.normalizeKey(key));
	}

	delete(key: string): boolean {
		const k = this.normalizeKey(key);
		const entry = this.cache.get(k);
		if (entry) {
			this.totalBytes -= Buffer.byteLength(entry.content);
			return this.cache.delete(k);
		}
		return false;
	}

	clear(): void {
		this.cache.clear();
		this.totalBytes = 0;
	}

	get size(): number {
		return this.cache.size;
	}
}

/** Singleton file state cache instance */
export const fileStateCache = new FileStateCache();
