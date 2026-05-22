# InsForge Field × Purpose Matrix

> **Status**: draft, 2026-05-17. For maintainer review before any DDL or writer changes are scheduled.
> **Source data**: schema dump + fill-rate audit from 2026-05-17T09:20Z. Insforge MCP was disconnected later in the session; if anything changed in the backend after that timestamp, this doc is stale by that delta.

## Why a matrix, not a classification

An earlier attempt classified each table as "A SAL / B Diagnosis / C Usage" — that was wrong. The same table almost always serves multiple purposes through different field subsets. `eval_turns` carries SAL training context (`user_prompt`, anchor joins), explicit-diagnosis context (`run_id`+`commit_hash` joins), and self-awareness signal (`duration_ms`, `tokens_used`) simultaneously. The right unit of analysis is the field, not the table.

For each field we judge three purposes:

| Marker | Meaning |
|--------|---------|
| **✓✓** | Primary consumer — reading this is core to the purpose; the purpose breaks without it |
| **✓** | Secondary consumer — used opportunistically; the purpose works without it but improves with it |
| **–** | Not consumed by this purpose |
| **(0%)** etc. | Current fill-rate suffix — appended where notable |

Three purposes:
- **SAL**: maintainers training/evaluating the SAL extension (anchor scoring, memory recall calibration, weights tuning)
- **Diag**: maintainers triaging explicit `pencil_issue_events` defects (need reproducibility info)
- **Self**: maintainers running reflexive self-study against pencil's own historical behavior (tool usage, token economy, intent patterns)

Recommendation column uses these verbs:
- **keep** — field is alive and serving at least one purpose
- **wire-writer** — field has clear purpose value but is currently 0–10% filled; needs a writer
- **type-fix:T** — field works but is stored as a string when it should be `T`
- **drop** — no purpose claims it; column is dead weight
- **investigate** — anomaly noted; decision deferred

---

## Table inventory (snapshot 2026-05-17T09:20Z)

| Table | Rows | Top-line verdict |
|-------|------|------------------|
| `pencil_issue_events` | 11 | active; 4 dead cols, 4 cols need type-fix |
| `eval_runs` | 92 | active; 4 dead cols, 53 lifecycle-leaked rows, 4 cols need writer |
| `eval_turns` | 392 | active; 3 dead-or-shadowed cols, 2 cols need writer |
| `eval_tool_traces` | 382 | active but all-TEXT; large type-fix surface (~12 cols) OR migrate to `eval_tool_calls` |
| `eval_tool_calls` | 0 | **strategic question**: promote (typed successor) or drop |
| `eval_sal_anchors` | 505 | active; 3 cols need writer (SAL training depends on them) |
| `eval_memory_recalls` | 5601 | mostly healthy; one 18% sub-score gap to investigate |
| `eval_memory_events` | 0 | designed not written; **defer** until SAL roadmap calls for it OR drop now |
| `eval_metric_results` | 0 | **the planned self-diagnosis sink**; keep, wire writer in `scripts/self-diagnosis/` |
| `eval_raw_events` | 0 | designed not written; recommend **drop** (redundant with `eval_tool_traces.tool_calls`) |
| `eval_artifact_refs` | 0 | designed not written; no buckets configured; recommend **drop** |

---

## `pencil_issue_events` (11 rows)

Explicit diagnostic events from user-side pencil reporters. Primary consumer: Diagnosis. Some signal value for Self-Awareness when issues correlate with behavior patterns.

