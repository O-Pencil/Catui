# Diagnosis PR Review — SOP (Review Agent)

> ⚠ **Audience: Claude Code Review Agent (executor) + pencil maintainer (final merge authority).** This SOP is run by a **separate** Claude Code session from the Diagnosis Agent. Session separation is doctrinal — same reasons documented in `.dev-docs/architecture-review/handoff.md`: mixing diagnosis priors (fingerprint clusters, fix recipes) with review priors (PR shape, merge criteria) in one context produces neither's best work.
>
> The Review Agent's job is to **review and either approve or request-changes** on the Diagnosis Agent's open PRs. It does **not** merge — merge is a maintainer authority. It does **not** edit code in those PRs — corrections come back to the Diagnosis Agent through PR review comments.

---

## 0. Purpose

The Diagnosis Agent (`.dev-docs/diagnosis/sop.md`) commits daily output to:

- One persistent rolling PR: `agent/diagnosis -> main` (markdown only).
- Zero or more AUTO-FIX PRs per day: `auto/issue-<YYYYMMDD>-<slug> -> main` (source-code changes).

A single maintainer cannot keep up with reviewing all of these manually as volume scales. The Review Agent runs alongside, applies a deterministic review checklist to each PR, and produces a structured review verdict that the maintainer can scan in seconds.

The Review Agent **reduces maintainer load**, **never replaces the maintainer's merge gate**.

---

## 1. Pre-flight

### 1.1 Connectivity

The Review Agent reads PRs via the GitHub API. It uses whichever access path is available, in order:

1. `gh` CLI if installed (`command -v gh`).
2. `mcp__github__*` MCP connectors if available in the session.
3. Direct `git ls-remote` + local checkout if neither of the above works (degraded mode: can see branches but cannot comment on PRs).

If none of the three works, write a SKIPPED review report and exit (same pattern as Diagnosis Agent §1).

### 1.2 Machine guardrails

Same hard rules as the Diagnosis Agent (`sop.md` §7):

- **No** `npm run build`, `npm run dev`, `npm install`, no pencil-binary spawn.
- **Yes** to `npx tsc --noEmit` and `npx vitest run <single-file>` — these are how the Review Agent independently verifies AUTO-FIX claims.
- Mem guardrail: skip the run if available RAM < 150 MiB.
- Disk guardrail: skip if available disk < 1 GiB.

### 1.3 State check

```bash
git fetch origin main
git fetch origin agent/diagnosis
git fetch --all
```

List currently open PRs filed by the Diagnosis Agent:

```bash
gh pr list --json number,title,headRefName,baseRefName,createdAt --state open \
  --search 'head:agent/diagnosis OR head:auto/issue-*'
```

(Or the MCP equivalent.) If there are zero open PRs, write a NO-OP review report and exit cleanly. If there are open PRs, proceed.

---

## 2. Review scope per PR type

### 2.1 `agent/diagnosis -> main` (rolling docs PR)

The Review Agent's job for the docs PR is **integrity, not opinion**:

| Check | Pass criterion |
|-------|----------------|
| Each commit message matches `diagnosis(<YYYY-MM-DD>): ...` | regex match |
| Every changed file is under `.dev-docs/diagnosis/runs/` | no surprise files |
| Each new daily report has `status: ok` or `status: skipped` frontmatter | YAML parseable |
| Each ticket file matches the `.dev-docs/diagnosis/_templates/issue.md` skeleton fields | required headers present |
| Each auto-fix-report cross-link resolves to an actual `auto/issue-*` branch | branch exists on origin |
| No source-code changes (no `core/`, `packages/`, `extensions/`, `scripts/`, `cli.ts`, `main.ts`) | empty intersection |
| No `Co-Authored-By` trailers, no Claude footers | repo policy per CLAUDE.md memory |

The Review Agent does **not** opinion-check the ticket contents — that's the maintainer's job at merge time.

### 2.2 `auto/issue-<date>-<slug> -> main` (per-fix PR)

The Review Agent's job for AUTO-FIX PRs is **scope-and-correctness verification**:

