# InsForge Cleanup Plan — Dry Run

> **Status**: dry-run, 2026-05-17. Sourced from `.dev-docs/data/field-purpose-matrix.md` and the five maintainer decisions captured there. **Nothing has been executed.** When MCP reconnects (or via direct PostgREST access), the maintainer runs these blocks in order. Each block is independent unless noted.
>
> **Risk policy**: any SQL touching > 100 rows, or any `DROP TABLE`, is paused for explicit confirmation before execution. Type-fixes on `pencil_issue_events` (11 rows) are pre-authorized.

---

## Order of execution

1. **B1** — Drop dead columns + drop dead tables (safe; small surface)
2. **B2** — `pencil_issue_events` type-fix (decision 3; 5 columns; 11 rows)
3. **B4** — Mark 53 abandoned `eval_runs` rows (decision 5 reapplied as cleanup; janitor lives in `scripts/` per decision 5, but the one-shot SQL is here for the initial sweep)
4. **B5** — Add `eval_turns.thinking` column (decision 4 hybrid)
5. **B6** — `eval_runs.variant` CHECK constraint (forward-compat note — do NOT apply standalone; included with the next variant addition)
6. **B3** — Writer migration `eval_tool_traces` → `eval_tool_calls` (decision 1, **REVIEW ticket required** — code change in `extensions/defaults/sal/eval/insforge-sink.ts`)

B3 is last because it requires a code-side change reviewed separately. B1–B5 are pure DDL/DML on the developer database; B6 is documentation-only until triggered.

---

## B1 — Drop dead columns + dead tables

### B1.a — Drop dead columns

Source: matrix §"Action summary → Drop columns".

```sql
ALTER TABLE eval_runs DROP COLUMN task_file;
ALTER TABLE eval_turns DROP COLUMN tools_called;
```

Verify (run before AND after):

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('eval_runs','eval_turns')
  AND column_name IN ('task_file','tools_called');
-- before: 2 rows; after: 0 rows
```

### B1.b — Drop dead tables

```sql
DROP TABLE eval_raw_events;
DROP TABLE eval_artifact_refs;
```

Verify:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN ('eval_raw_events','eval_artifact_refs');
-- before: 2 rows; after: 0 rows
```

**Held back per decision 2 (SAL Phase-1 IOU)**: `eval_memory_events` table — keep, do not drop. `eval_sal_anchors.{source,unresolved_signals,weights_source}` columns — keep, do not drop.

---

## B2 — `pencil_issue_events` type-fix (decision 3, pre-authorized)

11 rows; cost is essentially zero. Five columns currently stored as `text` should be `int`, `bool`, `timestamptz`, or `jsonb` per the matrix.

```sql
-- occurrence_count: text → int
ALTER TABLE pencil_issue_events
  ALTER COLUMN occurrence_count TYPE int
  USING NULLIF(occurrence_count, '')::int;

-- first_seen_at / last_seen_at / recorded_at: text → timestamptz
ALTER TABLE pencil_issue_events
  ALTER COLUMN first_seen_at TYPE timestamptz
  USING NULLIF(first_seen_at, '')::timestamptz;

ALTER TABLE pencil_issue_events
  ALTER COLUMN last_seen_at TYPE timestamptz
  USING NULLIF(last_seen_at, '')::timestamptz;

ALTER TABLE pencil_issue_events
  ALTER COLUMN recorded_at TYPE timestamptz
  USING NULLIF(recorded_at, '')::timestamptz;

-- user_approved: text → bool
ALTER TABLE pencil_issue_events
  ALTER COLUMN user_approved TYPE bool
  USING (NULLIF(user_approved, '') = 'true');

-- diagnostics: text → jsonb (already JSON-shaped per sample rows)
ALTER TABLE pencil_issue_events
  ALTER COLUMN diagnostics TYPE jsonb
  USING NULLIF(diagnostics, '')::jsonb;
```

Verify:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='pencil_issue_events'
  AND column_name IN ('occurrence_count','first_seen_at','last_seen_at','recorded_at','user_approved','diagnostics');