| Field | Type | Fill | SAL | Diag | Self | Rec |
|-------|------|------|-----|------|------|-----|
| `id` | uuid | 100% | – | – | – | keep (PK) |
| `client_report_id` | text | 100% | – | ✓ (dedup key) | – | keep |
| `session_id` | text | 100% | – | ✓✓ | ✓ | keep |
| `version` | text | 55% | – | ✓✓ | ✓ | keep, fix stamping (45% missing) |
| `commit_hash` | text | 18% | – | ✓✓ | ✓ | keep, fix stamping (82% missing — only set when SAL is on) |
| `mode` | text | **0%** | – | ✓ | ✓ | wire-writer (interactive/print/rpc) OR drop |
| `source` | text | 100% | – | ✓✓ | ✓ | keep |
| `severity` | text | 100% | – | ✓✓ | ✓ | keep + type-fix:enum |
| `category` | text | 100% | – | ✓✓ | ✓ | keep + type-fix:enum |
| `message` | text | 100% | – | ✓✓ | ✓ | keep |
| `fingerprint` | text | 100% | – | ✓✓ | ✓✓ | keep |
| `provider` | text | 100% | – | ✓ | ✓✓ | keep |
| `model_id` | text | 100% | – | ✓ | ✓✓ | keep |
| `thinking` | text | **0%** | – | ✓ | ✓ | wire-writer (last-thinking trace) OR drop |
| `tool_summary` | text | **0%** | – | ✓ | ✓✓ | wire-writer (lets Self-Aware link issues to behavior) |
| `diagnostics` | text(JSON) | 100% | – | ✓✓ | ✓ | keep + type-fix:jsonb |
| `user_note` | text | **0%** | – | ✓ | – | keep (rare manual `/report-issue <note>` use) |
| `user_approved` | text | 100% (all "true") | – | ✓ | – | keep + type-fix:bool |
| `occurrence_count` | text | 100% | – | ✓ | ✓ | keep + type-fix:int |
| `first_seen_at` | text | 100% | – | ✓ | ✓ | keep + type-fix:timestamptz |
| `last_seen_at` | text | 100% | – | ✓ | ✓ | keep + type-fix:timestamptz |
| `recorded_at` | text | 100% | – | ✓ | ✓ | keep + type-fix:timestamptz |
| `created_at` | timestamptz | 100% | – | ✓✓ | ✓✓ | keep |
| `updated_at` | timestamptz | 100% | – | ✓ | – | keep |

**Strategic call needed on `thinking`/`tool_summary`/`mode`**: these three were designed for richer issue context. If we wire writers, Self-Awareness gets a useful diag-correlated dataset; if we drop, the schema gets cleaner. Lean: wire `tool_summary` (highest Self value), drop `mode` and `thinking` (LLM thinking traces are typically not retrievable post-hoc anyway).

---

## `eval_runs` (92 rows) — **53 leaked at status='running'**

Run envelope. Joined by every downstream eval table. Lifecycle leak is the biggest active reliability problem.

| Field | Type | Fill | SAL | Diag | Self | Rec |
|-------|------|------|-----|------|------|-----|
| `id` | int | 100% | – | – | – | keep (PK) |
| `run_id` | varchar | 100% | ✓✓ | ✓✓ | ✓✓ | keep (logical FK) |
| `variant` | varchar | 100% (all 'sal') | ✓✓ | ✓ | ✓✓ | keep + **enforce enum: 'sal' \| 'self-diagnosis' \| ...** |
| `status` | varchar | 100% | ✓ | ✓✓ | ✓✓ | keep + **add 'abandoned'** for lifecycle-leak janitor |
| `task_description` | text | 89% | ✓ | ✓✓ | ✓✓ | keep, fix 11% gap (older runs) |
| `task_file` | varchar | **0%** | – | – | – | **drop** |
| `model` | varchar | 100% | ✓ | ✓✓ | ✓✓ | keep |
| `thinking` | bool | partial | ✓ | ✓ | ✓✓ | keep (cross-cut signal for self-awareness) |
| `commit_hash` | varchar | 74% | – | ✓✓ | ✓ | keep |
| `branch_name` | varchar | 74% | – | ✓ | ✓ | keep |
| `workspace_root` | varchar | 100% | ✓ | ✓ | ✓ | keep |
| `config_snapshot` | jsonb | **0%** | ✓ | ✓ | ✓✓ | **wire-writer** (reproducibility of Self-Aware analysis) |
| `started_at` | timestamp | 100% | ✓ | ✓✓ | ✓✓ | keep |
| `ended_at` | timestamp | **42%** | ✓ | ✓✓ | ✓✓ | wire emergency-flush (58% leak via stuck-running) |
| `turn_count` | int | partial | ✓ | ✓ | ✓✓ | keep |
| `total_tokens_used` | int | **0%** | – | ✓ | ✓✓ | **wire-writer** — single most important missing Self signal |
| `total_duration_ms` | int | **42%** | ✓ | ✓ | ✓✓ | same fix as `ended_at` |
| `diff_insertions` | int | partial | – | ✓ | ✓ | keep |
| `diff_deletions` | int | partial | – | ✓ | ✓ | keep |
| `diff_files_changed` | int | partial | – | ✓ | ✓ | keep |
| `error_message` | text | **0%** | – | ✓✓ | ✓ | **wire-writer** for failed runs (currently `status='failed'` count is 0 — even errors leak as 'running') |
| `created_at` | timestamp | 100% | – | – | – | keep |
| `updated_at` | timestamp | 100% | – | – | – | keep |
| `pencil_version` | varchar | 89% | – | ✓✓ | ✓ | keep |

