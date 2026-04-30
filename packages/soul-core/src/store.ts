/**
 * [WHO]: SoulStore
 * [FROM]: Depends on node:fs/promises, node:fs, node:path
 * [TO]: Consumed by packages/soul-core/src/index.ts
 * [HERE]: packages/soul-core/src/store.ts -
 */


import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
	SoulProfile,
	SoulMemory,
	SoulEvolution,
	SuccessMemory,
	FailureMemory,
	PatternMemory,
	DecisionMemory,
} from "./types.js";
import type { SoulConfig } from "./config.js";
import { reportDiagnostic } from "./diagnostics.js";

function classifyLoadError(error: unknown): "parse" | "io" | "unknown" {
	if (error instanceof SyntaxError) return "parse";
	if (error && typeof error === "object" && "code" in error) return "io";
	return "unknown";
}

/**
 * Soul Store - persistent storage backed by NanoMem
 */
export class SoulStore {
	private soulDir: string;
	private profilePath: string;
	private memoryPath: string;
	private evolutionsPath: string;

	constructor(config: SoulConfig) {
		this.soulDir = config.soulDir;
		this.profilePath = join(this.soulDir, "profile.json");
		this.memoryPath = join(this.soulDir, "memory.json");
		this.evolutionsPath = join(this.soulDir, "evolutions.json");
	}

	/**
	 * Initialize storage directory
	 */
	async init(): Promise<void> {
		if (!existsSync(this.soulDir)) {
			await mkdir(this.soulDir, { recursive: true });
		}
	}

	/**
	 * Load Soul Profile
	 */
	async loadProfile(): Promise<SoulProfile | null> {
		try {
			if (!existsSync(this.profilePath)) {
				return null;
			}
			const raw = await readFile(this.profilePath, "utf-8");
			if (!raw.trim()) {
				return null;
			}
			const data = JSON.parse(raw);
			// Convert date strings back to Date objects
			data.createdAt = new Date(data.createdAt);
			data.lastEvolved = new Date(data.lastEvolved);
			data.emotionalState.lastUpdate = new Date(data.emotionalState.lastUpdate);
			data.expertise = data.expertise.map((e: any) => ({
				...e,
				lastUsed: new Date(e.lastUsed),
			}));
			data.userRelationship.firstInteraction = new Date(data.userRelationship.firstInteraction);
			data.userRelationship.lastInteraction = new Date(data.userRelationship.lastInteraction);
			data.stats.lastUpdate = new Date(data.stats.lastUpdate);
			return data as SoulProfile;
		} catch (error) {
			const kind = classifyLoadError(error);
			const msg = error instanceof Error ? error.message : String(error);
			reportDiagnostic({
				source: "soul.store",
				severity: "warning",
				category: "persistence",
				message: `Failed to load Soul profile; using a fresh profile.`,
				detail: { path: this.profilePath, kind, error: msg },
				fingerprint: `soul.store:loadProfile:${kind}`,
			});
			return null;
		}
	}

	/**
	 * Save Soul Profile
	 */
	async saveProfile(profile: SoulProfile): Promise<void> {
		await this.init();
		await writeFile(this.profilePath, JSON.stringify(profile, null, 2), "utf-8");
	}

	/**
	 * Load Soul Memory
	 */
	async loadMemory(): Promise<SoulMemory> {
		try {
			if (!existsSync(this.memoryPath)) {
				return {
					successes: [],
					failures: [],
					patterns: [],
					decisions: [],
				};
			}
			const raw = await readFile(this.memoryPath, "utf-8");
			if (!raw.trim()) {
				return {
					successes: [],
					failures: [],
					patterns: [],
					decisions: [],
				};
			}
			const data = JSON.parse(raw);
			// Convert date strings back to Date objects
			return {
				successes: data.successes.map((s: any) => ({ ...s, timestamp: new Date(s.timestamp) })),
				failures: data.failures.map((f: any) => ({ ...f, timestamp: new Date(f.timestamp) })),
				patterns: data.patterns.map((p: any) => ({ ...p, lastSeen: new Date(p.lastSeen) })),
				decisions: data.decisions.map((d: any) => ({ ...d, timestamp: new Date(d.timestamp) })),
			};
		} catch (error) {
			const kind = classifyLoadError(error);
			const msg = error instanceof Error ? error.message : String(error);
			reportDiagnostic({
				source: "soul.store",
				severity: "warning",
				category: "persistence",
				message: `Failed to load Soul memory; using empty memory.`,
				detail: { path: this.memoryPath, kind, error: msg },
				fingerprint: `soul.store:loadMemory:${kind}`,
			});
			return {
				successes: [],
				failures: [],
				patterns: [],
				decisions: [],
			};
		}
	}

