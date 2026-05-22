/**
 * [WHO]: Provides buildArchetypeATask(), the longest-tool-sequence post-mortem prompt
 * [FROM]: Depends only on built-in fs for prompt template loading (no runtime imports)
 * [TO]: Consumed by ../run.ts when --archetype=A; produces the task.md content + the analysis schema
 * [HERE]: scripts/self-diagnosis/archetypes/A-self-trace.ts — Archetype A definition; mirrors the manual task once at .pencil-self-study/2026-05-17/task.md, then improved with harness lessons (terminate-on-sentinel hard-stop, no SAL eval coupling)
 */

// SKELETON — implementation pending.

export const ARCHETYPE_A_ID = "A";
export const ARCHETYPE_A_NAME = "self-trace post-mortem";

/**
 * Build the prompt that asks pencil to read its own eval_tool_traces,
 * pick three longest tool_sequence turns, and write a structured post-mortem.
 *
 * Lessons baked in from the 2026-05-17 first run (see .dev-docs/self-awareness/charter.md §7):
 *   - Hard sentinel: the prompt MUST instruct pencil to stop after the sentinel and not continue.
 *   - No SAL eval interference: this archetype's run uses variant='self-diagnosis', not 'sal'.
 *   - Schema-cast guidance embedded: pencil_issue_events / eval_tool_traces still all-TEXT
 *     until the migration in step B lands.
 */
export function buildArchetypeATask(): { task: string; expectedSchema: AnalysisSchema } {
	throw new Error("Not implemented — see .dev-docs/self-awareness/charter.md §4 S2");
}

/**
 * What structured fields the analysis should produce, for the eval_metric_results row.
 * The free-form output.md is for humans; the analysis is what feeds the metric sink.
 */
export interface AnalysisSchema {
	selectedTurns: Array<{
		runId: string;
		turnId: number;
		totalToolCalls: number;
		totalErrors: number;
		durationMs: number;
	}>;
	toolsByFrequency: Record<string, number>;
	wishedTools: string[]; // structured form of (c) items in the prompt
	metaObservation: string; // free-form; <=200 words
}
