# Daily Pencil Issue Diagnosis — SOP

> ⚠ **Audience: Claude Code agent (executor) + pencil maintainer (reviewer).** This SOP is invoked by a daily cron registered inside the maintainer's persistent Claude Code session. The agent reads this file end-to-end every fire, executes the procedure against the developer-owned InsForge backend via MCP, and writes its findings to `.dev-docs/diagnosis/runs/<date>.md`. The maintainer audits those findings asynchronously.
>
> The agent is **not** allowed to spawn the pencil binary (`npm run dev`, `npx tsx cli.ts --print`, `npm run build`, anything that boots a pencil session). All work is static reads + SQL queries + targeted file edits + `tsc` / `vitest` invocations. See §7.
>
> The routine prompt that fires this is intentionally short and points here. Edit *this* file to evolve the policy without touching the cron registration.

---

## 0. Purpose

Each day, audit fresh runtime diagnostics that real pencil sessions sent to the InsForge backend (table `pencil_issue_events`, populated by `extensions/defaults/diagnostics/reporter.ts`). For each fingerprint cluster, decide:

- **fix it directly** (AUTO-FIX → commit + test report → maintainer review),
- **file an issue** (BLOCK / REVIEW → markdown ticket → maintainer review),
- or **just observe** (OBSERVE → log only).

Never push. Never open PRs. Never alter user-facing semantics. Never run pencil.

---

## 1. Pre-flight: MCP connectivity check

The agent calls `mcp__insforge__run-raw-sql` with a single ping. If the tool is unreachable (MCP server disconnected, schema missing, transient outage), write the day's report as `status: skipped` and exit cleanly. The continuity of the daily log is more important than running on a degraded backend.

```sql
SELECT 1 AS ping;
```

If this fails: write `.dev-docs/diagnosis/runs/<YYYY-MM-DD>.md` containing only:

```md
# YYYY-MM-DD — Daily Pencil Diagnosis (SKIPPED)
status: skipped
reason: <short reason, e.g. "insforge MCP disconnected at fire time">
```

Then stop. No file edits, no commits.