**Critical fixes**: lifecycle leak (53/92), `total_tokens_used` writer, `error_message` + `status='failed'` writer. These three together unblock Self-Aware analyses that today are impossible.

---

## `eval_turns` (392 rows)

Per-turn shell. Heavy join target.

| Field | Type | Fill | SAL | Diag | Self | Rec |
|-------|------|------|-----|------|------|-----|
| `id` | int | 100% | – | – | – | keep (PK) |
| `run_id` | varchar | 100% | ✓✓ | ✓✓ | ✓✓ | keep |
| `turn_id` | int | 100% | ✓✓ | ✓✓ | ✓✓ | keep |
| `event_id` | varchar | 100% | ✓ | ✓ | ✓ | keep |
| `user_prompt` | text | 99% | ✓✓ | ✓✓ | ✓✓ | keep |
| `prompt_truncated` | bool | 0% true | ✓ | ✓ | ✓ | keep, **investigate** — writer may not be firing |
| `assistant_response_length` | int | **0%** | – | ✓ | ✓ | wire-writer (cheap signal) |
| `tokens_used` | int | **0%** | – | ✓ | ✓✓ | **wire-writer** (turn-level token grain) |
| `duration_ms` | int | 100% | ✓ | ✓ | ✓✓ | keep |
| `tools_called` | jsonb | **0%** | – | ✓ | ✓ | **drop** — shadowed by `eval_tool_traces.tool_calls` |
| `started_at` | timestamp | 100% | ✓ | ✓ | ✓ | keep |
| `ended_at` | timestamp | 100% | ✓ | ✓ | ✓✓ | keep |
| `created_at` | timestamp | 100% | – | – | – | keep |

---

## `eval_tool_traces` (382 rows) vs `eval_tool_calls` (0 rows) — **strategic choice**

Two tables, one purpose: record tool invocations. `eval_tool_traces` is per-turn aggregated and **all TEXT** (declared types are wrong). `eval_tool_calls` is per-call granular and properly typed but **never written**. The writer at `extensions/defaults/sal/eval/insforge-sink.ts:316–348` targets `eval_tool_traces` only.

### `eval_tool_traces` (current canonical)

| Field | Type | Fill | SAL | Diag | Self | Rec |
|-------|------|------|-----|------|------|-----|
| `id` | uuid | 100% | – | – | – | keep |
| `run_id` | text | 100% | ✓ | ✓ | ✓✓ | keep |
| `turn_id` | text | 100% | ✓ | ✓ | ✓✓ | type-fix:int |
| `event_id` | text | 100% | ✓ | ✓ | ✓ | keep |
| `tool_calls` | text(JSON) | 100% | – | ✓✓ | ✓✓ | type-fix:jsonb |
| `tool_sequence` | text(JSON) | 100% | – | ✓ | ✓✓ | type-fix:jsonb |
| `intent` | text | 100% (65.7% "unknown") | – | ✓ | ✓ | keep; **classifier needs work** |
| `prompt_length` | text | 100% | – | ✓ | ✓✓ | type-fix:int |
| `has_error_trace` | text | 100% | – | ✓ | ✓ | type-fix:bool |
| `has_file_reference` | text | 100% | – | ✓ | ✓ | type-fix:bool |
| `has_tool_usage` | text | 100% | – | ✓ | ✓ | type-fix:bool |
| `total_tool_calls` | text | 100% | – | ✓ | ✓✓ | type-fix:int |
| `total_errors` | text | 100% | – | ✓✓ | ✓✓ | type-fix:int |
| `completed_tool_calls` | text | 100% | – | ✓ | ✓ | type-fix:int |
| `truncated_tool_calls` | text | 100% | – | ✓ | ✓ | type-fix:int |
| `truncated_tool_summary` | text | 100% | – | ✓ | ✓ | type-fix:int |
| `duration_ms` | text | 100% | – | ✓ | ✓✓ | type-fix:int |
| `recorded_at` | text | 100% | – | ✓ | ✓ | type-fix:timestamptz |
| `created_at` | timestamptz | 100% | – | – | – | keep |
| `updated_at` | timestamptz | 100% | – | – | – | keep |