```

Expected after:

| column_name | data_type |
|-------------|-----------|
| occurrence_count | integer |
| first_seen_at | timestamp with time zone |
| last_seen_at | timestamp with time zone |
| recorded_at | timestamp with time zone |
| user_approved | boolean |
| diagnostics | jsonb |

**Deferred from this pass** (decision-still-open per matrix "Still open"):

- `severity` / `category` text → enum — defer, depends on agreeing the value sets first
- Drop columns `thinking`, `mode` (and maybe `user_note`) — defer, depends on the "wire writer or drop" call for `tool_summary`

---

## B4 — Mark 53 abandoned `eval_runs`

Audit at 2026-05-17T09:20Z found 53 rows with `status='running'` and oldest `started_at` from 2026-04-26. The fresh row from 2026-05-17 (`np-2026-05-17T10-45-52-7essp2`) is the 54th and also stuck. None will ever receive a real `run_end`.

This sweep is a **one-shot cleanup**. Going forward the same sweep lives in `scripts/self-diagnosis/lib/cleanup-abandoned-runs.ts` (per decision 5) and is run by the maintainer when needed. The first run of that script can be skipped if this SQL is applied directly here.

```sql
-- Verify scope before update
SELECT COUNT(*) AS to_be_abandoned
FROM eval_runs
WHERE status = 'running'
  AND started_at < now() - interval '24 hours'
  AND ended_at IS NULL;
-- expected: 53 (or 54 if the 2026-05-17 run also qualifies — it does, started ~5h ago — wait, ~5h is < 24h, so this row will NOT be caught unless threshold lowered)
```

**Threshold note**: 24h excludes the 2026-05-17 run because it started ~5h before the audit. Two choices:

| Choice | Threshold | Catches |
|--------|-----------|---------|
| (i) Strict 24h | `started_at < now() - interval '24 hours'` | 53 historical rows; leaves 2026-05-17 to age into the next sweep |
| (ii) Aggressive (this-run-too) | `started_at < now() - interval '4 hours'` | All 54 |

Maintainer pick. Default below uses (i); flip if you want.

```sql
UPDATE eval_runs
SET
  status = 'abandoned',
  ended_at = started_at + interval '1 second',  -- synthetic; signals "we don't know when it actually ended"
  error_message = 'auto-closed by cleanup-plan B4: no run_end received'
WHERE status = 'running'
  AND started_at < now() - interval '24 hours'
  AND ended_at IS NULL;
-- expected rows affected: 53
```

Verify:

```sql
SELECT status, COUNT(*)
FROM eval_runs
GROUP BY status;
-- expected: 'completed' 39, 'abandoned' 53, 'running' 1 (the 2026-05-17 one) | 0 (if (ii) used)
```

After this lands, the matrix's `eval_runs.ended_at` fill rate jumps from 42% (39/92) to >95%.

---

## B5 — Add `eval_turns.thinking` (decision 4 hybrid)

Decision 4: keep `eval_runs.thinking` AND add `eval_turns.thinking`. The new column starts NULL or `false` for historical rows; the writer at turn_start fills it going forward.

```sql
ALTER TABLE eval_turns
  ADD COLUMN thinking bool DEFAULT false;
```

Backfill historical rows from parent `eval_runs.thinking`:

```sql
UPDATE eval_turns t
SET thinking = COALESCE(r.thinking, false)
FROM eval_runs r
WHERE t.run_id = r.run_id
  AND t.thinking IS NULL;  -- only touches newly-added column on existing rows
-- expected rows affected: 392
```

Verify:

```sql
SELECT COUNT(*) AS rows_with_thinking_set
FROM eval_turns
WHERE thinking IS NOT NULL;
-- expected: 392
```

The corresponding writer change in `extensions/defaults/sal/eval/insforge-sink.ts:handleTurnAnchor()` is a separate REVIEW ticket — see C below.

---

## B6 — `eval_runs.variant` enum constraint (forward-compatibility)

> Status: forward-compat note, not for immediate execution. Recorded because the working scripts already depend on this being correct.

The matrix's "Variant enum (new, blocking S3+)" section recommends formalizing `eval_runs.variant` as a CHECK constraint. Today the column is plain `varchar` with no validation; both `'sal'` and `'self-diagnosis'` rows write fine. The risk window opens **the day a future migration adds the constraint** — if `'self-diagnosis'` is forgotten from the allowed set, every `scripts/self-diagnosis/` run starts failing at `run_start` (PostgREST returns 23514).

When the constraint is added, the SQL must include all of:

```sql
ALTER TABLE eval_runs
  ADD CONSTRAINT eval_runs_variant_chk
  CHECK (variant IN ('sal', 'control', 'baseline', 'self-diagnosis'));
