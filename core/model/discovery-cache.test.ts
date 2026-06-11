/**
 * [WHO]: Tests for DiscoveryCache read/write/clear
 * [FROM]: Depends on ./discovery-cache.js
 * [TO]: None (test file)
 * [HERE]: core/model/discovery-cache.test.ts — filesystem cache tests
 */

import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DiscoveryCache } from "./discovery-cache.js";
import type { DiscoveryResult } from "./discovery.js";

function makeResult(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
	return {
		provider: "test-provider",
		models: [{ id: "model-a", name: "Model A" }],
		fetchedAt: Date.now(),
		ttl: 86400,
		...overrides,
	};
}

describe("DiscoveryCache", () => {
	let cacheDir: string;
	let cache: DiscoveryCache;

	beforeEach(() => {
		cacheDir = join(tmpdir(), `discovery-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		cache = new DiscoveryCache(cacheDir);
	});

	afterEach(() => {
		try {
			if (existsSync(cacheDir)) {
				rmSync(cacheDir, { recursive: true, force: true });
			}
		} catch {
			// cleanup best-effort
		}
	});

	describe("write and read", () => {
		it("writes and reads back a discovery result", () => {
			const result = makeResult();
			cache.write(result);

			const cached = cache.read("test-provider");
			assert.ok(cached);
			assert.strictEqual(cached.provider, "test-provider");
			assert.strictEqual(cached.models.length, 1);
			assert.strictEqual(cached.models[0].id, "model-a");
		});

		it("creates cache directory if it doesn't exist", () => {
			assert.strictEqual(existsSync(cacheDir), false);
			cache.write(makeResult());
			assert.strictEqual(existsSync(cacheDir), true);
		});

		it("returns undefined for non-existent provider", () => {
			assert.strictEqual(cache.read("nonexistent"), undefined);
		});
	});

	describe("TTL expiration", () => {
		it("returns cached result when fresh (within TTL)", () => {
			const result = makeResult({ fetchedAt: Date.now() - 1000 }); // 1s ago
			cache.write(result);

			const cached = cache.read("test-provider", 86400);
			assert.ok(cached);
		});

		it("returns undefined when expired (beyond TTL)", () => {
			const result = makeResult({ fetchedAt: Date.now() - 200_000 }); // 200s ago
			cache.write(result);

			const cached = cache.read("test-provider", 100); // TTL: 100s
			assert.strictEqual(cached, undefined);
		});

		it("uses default TTL of 24h when not specified", () => {
			const result = makeResult({ fetchedAt: Date.now() - 3600_000 }); // 1h ago
			cache.write(result);

			// Default TTL is 86400s (24h), 1h is within
			const cached = cache.read("test-provider");
			assert.ok(cached);
		});
	});

	describe("error handling", () => {
		it("returns undefined for corrupted JSON file", () => {
			mkdirSync(cacheDir, { recursive: true });
			writeFileSync(join(cacheDir, "test-provider.json"), "not json{{{", "utf-8");

			assert.strictEqual(cache.read("test-provider"), undefined);
		});

		it("returns undefined for file with invalid structure", () => {
			mkdirSync(cacheDir, { recursive: true });
			writeFileSync(join(cacheDir, "test-provider.json"), JSON.stringify({ foo: "bar" }), "utf-8");

			assert.strictEqual(cache.read("test-provider"), undefined);
		});

		it("sanitizes provider names with special characters", () => {
			const result = makeResult({ provider: "test/../provider" });
			cache.write(result);

			// Should not create files outside cacheDir
			const cached = cache.read("test/../provider");
			assert.ok(cached);
		});
	});

	describe("isFresh", () => {
		it("returns true for fresh cache entry", () => {
			cache.write(makeResult());
			assert.strictEqual(cache.isFresh("test-provider"), true);
		});

		it("returns false for expired cache entry", () => {
			const result = makeResult({ fetchedAt: Date.now() - 200_000 });
			cache.write(result);
			assert.strictEqual(cache.isFresh("test-provider", 100), false);
		});

		it("returns false for non-existent entry", () => {
			assert.strictEqual(cache.isFresh("nonexistent"), false);
		});
	});

	describe("remove", () => {
		it("removes a specific provider's cache file", () => {
			cache.write(makeResult());
			assert.strictEqual(cache.isFresh("test-provider"), true);

			cache.remove("test-provider");
			assert.strictEqual(cache.isFresh("test-provider"), false);
		});

		it("does nothing for non-existent provider", () => {
			// Should not throw
			cache.remove("nonexistent");
		});
	});

	describe("clear", () => {
		it("removes entire cache directory", () => {
			cache.write(makeResult({ provider: "a" }));
			cache.write(makeResult({ provider: "b" }));
			assert.strictEqual(existsSync(cacheDir), true);

			cache.clear();
			assert.strictEqual(existsSync(cacheDir), false);
		});

		it("does nothing when cache directory doesn't exist", () => {
			// Should not throw
			cache.clear();
		});
	});

	describe("listProviders", () => {
		it("lists all cached provider names", () => {
			cache.write(makeResult({ provider: "alpha" }));
			cache.write(makeResult({ provider: "beta" }));

			const providers = cache.listProviders();
			assert.ok(providers.includes("alpha"));
			assert.ok(providers.includes("beta"));
			assert.strictEqual(providers.length, 2);
		});

		it("returns empty array when cache directory doesn't exist", () => {
			assert.deepStrictEqual(cache.listProviders(), []);
		});
	});
});