### `eval_tool_calls` (the typed successor, 0 rows)

Schema is well-typed: `tool_args jsonb`, `result_length int`, `success bool`, `called_at/returned_at timestamp`, `duration_ms int`. **Per-call granular** rather than per-turn aggregated.

### Decision needed

| Option | Pros | Cons |
|--------|------|------|
| **P — Promote `eval_tool_calls`** | proper types, per-call granular (richer signal for Self-Aware), can derive per-turn from per-call | one-time writer rewrite in `insforge-sink.ts`; backfill or accept history-from-traces-only |
| **Q — Stay on `eval_tool_traces` + type-fix in place** | no writer change | 12 column type changes on a 382-row table (PostgREST does support `ALTER COLUMN ... TYPE` but each change is its own DDL); aggregated-only loses per-call timing |

**Lean: P**. Per-call granular is strictly richer; the writer rewrite is small (~20 lines per the existing sink). Backfill the 382 traces or accept them as legacy. **Drop `eval_tool_traces` after backfill window.**

---

## `eval_sal_anchors` (505 rows)

SAL training/eval signal. Mostly active but three columns wired in schema and never written.

| Field | Type | Fill | SAL | Diag | Self | Rec |
|-------|------|------|-----|------|------|-----|
| `id` | int | 100% | – | – | – | keep |
| `run_id` | varchar | 100% | ✓✓ | ✓ | ✓ | keep |
| `turn_id` | int | 100% | ✓✓ | ✓ | ✓ | keep |
| `event_id` | varchar | 100% | ✓ | – | – | keep |
| `anchor_type` | varchar | 100% | ✓✓ | ✓ | ✓ | keep |
| `module_path` | varchar | 21% | ✓✓ | ✓ | ✓ | keep (sparse by anchor_type — expected) |
| `file_path` | varchar | 51% | ✓✓ | ✓ | ✓ | keep |
| `confidence` | real | 58% | ✓✓ | – | ✓ | keep |
| `source` | jsonb | **0%** | ✓✓ | – | ✓ | **wire-writer** — SAL training needs evidence provenance |
| `candidates` | jsonb | 22% | ✓✓ | – | ✓ | keep (sparse by anchor_type) |
| `touched_files` | jsonb | 78% | ✓✓ | ✓ | ✓✓ | keep |
| `unresolved_signals` | jsonb | **0%** | ✓✓ | – | ✓ | wire-writer OR drop (depends on SAL roadmap §Phase-1 plans) |
| `weights_source` | varchar | **0%** | ✓✓ | – | – | **wire-writer** — SAL reproducibility needs this when weights change |
| `recorded_at` | timestamp | 100% | ✓ | ✓ | ✓ | keep |
| `created_at` | timestamp | 100% | – | – | – | keep |

**SAL maintainer call needed**: `source`/`candidates`/`unresolved_signals`/`weights_source` were planned for cognitive-tension modeling. If that branch of the roadmap is still alive, wire writers; if shelved, drop. Currently 3 of 4 are 0%.

---

## `eval_memory_recalls` (5601 rows) — mostly healthy

| Field | Type | Fill | SAL | Diag | Self | Rec |
|-------|------|------|-----|------|------|-----|
| `id` | int | 100% | – | – | – | keep |
| `run_id` | varchar | 100% | ✓✓ | ✓ | ✓ | keep |
| `turn_id` | int | 100% | ✓✓ | ✓ | ✓ | keep |
| `event_id` | varchar | 100% | ✓ | – | – | keep |
| `memory_id` | varchar | 100% | ✓✓ | – | ✓ | keep |
| `memory_kind` | varchar | 100% | ✓✓ | – | ✓ | keep |
| `score_breakdown_status` | varchar | 100% | ✓✓ | – | ✓ | keep |
| `anchor_module` | varchar | 25% | ✓✓ | – | ✓ | keep (sparse by memory_kind/status) |
| `anchor_file` | varchar | 26% | ✓✓ | – | ✓ | keep |
| `score_recency` | real | 82% | ✓✓ | – | ✓ | **investigate** 18% gap (1004 rows missing breakdown despite score_final present) |
| `score_importance` | real | 82% | ✓✓ | – | ✓ | same |
| `score_relevance` | real | 82% | ✓✓ | – | ✓ | same |
| `score_structural` | real | 82% | ✓✓ | – | ✓ | same |
| `score_final` | real | 100% | ✓✓ | – | ✓ | keep |
| `was_injected` | bool | 100% (36% true) | ✓✓ | – | ✓✓ | keep |
| `inject_rank` | int | 36% (matches `was_injected=true`) | ✓✓ | – | ✓✓ | keep (sparseness is correct) |
| `recorded_at` | timestamp | 100% | ✓ | – | ✓ | keep |
| `created_at` | timestamp | 100% | – | – | – | keep |