| Check | Pass criterion |
|-------|----------------|
| Branch name matches `auto/issue-<YYYYMMDD>-<slug>` | regex match |
| Commit message matches `fix(<scope>): ... [fp=<fingerprint>]` | regex match |
| Changed files are outside the SOP §3.2 HARD CORE BOUNDARY | no files under `core/runtime/**`, `cli.ts`, `main.ts`, `migrations.ts`, `packages/agent-core/**`, `packages/ai/**` |
| Changed files do not violate SOP §3.3 STABILITY CONTRACTS | (case-by-case judgement; if borderline, flag for maintainer instead of approving) |
| Changed lines ≤ 50 (excluding whitespace) | `git diff --stat` |
| ≤ 2 files changed (source + sibling test) | count |
| `npx tsc --noEmit` passes locally on the checked-out branch | re-run by Review Agent |
| Matching `vitest run <single-file>` passes if a test file exists adjacent | re-run by Review Agent |
| Test-report on `agent/diagnosis` exists and cross-links this PR | match |

If any check fails → **request changes** with a structured comment explaining which check failed. If all pass → **approve**. Either way, **do not merge** — the maintainer's review and click is the merge gate.

---

## 3. Verdict and PR interaction

### 3.1 Outcomes per PR

| Outcome | Action | When |
|---------|--------|------|
| **APPROVE** | `gh pr review --approve --body "<one-paragraph rationale>"` | All §2 checks pass |
| **REQUEST_CHANGES** | `gh pr review --request-changes --body "<structured list of failed checks>"` | Any §2 check fails |
| **COMMENT only** | `gh pr review --comment --body "<observations>"` | Borderline (e.g. §3.3 STABILITY CONTRACT borderline call) — flag for maintainer without blocking |

The comment body has a fixed shape (§4 below) so reviews are scannable.

### 3.2 What the Review Agent must NOT do

- **Never merge.** Even if every check passes. Merge requires maintainer click.
- **Never push commits to the PR's branch.** No code edits to fix issues — only request-changes back.
- **Never close PRs.** Closure (without merge) is a maintainer action.
- **Never approve its own past reviews.** Each run starts fresh; do not relitigate prior verdicts unless the PR has new commits since.
- **Never review PRs from other branches** (anything outside `agent/diagnosis` and `auto/issue-*`). Out of scope.

---

## 4. Review comment format

Approved PR:

```markdown
## ✅ Diagnosis review — approved

```yaml
review_agent_run: <ISO timestamp>
policy_version: 1
pr_type: rolling-docs | auto-fix
checks_passed: N/N
```

All §2.{1,2} checks passed.

- (optional) one-line note on what stood out, if anything
```

Request-changes PR:

```markdown
## ❌ Diagnosis review — changes requested

```yaml
review_agent_run: <ISO timestamp>
policy_version: 1
pr_type: rolling-docs | auto-fix
checks_passed: M/N
checks_failed: N-M
```

### Failed checks

| Check | Why it failed | What the Diagnosis Agent should do |
|-------|---------------|-------------------------------------|
| `<check name from §2 table>` | <evidence> | <concrete next step> |

(repeat per failure)

### Re-run guidance

If the Diagnosis Agent re-runs and resolves all failed checks, push new commits to the same branch. The Review Agent will pick them up on the next fire.
```

Borderline PR (COMMENT only, no block, no approval):

```markdown
## ⚠ Diagnosis review — needs maintainer eyes

```yaml
review_agent_run: <ISO timestamp>
policy_version: 1
pr_type: rolling-docs | auto-fix
verdict: defer
```

This PR passed all mechanical checks, but at least one borderline §3.3 STABILITY CONTRACT judgement is too subjective for me to call. Flagging for maintainer review.

- <one-sentence description of the borderline area>
- <link to the specific file/line>
```

---

## 5. Per-run protocol

```
1. Pre-flight (§1) — connectivity, machine guardrails, list open PRs.
2. For each open PR in the list:
   a. Identify PR type (rolling-docs vs auto-fix vs other-skip).
   b. Run the §2 checklist for that type.
   c. Decide verdict per §3.1.
   d. Post the comment per §4.
3. Write a review report at `.dev-docs/diagnosis/reviews/<YYYY-MM-DD>.md`
   (new directory; create on first run). Schema in §6 below.
4. Commit the review report on a separate branch
   `agent/diagnosis-reviews` (persistent, mirroring the Diagnosis Agent's
   single-branch design), and push.
5. Open or update the rolling PR `agent/diagnosis-reviews -> main` so the
   maintainer can scan review history as a unit.
6. Print the §7 closing summary.
```

