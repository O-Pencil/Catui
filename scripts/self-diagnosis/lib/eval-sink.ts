/**
 * [WHO]: Provides writeSelfDiagnosisMetric() for one-shot writes to insforge eval_metric_results with variant='self-diagnosis'
 * [FROM]: Depends on node:fs for credentials loading, node:https for PostgREST POST (mirrors extensions/defaults/diagnostics/reporter.ts pattern)
 * [TO]: Consumed by ../run.ts after a reflexive task completes; never imported from extensions/ or core/
 * [HERE]: scripts/self-diagnosis/lib/eval-sink.ts — isolated write path that does NOT share state with extensions/defaults/sal/eval/insforge-sink.ts (different variant, different concerns); credentials sourced from NANOPENCIL_ISSUE_* env or .memory-experiments/credentials.json
 */

// SKELETON — implementation pending. Tight constraint: variant MUST be 'self-diagnosis', never 'sal'.

export const VARIANT = "self-diagnosis" as const;

export interface MetricRow {
	runId: string;
	metricName: string;
	metricCategory: "self-trace" | "memory-recall" | "diagnostic-synthesis" | "tool-economy";
	score: number;
	scoreNormalized?: number;
	details: Record<string, unknown>;
	computedAt: string; // ISO timestamp
	computationMethod: string; // e.g. "archetype-A v1"
}

/**
 * Write one eval_metric_results row.
 *
 * When implemented:
 *   1. Resolve creds (NANOPENCIL_ISSUE_* env → .memory-experiments/credentials.json fallback)
 *   2. Validate variant='self-diagnosis' (enforced — refuse if caller passed anything else)
 *   3. POST [row] to <endpoint>/api/database/records/eval_metric_results
 *   4. On failure, write a local fallback at scripts/self-diagnosis/runs/<date>/metric-pending.json
 *      so the run isn't lost
 */
export async function writeSelfDiagnosisMetric(row: MetricRow): Promise<{ ok: boolean; reason?: string }> {
	throw new Error("Not implemented — see .dev-docs/self-awareness/charter.md §4 S3");
}

/**
 * Companion helper: ensure variant tagging on the corresponding eval_runs row
 * (if the run was spawned via this script's pencil invocation).
 */
export async function ensureRunVariant(_runId: string): Promise<void> {
	throw new Error("Not implemented");
}