**One real anomaly**: 1004 rows have `score_final` but missing all 4 sub-scores. Either a writer bug or a legitimate "no breakdown computed" code path. Worth a 10-line investigation but not blocking.

---

## `eval_memory_events` (0 rows) — designed not written

15 columns to track memory create/update/evict (not recalls). Schema looks well-designed but no writer exists.

**Decision**: defer. If SAL roadmap Phase-1 (`memoryHistoryMatch`) gets implemented (per `project_sal_evolution_plan.md`), this table is the natural sink. Until then, neither populate nor drop — just leave a note here and revisit when SAL work resumes.

---

## `eval_metric_results` (0 rows) — **the planned self-diagnosis sink**

| Field | Type | Fill | SAL | Diag | Self | Rec |
|-------|------|------|-----|------|------|-----|
| `id` | int | 100% | – | – | – | keep |
| `run_id` | varchar | 0% | ✓ | ✓ | ✓✓ | keep (FK) |
| `metric_name` | varchar | 0% | ✓ | ✓ | ✓✓ | keep |
| `metric_category` | varchar | 0% | ✓ | ✓ | ✓✓ | keep |
| `score` | real | 0% | ✓ | ✓ | ✓✓ | keep |
| `score_normalized` | real | 0% | ✓ | – | ✓✓ | keep |
| `details` | jsonb | 0% | ✓ | ✓ | ✓✓ | keep |
| `computed_at` | timestamp | 0% | ✓ | ✓ | ✓✓ | keep |
| `computation_method` | varchar | 0% | – | – | ✓✓ | keep (reproducibility) |
| `created_at` | timestamp | 0% | – | – | – | keep |

**All keep**. Wire writer in `scripts/self-diagnosis/lib/eval-sink.ts`. First write: a `metric_category='self-trace'` row per reflexive run.

---

## `eval_raw_events` (0 rows) — drop candidate

| Field | Type | Fill | SAL | Diag | Self | Rec |
|-------|------|------|-----|------|------|-----|
| (10 columns, all unused) | | 0% | – | – | – | **drop entire table** |

Redundant with `eval_tool_traces.tool_calls` (which already carries raw call envelopes). No writer wired. Recommend drop.

---

## `eval_artifact_refs` (0 rows) — drop candidate

| Field | Type | Fill | SAL | Diag | Self | Rec |
|-------|------|------|-----|------|------|-----|
| (9 columns, all unused) | | 0% | – | – | – | **drop entire table** |

`storage.buckets: []` in insforge — no artifact storage configured. Recommend drop.

---

## Action summary

Aggregated across all tables.

### Drop (no purpose claims them)

**Columns**:
- `eval_runs.task_file` (0%)
- `eval_turns.tools_called` (0%, shadowed by tool_traces)

**Tables**:
- `eval_raw_events`
- `eval_artifact_refs`

### Wire-writer (purpose value confirmed, currently 0%)

**High-value** (Self-Aware unblocked):
- `eval_runs.total_tokens_used` ← THE primary token-economy signal
- `eval_runs.config_snapshot` ← reproducibility
- `eval_runs.error_message` ← failed-run forensics (currently `status='failed'` is 0 because errors leak as `running`)
- `eval_turns.tokens_used` ← per-turn token grain
- `eval_metric_results.*` ← the self-diagnosis sink

**SAL-needed** (subject to SAL roadmap confirmation):
- `eval_sal_anchors.source`
- `eval_sal_anchors.weights_source`
- `eval_sal_anchors.unresolved_signals` (or drop)

**Lower-value** (consider):
- `pencil_issue_events.tool_summary` ← links Diag to Self
- `eval_turns.assistant_response_length` ← cheap to add

### Type-fix

**`pencil_issue_events`** (5 cols): `severity` enum, `category` enum, `occurrence_count` int, `first_seen_at`/`last_seen_at`/`recorded_at` timestamptz, `user_approved` bool, `diagnostics` jsonb.