	/**
	 * Save Soul Memory
	 */
	async saveMemory(memory: SoulMemory, retention: SoulConfig["memoryRetention"]): Promise<void> {
		await this.init();

		// Apply retention limits (keep most recent)
		const successes = memory.successes
			.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
			.slice(0, retention.successes);

		const failures = memory.failures
			.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
			.slice(0, retention.failures);

		const patterns = memory.patterns
			.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())
			.slice(0, retention.patterns);

		const decisions = memory.decisions
			.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
			.slice(0, retention.decisions);

		const data = { successes, failures, patterns, decisions };
		await writeFile(this.memoryPath, JSON.stringify(data, null, 2), "utf-8");
	}

	/**
	 * Load Evolution History
	 */
	async loadEvolutions(): Promise<SoulEvolution[]> {
		try {
			if (!existsSync(this.evolutionsPath)) {
				return [];
			}
			const raw = await readFile(this.evolutionsPath, "utf-8");
			if (!raw.trim()) {
				return [];
			}
			const data = JSON.parse(raw);
			return data.map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) }));
		} catch (error) {
			const kind = classifyLoadError(error);
			const msg = error instanceof Error ? error.message : String(error);
			reportDiagnostic({
				source: "soul.store",
				severity: "warning",
				category: "persistence",
				message: `Failed to load Soul evolutions; using empty list.`,
				detail: { path: this.evolutionsPath, kind, error: msg },
				fingerprint: `soul.store:loadEvolutions:${kind}`,
			});
			return [];
		}
	}

	/**
	 * Save Evolution History
	 */
	async saveEvolutions(evolutions: SoulEvolution[]): Promise<void> {
		await this.init();
		// Keep last 1000 evolutions
		const trimmed = evolutions.slice(-1000);
		await writeFile(this.evolutionsPath, JSON.stringify(trimmed, null, 2), "utf-8");
	}

	/**
	 * Append a success memory
	 */
	async addSuccess(success: SuccessMemory): Promise<void> {
		const memory = await this.loadMemory();
		memory.successes.push(success);
		await this.saveMemory(memory, {
			successes: 1000, // Temporary limit, will be trimmed by saveMemory
			failures: 500,
			patterns: 200,
			decisions: 1000,
		});
	}

	/**
	 * Append a failure memory
	 */
	async addFailure(failure: FailureMemory): Promise<void> {
		const memory = await this.loadMemory();
		memory.failures.push(failure);
		await this.saveMemory(memory, {
			successes: 500,
			failures: 1000,
			patterns: 200,
			decisions: 1000,
		});
	}

	/**
	 * Append a pattern memory
	 */
	async addPattern(pattern: PatternMemory): Promise<void> {
		const memory = await this.loadMemory();
		// Check if pattern already exists, update frequency
		const existing = memory.patterns.find((p) => p.trigger === pattern.trigger && p.behavior === pattern.behavior);
		if (existing) {
			existing.frequency += pattern.frequency;
			existing.lastSeen = pattern.lastSeen;
			existing.outcome = pattern.outcome;
		} else {
			memory.patterns.push(pattern);
		}
		await this.saveMemory(memory, {
			successes: 500,
			failures: 500,
			patterns: 1000,
			decisions: 1000,
		});
	}

	/**
	 * Append a decision memory
	 */
	async addDecision(decision: DecisionMemory): Promise<void> {
		const memory = await this.loadMemory();
		memory.decisions.push(decision);
		await this.saveMemory(memory, {
			successes: 500,
			failures: 500,
			patterns: 200,
			decisions: 1000,
		});
	}
}
