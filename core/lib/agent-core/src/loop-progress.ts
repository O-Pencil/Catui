/**
 * [WHO]: LoopProgressTracker and deterministic tool evidence fingerprints
 * [FROM]: No external dependencies
 * [TO]: Consumed by agent loops when progress-aware stopping is enabled
 * [HERE]: core/lib/agent-core/src/loop-progress.ts - bounded livelock detection primitive
 */

export interface LoopProgressOptions {
	repetitionThreshold: number;
	historySize?: number;
}

export interface LoopProgressEvidence {
	toolName: string;
	input: unknown;
	outcome: "success" | "error" | "denied";
	progressMarker?: string;
}

export interface LivelockDetection {
	fingerprint: string;
	repeatCount: number;
}

function canonicalize(value: unknown, seen = new WeakSet<object>()): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? String(value);
	if (seen.has(value)) return '"[circular]"';
	seen.add(value);
	if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item, seen)).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item, seen)}`)
		.join(",")}}`;
}

export function fingerprintProgressEvidence(evidence: LoopProgressEvidence): string {
	return `${evidence.toolName}:${canonicalize(evidence.input)}:${evidence.outcome}`;
}

export class LoopProgressTracker {
	readonly #threshold: number;
	readonly #historySize: number;
	#history: string[] = [];
	#lastMarker?: string;
	stagnationCount = 0;

	constructor(options: LoopProgressOptions) {
		if (!Number.isInteger(options.repetitionThreshold) || options.repetitionThreshold < 2) {
			throw new Error("repetitionThreshold must be an integer of at least 2");
		}
		this.#threshold = options.repetitionThreshold;
		this.#historySize = Math.max(options.historySize ?? options.repetitionThreshold, options.repetitionThreshold);
	}

	observe(evidence: LoopProgressEvidence): LivelockDetection | undefined {
		const fingerprint = fingerprintProgressEvidence(evidence);
		const markerChanged = evidence.progressMarker !== undefined && evidence.progressMarker !== this.#lastMarker;
		const isNovelSuccess = evidence.outcome === "success" && this.#history.at(-1) !== fingerprint;
		if (markerChanged || isNovelSuccess) {
			this.stagnationCount = 0;
			this.#history = [fingerprint];
			if (evidence.progressMarker !== undefined) this.#lastMarker = evidence.progressMarker;
			return undefined;
		}
		if (evidence.progressMarker !== undefined) this.#lastMarker = evidence.progressMarker;
		this.#history.push(fingerprint);
		if (this.#history.length > this.#historySize) this.#history.shift();

		let trailingMatches = 0;
		for (let index = this.#history.length - 1; index >= 0 && this.#history[index] === fingerprint; index--) {
			trailingMatches++;
		}
		this.stagnationCount = trailingMatches;
		if (this.stagnationCount >= this.#threshold && evidence.outcome !== "success") {
			return { fingerprint, repeatCount: this.stagnationCount };
		}
		return undefined;
	}
}
