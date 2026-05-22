# Wire-Writer TODOs

> **Status**: 2026-05-17. Each item below is a field (or set of fields) that has a confirmed purpose but is currently 0% filled because no writer code populates it. Sourced from `.dev-docs/data/field-purpose-matrix.md`.
>
> **No code in this doc gets touched without a REVIEW ticket.** All target files are on the SOP §3.3 telemetry-write-side. This doc lists *what* and *where*, not *do it now*.

---

## P0 — Self-Awareness unblocked by these (Highest leverage)

### `eval_runs.total_tokens_used` (int, 0/92)

**Why it matters**: this is the single biggest missing signal for any token-economy analysis. Without it, the Self-Awareness archetypes that frame their findings in cost terms (e.g. Archetype A's self-suggested "token efficiency analysis") cannot quantify what they observe.

**Writer location**: `extensions/defaults/sal/eval/insforge-sink.ts:handleRunEnd()` (around line 268; the PATCH that closes out `eval_runs`).

**Source data**: the model adapters in `packages/ai/providers/*.ts` already track usage per stream. The agent core in `packages/agent-core/agent.ts` should accumulate `prompt_tokens + completion_tokens` per turn. SAL needs to read this accumulator and write it on `run_end`.

**Side dependency**: requires a token-accumulator in the agent core that aggregates per-turn token counts into a per-run total. This may already exist in `packages/agent-core/` — needs verification before scoping. If it does not exist, this becomes two REVIEW tickets (one to add the accumulator, one to wire SAL to read it).

**Classification**: REVIEW (telemetry write side + possibly agent-core read side).

---

### `eval_turns.tokens_used` (int, 0/392)

**Why it matters**: per-turn grain of the above. Lets analyses ask "in the long-tool-sequence turns, was each tool call expensive or just frequent?"

**Writer location**: `extensions/defaults/sal/eval/insforge-sink.ts:handleTurnAnchor()` (around line 215; the INSERT into `eval_turns`).

**Source data**: per-turn token count from the same accumulator as above.

**Classification**: REVIEW.

---

### `eval_metric_results` writer (the self-diagnosis sink)

**Why it matters**: this is THE sink for self-diagnosis runs (per charter §3). Without it, no Self-Awareness output is queryable.

**Writer location**: `scripts/self-diagnosis/lib/eval-sink.ts:writeSelfDiagnosisMetric()` (currently a stub).

**Source data**: the analysis layer of each archetype produces a metric object; the sink writes it to InsForge with `variant='self-diagnosis'` enforced (via the matching `eval_runs` row update).

**Classification**: not in `extensions/`. Lives in `scripts/`. Maintainer-controlled. Still touches the developer DB, so the maintainer reviews their own writer code before going live — but no SOP §3.2 boundary crossed.

**Schema contract** (from matrix §`eval_metric_results`):

```ts
interface MetricRow {
  runId: string;              // FK to eval_runs.run_id
  metricName: string;         // e.g. "tool_sequence_redundancy"
  metricCategory: "self-trace" | "memory-recall" | "diagnostic-synthesis" | "tool-economy";
  score: number;
  scoreNormalized?: number;   // optional [0..1] normalization
  details: Record<string, unknown>;  // free-form JSON, the analysis payload
  computedAt: string;         // ISO timestamp
  computationMethod: string;  // e.g. "archetype-A v1"
}
```

---

## P1 — Diagnosis-side completeness

### `eval_runs.error_message` (text, 0/92) + `status='failed'` (0 rows)

**Why it matters**: currently zero `eval_runs` rows are `status='failed'`. Errors leak as `status='running'` (the 53 lifecycle-leaked rows). After B4's one-shot cleanup, ongoing errors should land cleanly as `failed` with a message.

**Writer location**: `extensions/defaults/sal/eval/insforge-sink.ts:handleRunEnd()` — needs a code path for run failures, not just clean exits.

**Source data**: the agent core's catch path on unhandled exception. The SAL extension's emergency-flush hook (`extensions/defaults/sal/index.ts`) needs to capture the error message and route it into the PATCH.

**Classification**: REVIEW.

---

### `eval_runs.config_snapshot` (jsonb, 0/92)

**Why it matters**: reproducibility. Self-Awareness analyses ask "what was the model config that produced these tool sequences?" Right now that's lost.

**Writer location**: `extensions/defaults/sal/eval/insforge-sink.ts:handleRunStart()` (around line 149).

**Source data**: snapshot of the resolved config at run_start. Trim secrets first.

**Classification**: REVIEW (also: needs a redaction pass — see SOP §6).

---

### `eval_turns.thinking` (bool, new column from B5)

**Why it matters**: decision 4 (hybrid) — captures per-turn whether thinking mode is on, complementing run-level `eval_runs.thinking`.

**Writer location**: `extensions/defaults/sal/eval/insforge-sink.ts:handleTurnAnchor()`.

**Source data**: the agent's per-turn thinking-mode flag (already known internally; SAL needs to expose it).

**Classification**: REVIEW.

---

## P2 — Lower priority

### `eval_turns.assistant_response_length` (int, 0/392)

Cheap to add; weak Self signal but useful for "response verbosity" patterns.

**Writer location**: `extensions/defaults/sal/eval/insforge-sink.ts:handleTurnAnchor()`.

**Classification**: REVIEW.

---

### `pencil_issue_events.tool_summary` (text, 0/11)

**Why it matters**: lets a future maintainer trace an explicit error back to the tool sequence that preceded it. Without this, diagnostics are reproducible only by `session_id` cross-reference (which is fragile because sessions can be long).

**Writer location**: `extensions/defaults/diagnostics/reporter.ts:buildReportPayload()` (around line 73). Needs to capture a compact tool-sequence summary from the diagnostic buffer.

**Classification**: REVIEW.

---

## P3 — Held as IOU per decision 2 (SAL Phase-1)

These fields are kept in schema but NOT scheduled for writer work until SAL Phase-1 (`memoryHistoryMatch`) is on the docket.

- `eval_memory_events.*` (whole table, 15 cols)
- `eval_sal_anchors.source` (jsonb)
- `eval_sal_anchors.unresolved_signals` (jsonb)
- `eval_sal_anchors.weights_source` (varchar)

If SAL Phase-1 work begins, the writers for these belong in `extensions/defaults/sal/index.ts` (anchor recording) and `extensions/defaults/sal/eval/insforge-sink.ts` (the corresponding emission path). Spec lives in `.dev-docs/sal/roadmap.md` (memory: `project_sal_evolution_plan.md`).

---

## P4 — Open / questionable

These were flagged in the matrix's "Still open" section. Each needs a wire-or-drop decision before any writer work.

- `pencil_issue_events.thinking` (text, 0/11) — wire writer if LLM thinking trace is retrievable post-hoc, else drop
- `pencil_issue_events.mode` (text, 0/11) — wire (interactive/print/rpc) or drop
- `pencil_issue_events.user_note` (text, 0/11) — already populated only via `/report-issue <note>`, low traffic; keep schema as-is
- `eval_turns.prompt_truncated` (bool, 0 true) — writer may not be firing; investigate before deciding

---

## Aggregation rules for future TODOs

When a new wire-writer item is added:

1. **Identify the field and its declared purpose** (cross-link to matrix).
2. **Identify the writer file path** in `extensions/` or `scripts/`.
3. **Identify the source data** — where in the agent runtime is this value already known?
4. **Classify under SOP**: REVIEW (telemetry write side) or AUTO-FIX (rare; localized non-telemetry).
5. **Assign a priority bucket** (P0–P4) based on which leg of self-diagnosis depends on it.

This doc is the index. The actual REVIEW tickets, when filed, live under `docs/issues/<YYYY-MM-DD>/`.
