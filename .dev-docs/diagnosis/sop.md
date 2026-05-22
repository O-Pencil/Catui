# Daily Pencil Issue Review — SOP

> Single source of truth for the daily 09:00 UTC `daily-pencil-review` routine.
> The routine prompt is intentionally short and points here; edit *this* file to evolve the policy without touching the schedule.

---

## 0. Purpose

Each day, audit fresh runtime diagnostics that real users sent to the InsForge backend (table `pencil_issue_events`, populated by `extensions/defaults/diagnostics/reporter.ts`). Decide for each cluster whether to **fix it directly**, **file an issue ticket**, or **observe**. Never push to remote. Never open PRs. Never alter user-facing semantics without a human.

---

## 1. Pre-flight: credential & connectivity check

Run a no-op query first. If the InsForge MCP tool is unreachable or the table is missing, write the day's report as `status: skipped` with the failure reason and exit. **Do not block on auth errors** — the goal is continuity of the daily log.

```sql
SELECT 1 AS ping;
```

If this fails: create `docs/issues/<YYYY-MM-DD>.md` with:

```md
# YYYY-MM-DD — Daily Pencil Review (SKIPPED)
status: skipped
reason: <short reason, e.g. "insforge credentials missing">
```

Then stop.

---

## 2. Data pull

**Today window** = last 24 hours. **Baseline** = trailing 7 days excluding today.

### 2.1 Today's clusters (primary)

```sql
SELECT
  fingerprint,
  source,
  severity,
  category,
  COUNT(*)                            AS rows_today,
  SUM(NULLIF(occurrence_count,'')::int) AS occurrences_today,
  COUNT(DISTINCT session_id)          AS sessions_today,
  COUNT(DISTINCT version)             AS versions_today,
  MIN(created_at)                     AS first_today,
  MAX(created_at)                     AS last_today,
  ARRAY_AGG(DISTINCT provider) FILTER (WHERE provider IS NOT NULL) AS providers,
  ARRAY_AGG(DISTINCT model_id) FILTER (WHERE model_id IS NOT NULL) AS models
FROM pencil_issue_events
WHERE created_at >= now() - interval '24 hours'
GROUP BY fingerprint, source, severity, category
ORDER BY occurrences_today DESC NULLS LAST, sessions_today DESC;
```

### 2.2 Baseline (for burst detection)

```sql
SELECT fingerprint, SUM(NULLIF(occurrence_count,'')::int) AS occurrences_7d
FROM pencil_issue_events
WHERE created_at >= now() - interval '7 days'
  AND created_at <  now() - interval '24 hours'
GROUP BY fingerprint;
```

A cluster is a **burst** when `occurrences_today >= 3 * (occurrences_7d / 7)` or when it appears today but never in the baseline.

### 2.3 Sample diagnostic payload per cluster

For each cluster from §2.1, pull one representative row to read `diagnostics` JSON, `tool_summary`, `thinking`:

```sql
SELECT diagnostics, tool_summary, thinking, version, commit_hash, message
FROM pencil_issue_events
WHERE fingerprint = $1
  AND created_at >= now() - interval '24 hours'
ORDER BY created_at DESC
LIMIT 1;
```

---

## 3. Cluster classification

For each cluster, walk the decision tree **in order**. The first match wins.

### 3.1 Decision tree

```
A. Locate likely code path
   → parse fingerprint (e.g. "soul.store:loadMemory:parse")
   → grep the repo: ripgrep the fingerprint string + the source token
   → read 1–2 candidate files to confirm where the diagnostic is emitted
   → record the matched file path(s) in the report

B. Classify by location + nature of the fix

   1. Path under HARD CORE BOUNDARY?               → BLOCK
   2. Fix changes a STABILITY CONTRACT?            → REVIEW
   3. Fix is local, low-risk, ≤ 50 lines, 1 file?  → AUTO-FIX
   4. Severity != error AND occurrences_today < 3
      AND not a burst?                             → OBSERVE
   5. Otherwise                                    → REVIEW
```

### 3.2 HARD CORE BOUNDARY (BLOCK — never edit, only file an issue ticket)

- `core/runtime/**`
- `cli.ts`, `main.ts`, `migrations.ts`
- `packages/agent-core/**`
- `packages/ai/**`

### 3.3 STABILITY CONTRACTS (REVIEW — file a ticket even if code is outside core)

A change is REVIEW-only if it would alter any of:

- **Persistence format** of `packages/mem-core/` or `packages/soul-core/` JSON files (adding/renaming/removing fields, changing semantics of existing fields). Local bug fixes that preserve the on-disk schema are AUTO-FIX-eligible.
- **Write side of telemetry tables**: `extensions/defaults/diagnostics/`, `extensions/defaults/sal/eval/` — schema, fingerprint algorithm, redaction behavior.
- **Prompt templates** shipped to the model (`core/prompt/**`, any `*system-prompt*` / `*persona*` strings).
- **Tool protocol or extension lifecycle hooks** (`core/tools/index.ts`, `core/extensions/types.ts`, hook signatures).
- **Network contract**: HTTP endpoints, header names, body shape sent to InsForge or any other backend.
- **`config.ts`** discovery / precedence / env-var names.
- **Public exports** in `index.ts` (root) or any package `index.ts`.
- **Migrations and on-disk schema versions** beyond `migrations.ts`.

### 3.4 AUTO-FIX scope (the only places direct edits are allowed)

A fix qualifies as AUTO-FIX **only if all** are true:

- Touches **≤ 1 file** (a sibling test file is allowed as a 2nd file).
- **≤ 50 lines** changed total (excluding pure whitespace).
- Stays outside §3.2 and does not violate §3.3.
- Is one of: error-message wording, log text, redaction rule addition, defensive `try/catch` around an already-handled fallback path, fixing a typo, hardening a JSON parse with a clearer fallback, adjusting a non-default extension's local control flow.
- A relevant existing test still passes, or a new focused test is added next to the change.

### 3.5 OBSERVE

`severity != error`, `occurrences_today < 3`, not a burst, fingerprint already seen in the 7-day baseline at similar rate → list in today's report under "Observation watchlist", no ticket, no fix.

---

## 4. Action protocol

### 4.1 BLOCK / REVIEW → file an issue ticket

Write `docs/issues/<YYYY-MM-DD>/<short-fp-slug>.md` using `docs/issues/_template-issue.md`. The slug is the fingerprint lower-cased, non-alnum→`-`, truncated to 60 chars.

The ticket must contain:

- `fingerprint`, `source`, `severity`, `category`
- `occurrences_today`, `sessions_today`, `versions_today`, `providers`, `models`
- Likely code path(s) (from §3.1 step A)
- A redacted snippet of one `diagnostics` payload (strip absolute paths, usernames, API keys — see §6)
- Classification reason (which row of §3.1 fired)
- A suggested next step phrased as a question for the human (e.g. "Should the soul memory loader treat NUL-byte payloads as a corruption signal and back up + reset?")

Do **not** edit any code.

### 4.2 AUTO-FIX → branch + edit + verify + commit (no push)

1. `git switch -c auto/issue-<YYYYMMDD>-<short-fp>` from the current `main` HEAD (or current branch if not on `main`; if dirty, abort the AUTO-FIX and downgrade the cluster to REVIEW).
2. Make the edit.
3. Run:
   - `npx tsc --noEmit` (must pass)
   - Any directly related test, e.g. `npx vitest run <file>` if a `*.test.ts` exists nearby.
4. `git add <files> && git commit -m "fix(<scope>): <summary> [fp=<fingerprint>]"`
   - Commit body cites: cluster fingerprint, observed count, today's report path.
   - No `Co-Authored-By` trailer, no "Generated with Claude Code" footer.
5. Return to the previous branch (`git switch -`). Do **not** merge, **not** push.
6. Record the commit hash + branch name in today's report under "Auto-fixes applied".

If any step from 3–4 fails: roll back the branch (`git switch - && git branch -D auto/issue-<YYYYMMDD>-<short-fp>`), demote the cluster to **REVIEW**, and file a ticket noting the attempted fix and the failure mode.

### 4.3 OBSERVE → just log

Listed in the day's report only. No file, no commit.

---

## 5. Daily report

Always write `docs/issues/<YYYY-MM-DD>.md` (even on a zero-event day), using `docs/issues/_template-daily.md`. The report is the canonical index for that day; individual tickets under `docs/issues/<YYYY-MM-DD>/` are linked from it.

Sections, in order:

1. Header (date, status, window, totals).
2. **Action summary**: counts of BLOCK / REVIEW / AUTO-FIX / OBSERVE.
3. **Auto-fixes applied** (one row per commit): fingerprint, branch, commit hash, file.
4. **Issue tickets filed** (one row per ticket): fingerprint, severity, ticket link, one-line rationale.
5. **Observation watchlist**: fingerprint, occurrences_today, occurrences_7d, note.
6. **Burst detector**: clusters where today ≥ 3× baseline rate.
7. **Notes** (optional): anomalies, schema surprises, anything the human should glance at.

---

## 6. Redaction

`diagnostics` payloads can contain absolute paths (Windows `C:\Users\<name>\…`), file system errors with usernames, partial prompts, model output prefixes. Before quoting in any ticket or report:

- Replace `/home/<user>/`, `/Users/<user>/`, `C:\\Users\\<user>\\` with `<home>/`.
- Truncate `output_prefix`, `system_prompt_prefix`, raw model text to first 120 chars + `…`.
- Strip any `Authorization`, `api_key`, `anonKey`, `Bearer ` tokens if they somehow appear.
- Keep fingerprints, error codes (`PGRST102`), stack frames, file paths *within the repo*.

`extensions/defaults/diagnostics/redaction.ts` already runs at write time, but the SOP repeats the discipline because the SOP report is human-readable and may be shared.

---

## 7. Operating constraints

- **No `git push`.** Ever. Local commits only.
- **No PR creation.**
- **No `--no-verify`, no hook bypass.**
- **No edits outside `docs/issues/**` and the §3.4 AUTO-FIX-eligible files.**
- **No schedule self-modification.** If the SOP itself needs to change, file a ticket about it.
- Stay on a non-`main` branch for any AUTO-FIX. If `git status` is dirty at start, downgrade everything to REVIEW for the day.

---

## 8. Closing summary

At the end of the run, print a one-screen summary to the log:

```
Daily Pencil review — <YYYY-MM-DD>
  clusters analyzed: N
  AUTO-FIX commits:  X (branches: ...)
  tickets filed:     Y (paths: docs/issues/<date>/...)
  OBSERVE entries:   Z
  status:            ok | skipped | partial
```

---

## 9. Evolution

Add or sharpen rules here; do not embed policy in the schedule prompt. Bump the `policy_version` field in the daily report header when §3 changes materially, so historical reports can be re-interpreted.

`policy_version: 1`