**`eval_tool_traces`** (12 cols): see strategic decision below — either type-fix in place or migrate to `eval_tool_calls`.

### Lifecycle / cleanup

- **53 `eval_runs` rows** stuck at `status='running'` (oldest 2026-04-26). Add `status='abandoned'` enum value; mark all rows with `started_at < now() - 24h AND ended_at IS NULL` as abandoned with synthetic `ended_at = started_at + duration(0)` and `error_message='auto-closed: no run_end received'`.
- After cleanup, enforce: emergency-flush hook on `process.on('exit')` in addition to `beforeExit`/`SIGTERM`.

### Strategic decisions

1. **`eval_tool_traces` vs `eval_tool_calls`**: **P** (promote typed successor) — per-call granular is strictly richer; rewrite the sink writer; backfill or accept legacy.
2. **`eval_memory_events`**: defer until SAL Phase-1 `memoryHistoryMatch` is scheduled. Until then, neither populate nor drop.
3. **`pencil_issue_events.{thinking,tool_summary,mode}`**: wire `tool_summary` (highest Self value), drop `mode` and `thinking` (post-hoc retrieval is impractical).

### Variant enum (new, blocking S3+)

`eval_runs.variant` currently 100% `'sal'`. To prevent self-diagnosis from polluting SAL training data, enforce values:

| Value | Meaning |
|-------|---------|
| `sal` | SAL extension's own eval pipeline (current production usage) |
| `self-diagnosis` | runs originating from `scripts/self-diagnosis/` |
| `(future)` | reserved for future maintainer-driven sources |

`scripts/self-diagnosis/lib/eval-sink.ts` must enforce `variant='self-diagnosis'` on writes.

---

## Maintainer decisions (2026-05-17)

| # | Decision | Status |
|---|----------|--------|
| 1 | **P** — Migrate writer to `eval_tool_calls` (typed successor), drop `eval_tool_traces` after backfill window | accepted |
| 2 | SAL Phase-1 **still planned (IOU)** — keep `eval_memory_events` + `eval_sal_anchors.{source,unresolved_signals,weights_source}` schemas, do **not** wire writers until Phase-1 work is scheduled | accepted |
| 3 | `pencil_issue_events` type-fix **now** (5 columns, 11 rows, near-zero risk) | accepted |
| 4 | `thinking` — **hybrid** — keep `eval_runs.thinking` (configured mode) AND add `eval_turns.thinking` (actual per-turn state); a divergence between the two is itself a Self-Aware signal | accepted |
| 5 | Abandoned-run janitor lives in **`scripts/`** as one-shot, maintainer-invoked, auditable | accepted |

### Consequent revisions to recommendations above

- `eval_tool_traces.*` rows: marked `type-fix:T` are **superseded** — no in-place type-fix; writer migration to `eval_tool_calls` takes precedence. Backfill plan deferred to step B.
- `eval_memory_events` (whole table): not dropped — held as IOU.
- `eval_sal_anchors.source`: keep schema (IOU); writer wiring waits for Phase-1.
- `eval_sal_anchors.unresolved_signals`: keep schema (IOU).
- `eval_sal_anchors.weights_source`: keep schema (IOU).
- `eval_turns`: add new column `thinking bool DEFAULT false`; writer at turn_start mirrors `eval_runs.thinking` initially, model-binding switches mid-run will update it.
- `pencil_issue_events` 5-column type migration: green-lit for immediate execution.

### Still open (call out, not blocking)

These were in the matrix as smaller notes and were not part of the five formal decisions:

- `pencil_issue_events.{thinking, tool_summary, mode}` — wire `tool_summary` writer? Drop `thinking` and `mode`?
- `eval_turns.prompt_truncated` — always false — investigate writer
- `eval_memory_recalls` — 1004 rows with `score_final` but missing 4 sub-scores — investigate
- `eval_tool_traces.intent` classifier — 65.7% "unknown" — improve or accept

---

## What this matrix does NOT cover

- Index strategy (which fields need indexes for analytics queries). Defer until analytics shape is known.
- Foreign key enforcement (`eval_*.run_id → eval_runs.run_id`). Defer until lifecycle cleanup is done — adding FKs to a table with 53 orphan-parent candidates would fail.
- Retention policy (when to delete old rows). Defer; current table sizes are far below any reasonable cap.
- Cross-purpose join performance. Defer.

These belong in a follow-up doc once writer/cleanup work lands.