**No credentials check** — the agent does not need `.memory-experiments/credentials.json`. The MCP connector is injected at the Claude Code layer, and pencil-side credentials are irrelevant to this SOP (the agent doesn't run pencil).

---

## 2. Data pull

**Today window** = last 24 hours, measured against `now()` in the InsForge server clock. **Baseline** = trailing 7 days excluding today.

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
   → ripgrep the fingerprint string + the source token across the repo
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

### 3.3 STABILITY CONTRACTS (REVIEW — file a ticket even if code is outside the hard core)

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
- An existing test next to the change still passes (or a new focused test is added in the same file/directory).
- The agent has **not** spawned any pencil process — `npx tsc --noEmit` + `npx vitest run <single-file>` only. Running `npm run dev` or `npm run build` is disallowed (see §7).

### 3.5 OBSERVE

`severity != error`, `occurrences_today < 3`, not a burst, fingerprint already seen in the 7-day baseline at similar rate → list in today's report under "Observation watchlist", no ticket, no fix.

---

## 4. Action protocol

### 4.1 BLOCK / REVIEW → file an issue ticket

Write `.dev-docs/diagnosis/runs/<YYYY-MM-DD>/<short-fp-slug>.md` using `.dev-docs/diagnosis/_templates/issue.md`. The slug is the fingerprint lower-cased, non-alnum → `-`, truncated to 60 chars.

The ticket must contain:

- `fingerprint`, `source`, `severity`, `category`
- `occurrences_today`, `sessions_today`, `versions_today`, `providers`, `models`
- Likely code path(s) (from §3.1 step A)
- A redacted snippet of one `diagnostics` payload (strip absolute paths, usernames, API keys — see §6)
- Classification reason (which row of §3.1 fired)
- A suggested next step phrased as a question for the maintainer

The agent does **not** edit any code in this branch.

### 4.2 AUTO-FIX → branch + edit + verify + commit + test report

1. **Pre-conditions**:
   - `git status` is clean. If dirty, abort the AUTO-FIX and downgrade the cluster to REVIEW.
   - Current branch is not `main` (don't carve auto-fix branches off `main` directly; carve off whatever branch the maintainer left the workspace on; if that branch is `main`, abort and demote to REVIEW so the maintainer can sequence the work).
2. `git switch -c auto/issue-<YYYYMMDD>-<short-fp>`.
3. Make the edit.
4. **Verify** (these are the only build-adjacent commands the agent may run; see §7):
   - `npx tsc --noEmit` — must pass.
   - `npx vitest run <file>` for the single test file adjacent to the change, if one exists. Do **not** run the whole vitest suite (memory cost).
5. **Write the test report** to `.dev-docs/diagnosis/runs/<YYYY-MM-DD>/auto-fix-reports/<short-fp-slug>.md`. Schema in §4.2.1 below.
6. `git add <files> && git commit -m "fix(<scope>): <summary> [fp=<fingerprint>]"`.
   - Commit body cites: cluster fingerprint, observed count, today's report path, test-report path.
   - No `Co-Authored-By` trailer, no "Generated with Claude Code" footer (project policy).
7. `git switch -` back to the original branch. Do **not** merge, **not** push.
8. Record commit hash + branch name + test-report path in today's daily report under "Auto-fixes applied".

If steps 4–6 fail: roll back the branch (`git switch - && git branch -D auto/issue-<YYYYMMDD>-<short-fp>`), demote the cluster to **REVIEW**, file a ticket noting the attempted fix and the failure mode. The aborted attempt's logs go into the new ticket's "Suggested options" section so the maintainer doesn't repeat the dead end.

#### 4.2.1 Test-report schema

`.dev-docs/diagnosis/runs/<YYYY-MM-DD>/auto-fix-reports/<short-fp-slug>.md`:

```markdown
# Auto-fix Report — <fingerprint>

```yaml
classified_as: AUTO-FIX
fingerprint: <full fingerprint>
date: YYYY-MM-DD
branch: auto/issue-YYYYMMDD-<slug>
commit: <hash>
parent_branch: <branch the auto-fix carved off>
files_touched: <count>
lines_added: <int>
lines_removed: <int>
```

## Change summary

One paragraph: what changed and why this specific code path was the right place.

## Files changed

- `path/to/file.ts` (+12 / -3)
- `path/to/file.test.ts` (+4 / -0)  (if added)

## Verification

### tsc

```
$ npx tsc --noEmit
<output>
```

### vitest (related file only)

```
$ npx vitest run path/to/file.test.ts
<output, last 30 lines>
```

## Impact radius

- Direct callers identified by grep: `<count>` files, listed below.
- Files in the same module: `<count>`.
- Type signatures changed: `yes / no`.
- Any of §3.2 / §3.3 touched: `no` (must be no, else this shouldn't be AUTO-FIX).

## Maintainer review checklist

- [ ] commit message accurately scopes the change
- [ ] no scope creep beyond the original cluster
- [ ] regression coverage is adequate
- [ ] no `Co-Authored-By` trailer in the commit
- [ ] OK to merge `auto/issue-YYYYMMDD-<slug>` into `main` (or close the branch and discard)

## References

- Daily report: `../<YYYY-MM-DD>.md`
- Sister ticket (if any): `../<short-fp-slug>.md`
```

The test report is **archival**, never auto-modified after creation. If the maintainer rejects the fix, they close the branch and the report stays as a record of the attempt.

### 4.3 OBSERVE → just log

Listed in the day's daily report. No issue ticket, no test report, no commit.

---

## 5. Daily report

Always write `.dev-docs/diagnosis/runs/<YYYY-MM-DD>.md` (even on a zero-event day), using `.dev-docs/diagnosis/_templates/daily.md`. The daily report is the canonical index for that day; individual tickets and test reports are linked from it.

Sections, in order:

1. Header (date, status, window, totals).
2. **Action summary**: counts of BLOCK / REVIEW / AUTO-FIX / OBSERVE.
3. **Auto-fixes applied** (one row per commit): fingerprint, branch, commit hash, file(s), test-report link.
4. **Issue tickets filed** (one row per ticket): fingerprint, severity, ticket link, one-line rationale.
5. **Observation watchlist**: fingerprint, occurrences_today, occurrences_7d, note.
6. **Burst detector**: clusters where today ≥ 3× baseline rate.
7. **Notes** (optional): anomalies, schema surprises, anything the maintainer should glance at.

---

## 6. Redaction

`diagnostics` payloads can contain absolute paths (Windows `C:\Users\<name>\…`), file system errors with usernames, partial prompts, model output prefixes. Before quoting in any ticket, test report, or daily report:

- Replace `/home/<user>/`, `/Users/<user>/`, `C:\\Users\\<user>\\` with `<home>/`.
- Truncate `output_prefix`, `system_prompt_prefix`, raw model text to first 120 chars + `…`.
- Strip any `Authorization`, `api_key`, `anonKey`, `Bearer ` tokens if they somehow appear.
- Keep fingerprints, error codes (`PGRST102`), stack frames, repo-relative file paths.

`extensions/defaults/diagnostics/redaction.ts` already runs at write time, but the SOP repeats the discipline because reports are human-readable and may be shared.

---

## 7. Operating constraints

Hard rules. Any violation aborts the run and writes a SKIPPED daily report explaining what was almost done.

**Process model**:
- The agent does **not** spawn the pencil binary. No `npm run dev`, no `npx tsx cli.ts --print`, no `node dist/cli.js`, no `npm start`.
- The agent does **not** run `npm run build`. The repo is read-only with respect to compiled artifacts.
- The agent does **not** install packages. No `npm install`, no `npm ci`.
- The only build-adjacent commands allowed are `npx tsc --noEmit` (whole-repo, ~3 GB RAM-safe based on prior runs) and `npx vitest run <single-test-file>`. Both are read-only with respect to build outputs and bounded in memory.

**Git**:
- **No `git push`.** Ever. Local commits only.
- **No PR creation.**
- **No `--no-verify`, no hook bypass.**
- AUTO-FIX commits go on `auto/issue-YYYYMMDD-<slug>` branches. Never `auto/...` straight off `main`; if HEAD is `main`, demote to REVIEW.
- If working tree is dirty at pre-flight, demote everything to REVIEW for the day.

**Files**:
- **No edits outside** `.dev-docs/diagnosis/runs/**` and the §3.4 AUTO-FIX-eligible file set.
- **No schedule self-modification.** If the SOP itself needs to change, file a REVIEW ticket about it.
- **No edits to `.dev-docs/architecture-review/**`** — that subtree is owned by a separate Agent (see `.dev-docs/architecture-review/handoff.md`).

**Resources**:
- Stop and SKIP the day if free RAM drops below 100 MiB at pre-flight (this machine has historically run with ~400 MiB free; below 100 is the danger zone).
- Stop and SKIP if available disk on `/` drops below 2 GiB.

---

## 8. Closing summary

At the end of the run, the agent prints a one-screen summary into the Claude conversation (so the maintainer sees it the next time they read the session):

```
Daily Pencil diagnosis — <YYYY-MM-DD>
  clusters analyzed: N
  AUTO-FIX commits:  X (branches: ...)
  tickets filed:     Y (paths: .dev-docs/diagnosis/runs/<date>/...)
  test reports:      X (paths: .dev-docs/diagnosis/runs/<date>/auto-fix-reports/...)
  OBSERVE entries:   Z
  status:            ok | skipped | partial
```

If `status: skipped`, the message says **why** (MCP disconnected, dirty tree, low memory, etc.).

---

## 9. Evolution

Add or sharpen rules here; do not embed policy in the cron prompt. Bump the `policy_version` field in the daily report header when §3 changes materially, so historical reports can be re-interpreted.

### 9.1 Branch and PR workflow (single persistent branch)

The agent commits its daily output to **one persistent branch**, `agent/diagnosis`. There is **one rolling PR** open against `main` for that branch. Every day's findings accrue as new commits on the same branch; the PR is updated, not duplicated. The Review Agent (`.dev-docs/diagnosis/review-sop.md`) reviews each new commit on the rolling PR; the maintainer decides when to merge.

The earlier per-day-branch design (SOP v3) was rejected: too many PRs for a single maintainer to track. Single branch + rolling PR + automated review is the v4 contract.

#### 9.1.1 Branch summary

| Branch | Persistence | Carved from | Contents |
|--------|-------------|-------------|----------|
| `agent/diagnosis` | **persistent** — never deleted; rebased onto `main` after each merge | `main` initially; rebased on `origin/main` after each merge cycle | All daily reports + BLOCK/REVIEW tickets + auto-fix-reports — markdown only, all under `.dev-docs/diagnosis/runs/` |
| `auto/issue-<YYYYMMDD>-<short-fp-slug>` | one per AUTO-FIX — ephemeral, deleted on merge | `origin/main` directly | The source-code change (one fix per branch); the matching test-report markdown lands on `agent/diagnosis`, not on the auto-fix branch |

AUTO-FIX branches stay per-fix (not folded into `agent/diagnosis`) so each fix is independently mergeable: rejecting one fix never blocks the others or the daily docs.

#### 9.1.2 Per-run lifecycle

```
1. Pre-flight (§1)
   - `git fetch origin main`
   - `git fetch origin agent/diagnosis || true`   # branch may not yet exist
   - if `agent/diagnosis` exists on origin:
       - if the open PR (`agent/diagnosis -> main`) was just merged
         (commits the agent doesn't recognize landed on `origin/main`):
           - rebase: `git switch agent/diagnosis &&
             git fetch origin main && git rebase origin/main`
           - if rebase has conflicts → ABORT, write SKIPPED with reason
             "agent/diagnosis rebase conflict — needs maintainer"
       - else: just check out the branch as-is, ready to add today's commit
   - if `agent/diagnosis` does NOT exist:
       - `git switch -c agent/diagnosis origin/main`

2. Run SOP §2-§4 as usual, on `agent/diagnosis`.

3. AUTO-FIX (§4.2):
   - For each AUTO-FIX cluster:
       - `git switch -c auto/issue-<YYYYMMDD>-<slug> origin/main`
       - Edit + verify (`tsc --noEmit` + `vitest run <one-file>`) + commit.
       - `git switch agent/diagnosis` to return.
   - Write the test-report markdown at
     `.dev-docs/diagnosis/runs/<today>/auto-fix-reports/<slug>.md`
     on `agent/diagnosis` (NOT on the auto-fix branch).

4. Write the daily report at `.dev-docs/diagnosis/runs/<today>.md` and any
   BLOCK/REVIEW tickets at `.dev-docs/diagnosis/runs/<today>/<slug>.md`
   on `agent/diagnosis`.

5. Commit on `agent/diagnosis`:
   `git commit -m "diagnosis(<today>): N clusters, X auto-fix, Y review tickets"`

6. End of run:
   - `git push origin agent/diagnosis`   # rolling PR auto-updates
   - For each auto-fix branch created: `git push origin auto/issue-<...>`
   - If the rolling PR doesn't yet exist (first ever run), the agent opens it
     via `gh pr create` if `gh` is available; otherwise prints the PR URL in
     the §8 closing summary so the maintainer opens it manually. From then on,
     `agent/diagnosis` already has an open PR and pushes are enough to update.
   - Each new auto-fix branch gets its own PR (created the same way).
```

#### 9.1.3 PR conventions

| Branch | PR title | PR body |
|--------|----------|---------|
| `agent/diagnosis` (one rolling PR) | `diagnosis: rolling daily output (latest <YYYY-MM-DD>)` | The PR body is rewritten on each agent run to list the latest day's summary plus a link table of all included daily reports. The body is short; details live in the linked files. |
| `auto/issue-<date>-<slug>` (one PR per fix) | `fix(<scope>): <one-line> [fp=<fingerprint>]` | Test-report markdown verbatim + a link to the matching ticket/report on `agent/diagnosis`. |

The Review Agent (§9.4 + `review-sop.md`) reviews these PRs; the maintainer decides when to merge.

#### 9.1.4 Branch cleanup

| Branch | Cleanup |
|--------|---------|
| `agent/diagnosis` | **never deleted**. After each maintainer-triggered merge, the agent rebases this branch onto the new `origin/main`. The rolling PR closes on merge (GitHub closes the PR when the branch FF-merges). The agent re-opens a new rolling PR on the next run (still targeting `main` from `agent/diagnosis`). |
| `auto/issue-*` | GitHub's branch-delete-on-merge deletes these automatically on merge. Closed-without-merge leaves them dangling — maintainer cleans up periodically. |

#### 9.1.5 Concurrency

Single-instance per session. The cron at §9.2 fires once per day per session. Two parallel agent sessions on the same `agent/diagnosis` would collide; out of scope.

---

### 9.2 Cron registration

The daily fire is registered inside the maintainer's persistent Claude Code session via:

```
CronCreate(
  cron: "0 9 * * *",          # 09:00 LA local; agent picks up at next REPL idle
  prompt: "Daily pencil diagnosis. Read .dev-docs/diagnosis/sop.md and execute end-to-end.",
  recurring: true,
  durable: false               # session-scoped; dies with the maintainer's Claude session
)
```

The cron is **session-scoped** — when the maintainer's Claude Code session ends, the cron stops firing. This is intentional: the maintainer should explicitly re-register the cron when they start a new long-running session, to confirm they want a daily-running agent for that session.

---

### 9.3 Archive rotation (manual)

When `.dev-docs/diagnosis/runs/` accumulates entries older than ~30 days or at end-of-quarter, the maintainer manually rotates them into `.dev-docs/diagnosis/archive/<YYYY-MM>/`:

```bash
git mv .dev-docs/diagnosis/runs/2026-04-* .dev-docs/diagnosis/archive/2026-04/
git commit -m "chore(diagnosis): rotate 2026-04 into archive"
```

The agent does NOT auto-archive. This step is deliberate human review to decide whether old findings still matter.

---

### 9.4 Review Agent handoff

This SOP describes the Diagnosis Agent only. A separate **Review Agent** runs in a different session and is responsible for reviewing the PRs that this agent opens (`agent/diagnosis` rolling + each `auto/issue-*` per fix). The Review Agent's procedure lives at `.dev-docs/diagnosis/review-sop.md`.

What the Diagnosis Agent **must** do to make Review Agent's job possible:

- Commit messages are conventional (`diagnosis(<date>): ...` or `fix(<scope>): ... [fp=<fingerprint>]`).
- Each AUTO-FIX commit's test report on `agent/diagnosis` includes a stable cross-link to the auto-fix branch name + commit hash.
- Daily report (§5) lists each `auto/issue-*` PR by branch name, so the Review Agent can scan them as a unit.

What the Diagnosis Agent **must NOT** do:

- Approve or merge its own PRs.
- Comment on PRs other than the body it writes at PR creation.
- Run the Review Agent's SOP — the two agents are deliberately separate sessions (see `.dev-docs/architecture-review/handoff.md` for the cross-agent boundary principles).

---

### 9.5 Policy version

- `policy_version: 4` — 2026-05-27: switched from per-day diagnosis branches to one persistent `agent/diagnosis` branch with a rolling PR; added §9.4 Review Agent handoff (a separate agent now reviews PRs per `.dev-docs/diagnosis/review-sop.md`).
- `policy_version: 3` — 2026-05-27: artifacts moved out of gitignored `docs/issues/` into tracked `.dev-docs/diagnosis/{runs,archive,_templates}/`; added §9.1 branch+PR workflow and §9.3 archive rotation; per-AUTO-FIX branches carve off `main` (not the daily branch) for independent reviewability.
- `policy_version: 2` — 2026-05-26: rewrote audience as agent-driven, added test-report schema, codified machine constraints (no build / no dev / no pencil spawn), MCP-only credentials path.