The review reports are themselves PR-reviewable artifacts — but to avoid the meta-recursion of "who reviews the Review Agent's PRs", the rolling `agent/diagnosis-reviews -> main` PR is reviewed by the **maintainer only**, not by another Review Agent.

---

## 6. Review report schema

`.dev-docs/diagnosis/reviews/<YYYY-MM-DD>.md`:

```markdown
# 2026-05-27 — Diagnosis PR Review

```yaml
review_agent_run_at: <ISO>
policy_version: 1
prs_reviewed: N
approved: A
changes_requested: C
borderline: B
skipped: S   # PRs not matching agent/diagnosis or auto/issue-* patterns
```

## PRs reviewed

| PR | Type | Verdict | Failed checks (if any) |
|----|------|---------|------------------------|
| #123 | rolling-docs | APPROVE | — |
| #124 | auto-fix | REQUEST_CHANGES | tsc fail; commit-message format |
| #125 | auto-fix | APPROVE | — |
| #126 | auto-fix | COMMENT | STABILITY CONTRACT borderline (config.ts env-var rename) |

## Approvals (links)

- #123 — <pr-url>
- #125 — <pr-url>

## Changes requested (links + summary)

- #124 — <pr-url> — tsc failure on `extensions/.../foo.ts:42`; commit message missing `[fp=...]`

## Borderline (links + reason)

- #126 — <pr-url> — change renames `NANOPENCIL_X_ENV`; §3.3 says env-var names are STABILITY CONTRACT; maintainer should confirm whether this rename was intended as a contract change

## Notes

- (anything anomalous: PRs that don't fit either type, machine guardrail trips, etc.)
```

---

## 7. Closing summary

```
Diagnosis PR review — <YYYY-MM-DD>
  PRs reviewed:     N
  approved:         A
  changes requested: C
  borderline:       B
  status:           ok | skipped | partial
                    (reason if not ok)
```

If `status: skipped`, the reason follows the same vocabulary as the Diagnosis Agent SOP §8.

---

## 8. Operating constraints

| Constraint | Why |
|------------|-----|
| **No merge.** Even on full approval. | Merge = maintainer authority. |
| **No code edits.** Even to fix trivial issues. | Edits = Diagnosis Agent's role. The Review Agent's only write surface is PR comments and `agent/diagnosis-reviews` branch. |
| **No re-review without new commits.** Each PR is reviewed once per agent fire; if the PR has no new commits since the last review, skip it. | Avoids comment-spam loops. |
| **No reviews of non-diagnosis PRs.** | Out of scope; possible to expand later, but for now strictly diagnosis territory. |
| **One Review Agent per session.** | Avoids duplicate reviews. |
| **Single-fire-per-day cron.** | Same shape as Diagnosis Agent — minimal load. |

---

## 9. Evolution

### 9.1 Cron registration

```
CronCreate(
  cron: "30 9 * * *",       # 09:30 LA local — 30 min after Diagnosis Agent fires
  prompt: "Daily diagnosis PR review. Read .dev-docs/diagnosis/review-sop.md and execute end-to-end.",
  recurring: true,
  durable: false             # session-scoped
)
```

The 30-minute offset gives the Diagnosis Agent time to finish opening its PRs before the Review Agent looks for them. Tighter is fine if the Diagnosis Agent's runs are short.

### 9.2 Branch and PR for review reports

| Branch | Persistence | Carved from | Contents |
|--------|-------------|-------------|----------|
| `agent/diagnosis-reviews` | persistent — never deleted; rebased on `main` after each maintainer merge | `main` initially | Daily review reports under `.dev-docs/diagnosis/reviews/` |

Same single-branch + rolling-PR model as the Diagnosis Agent. Reviewed by the maintainer only.

### 9.3 Policy version

- `policy_version: 1` — 2026-05-27: initial SOP for the Review Agent. Reviews Diagnosis Agent's rolling docs PR + each AUTO-FIX PR; approves or requests changes; never merges; never edits source code.
