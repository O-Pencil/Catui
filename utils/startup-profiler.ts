/**
 * [WHO]: profileCheckpoint(), getCheckpoints(), getProfileReport(), exportProfile()
 * [FROM]: Depends on node:fs, node:process, node:performance
 * [TO]: Consumed by main.ts, cli.ts, core/config/settings-manager.ts, core/runtime/sdk.ts
 * [HERE]: utils/startup-profiler.ts - startup timing instrumentation with reporting
 */

/** Startup timing checkpoint */
interface Checkpoint {
	name: string;
	time: number;
	delta?: number;
}

/** Phase statistics for summary */
interface PhaseStats {
	name: string;
	selfMs: number;      // 自身耗时（不含子阶段）
	totalMs: number;     // 含所有子阶段（通过 parent delta 计算）
	percentage: number;
}

/** Profile report for export and analysis */
export interface ProfileReport {
	version: string;
	timestamp: string;
	platform: string;
	nodeVersion: string;
	totalMs: number;
	checkpoints: Array<{
		name: string;
		time: number;
		timeFromStart: number;
		deltaFromLast: number | null;
		deltaFromParent: number | null;
	}>;
	summary: {
		phases: PhaseStats[];
		largestPhases: Array<{ name: string; ms: number; percentage: number }>;
	};
}

/** Whether profiling is enabled */
const enabled = process.env.NANOPENCIL_PROFILE_STARTUP === "1";

/** Profile output file path */
const outputFile = process.env.NANOPENCIL_PROFILE_FILE;

/** Stored checkpoints */
const checkpoints: Checkpoint[] = [];

/** Module version for report */
const MODULE_VERSION = "1.0.0";

/**
 * Record a startup checkpoint.
 * Outputs timing info if NANOPENCIL_PROFILE_STARTUP=1
 *
 * @example profileCheckpoint("config_loaded")
 * @example profileCheckpoint("settings_manager_ready", "after_config")
 */
export function profileCheckpoint(name: string, afterCheckpoint?: string): void {
	const now = performance.now();
	const entry: Checkpoint = { name, time: now };

	if (afterCheckpoint) {
		const parent = checkpoints.find((c) => c.name === afterCheckpoint);
		if (parent) {
			entry.delta = now - parent.time;
		}
	}

	checkpoints.push(entry);

	if (enabled) {
		const prev = checkpoints.length > 1 ? checkpoints[checkpoints.length - 2] : null;
		const delta = prev ? now - prev.time : 0;
		const parentDelta = entry.delta !== undefined ? ` (+${entry.delta.toFixed(1)}ms from ${afterCheckpoint})` : "";
		process.stderr.write(`[profile] ${name}: ${now.toFixed(1)}ms (${delta.toFixed(1)}ms since last${parentDelta})\n`);

		// Auto-save to file if output file is specified
		if (outputFile && checkpoints.length >= 2) {
			import("node:fs").then(({ writeFileSync }) => {
				const report = getProfileReport();
				writeFileSync(outputFile, JSON.stringify(report, null, 2));
			}).catch(() => {});
		}
	}
}

/**
 * Get all recorded checkpoints.
 * Useful for testing or programmatic access.
 */
export function getCheckpoints(): Checkpoint[] {
	return [...checkpoints];
}

/**
 * Clear all checkpoints.
 * Useful for testing.
 */
export function clearCheckpoints(): void {
	checkpoints.length = 0;
}

/**
 * Generate a structured profile report.
 * Useful for comparison and CI regression testing.
 */
export function getProfileReport(): ProfileReport {
	if (checkpoints.length === 0) {
		return {
			version: MODULE_VERSION,
			timestamp: new Date().toISOString(),
			platform: process.platform,
			nodeVersion: process.version,
			totalMs: 0,
			checkpoints: [],
			summary: { phases: [], largestPhases: [] },
		};
	}

	const firstTime = checkpoints[0].time;
	const lastTime = checkpoints[checkpoints.length - 1].time;
	const totalMs = lastTime - firstTime;

	// Build checkpoint array with calculated values
	const checkpointData = checkpoints.map((cp, index) => {
		const prev = index > 0 ? checkpoints[index - 1] : null;
		return {
			name: cp.name,
			time: cp.time,
			timeFromStart: cp.time - firstTime,
			deltaFromLast: prev ? cp.time - prev.time : null,
			deltaFromParent: cp.delta ?? null,
		};
	});

	// Calculate phase statistics
	// Phase = time between two consecutive checkpoints
	const phases: PhaseStats[] = checkpointData.slice(1).map((cp, index) => {
		const prev = checkpointData[index];
		const selfMs = cp.deltaFromLast ?? 0;
		const totalMsForPhase = cp.deltaFromParent ?? selfMs;
		return {
			name: cp.name,
			selfMs,
			totalMs: totalMsForPhase,
			percentage: totalMs > 0 ? (selfMs / totalMs) * 100 : 0,
		};
	});

	// Sort by self time, get top 5 largest phases
	const sorted = [...phases].sort((a, b) => b.selfMs - a.selfMs);
	const largestPhases = sorted.slice(0, 5).map((p) => ({
		name: p.name,
		ms: p.selfMs,
		percentage: p.percentage,
	}));

	return {
		version: MODULE_VERSION,
		timestamp: new Date().toISOString(),
		platform: process.platform,
		nodeVersion: process.version,
		totalMs,
		checkpoints: checkpointData,
		summary: {
			phases,
			largestPhases,
		},
	};
}

/**
 * Export profile to a JSON file.
 * Useful for CI baseline comparison.
 */
export async function exportProfile(filePath: string): Promise<void> {
	const { writeFile } = await import("node:fs/promises");
	const report = getProfileReport();
	await writeFile(filePath, JSON.stringify(report, null, 2));
}

/**
 * Compare two profile reports.
 * Returns differences for regression detection.
 */
export function compareProfiles(baseline: ProfileReport, current: ProfileReport): {
	totalDiff: number;
	totalDiffPercent: number;
	phaseDiffs: Array<{
		name: string;
		baselineMs: number;
		currentMs: number;
		diffMs: number;
		diffPercent: number;
		regression: boolean;
	}>;
} {
	const totalDiff = current.totalMs - baseline.totalMs;
	const totalDiffPercent = baseline.totalMs > 0 ? (totalDiff / baseline.totalMs) * 100 : 0;

	// Build lookup for baseline phases
	const baselineMap = new Map(baseline.summary.phases.map((p) => [p.name, p.selfMs]));

	const phaseDiffs = current.summary.phases.map((phase) => {
		const baselineMs = baselineMap.get(phase.name) ?? 0;
		const diffMs = phase.selfMs - baselineMs;
		const diffPercent = baselineMs > 0 ? (diffMs / baselineMs) * 100 : 0;
		// Consider regression if phase increased by more than 10%
		const regression = diffPercent > 10 && diffMs > 10;
		return { name: phase.name, baselineMs, currentMs: phase.selfMs, diffMs, diffPercent, regression };
	});

	return { totalDiff, totalDiffPercent, phaseDiffs };
}