```

Sources of truth that need to stay in lockstep with this list:

| Layer | File / location |
|-------|-----------------|
| Database CHECK constraint | this SQL (when applied) |
| SAL extension TypeScript type | `extensions/defaults/sal/eval/types.ts:14` (`EvalVariant` union) |
| SAL extension env-var whitelist | `extensions/defaults/sal/index.ts:755` (the `evalVariantEnv === ...` chain) |
| scripts side | `scripts/self-diagnosis/lib/eval-sink.ts` `VARIANT` const |

As of 2026-05-18, all four layers list `"self-diagnosis"` (the SAL pair was added in this branch). Any new variant — e.g. a future `"perf-baseline"` archetype — must update all four.

Drop the constraint and re-add as part of the same migration when a new variant is needed; this is the simplest safe path.

---

## B3 — Writer migration to `eval_tool_calls` (decision 1, REVIEW ticket required)

This is **not** a pure SQL change. The writer at `extensions/defaults/sal/eval/insforge-sink.ts:316-348` currently builds an all-TEXT row for `eval_tool_traces`. To switch to `eval_tool_calls` we need:

1. Rewrite `handleToolTrace()` to emit one row **per tool call** (currently one row per turn).
2. Cast values to the correct types (the destination columns are int/bool/timestamp, not text).
3. Decide on backfill: replay the 382 historical traces into `eval_tool_calls`, or accept `eval_tool_traces` as legacy and start fresh.

**File location**: `extensions/defaults/sal/eval/insforge-sink.ts` — SOP §3.3 telemetry-write-side. **REVIEW ticket required**, not AUTO-FIX.

**SQL preview** (the destination table is already correctly typed; no DDL needed):

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='eval_tool_calls'
ORDER BY ordinal_position;
-- already has: tool_args jsonb, result_length int, success bool, called_at/returned_at timestamp, duration_ms int — types are correct
```

After B3 lands and runs for a while, the legacy table is dropped:

```sql
-- DEFERRED until 30 days after the new writer is live AND backfill decision is made
DROP TABLE eval_tool_traces;
```

---

## Aftermath checks

After B1–B5 complete, the matrix's "Action summary" should look like this (re-verify after execution):

| Item | Before | After |
|------|--------|-------|
| `eval_runs.task_file` exists | yes | **dropped** |
| `eval_turns.tools_called` exists | yes | **dropped** |
| `eval_raw_events` exists | yes | **dropped** |
| `eval_artifact_refs` exists | yes | **dropped** |
| `pencil_issue_events.occurrence_count` type | text | **integer** |
| `pencil_issue_events.first_seen_at` type | text | **timestamptz** |
| `pencil_issue_events.user_approved` type | text | **boolean** |
| `pencil_issue_events.diagnostics` type | text | **jsonb** |
| `eval_runs status='running'` count (>24h) | 53 | **0** |
| `eval_runs status='abandoned'` count | 0 | **53** |
| `eval_turns.thinking` exists | no | **yes (bool, default false)** |

B3 is its own milestone — track via the REVIEW ticket.

---

## What this plan does NOT include

Deliberately deferred:

- **`eval_runs.total_tokens_used` writer**: requires code change in `extensions/defaults/sal/eval/insforge-sink.ts:handleRunEnd()` + a token accumulator in the SAL extension. Listed in `.dev-docs/data/writer-todos.md`.
- **`eval_runs.error_message` writer**: same file; needs a `status='failed'` path. Listed in writer-todos.
- **`eval_runs.config_snapshot` writer**: same file; capture config at run_start.
- **Index strategy**: defer until analytics shape is known.
- **Foreign key enforcement**: defer until B4 is applied (FK to `eval_runs.run_id` would fail before stale rows are closed).
- **Retention policy**: defer; table sizes are far below any cap.
- **SAL Phase-1 writers** (`eval_memory_events`, `eval_sal_anchors.{source,unresolved_signals,weights_source}`): held as IOU per decision 2.
- **`pencil_issue_events.{thinking,tool_summary,mode}`** wire-or-drop: open question in the matrix; defer.

---

## Rollback notes

For each block, the rollback path:

- **B1.a** (drop columns): re-add with the same type and default; existing data lost. Risk: 0% — the columns were 0% filled.
- **B1.b** (drop tables): re-create from schema source; existing data lost. Risk: 0% — the tables were 0 rows.
- **B2** (type-fix): `ALTER COLUMN ... TYPE text USING <col>::text` reverses the cast. Risk: low; reversal is fully invertible.
- **B4** (abandoned mark): `UPDATE ... SET status='running', ended_at=NULL, error_message=NULL WHERE error_message LIKE 'auto-closed by cleanup-plan B4:%'`. Risk: 0%.
- **B5** (add column): `ALTER TABLE eval_turns DROP COLUMN thinking`. Risk: 0%.

All five blocks are individually reversible. B3 (writer migration) has its own rollback plan in the REVIEW ticket.
