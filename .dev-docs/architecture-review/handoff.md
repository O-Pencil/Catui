# Handoff — boundaries with other agents

The Arch Agent does not work in isolation. Three adjacent agents share the nanoPencil data and code surface but operate independently — the Diagnosis Agent and its dedicated Review Agent (the two-agent diagnosis pair documented at `.dev-docs/diagnosis/sop.md` and `.dev-docs/diagnosis/review-sop.md`), plus a hypothetical SAL Agent. This file defines who owns what and how findings cross boundaries (when they cross at all).

---

## 1. The four agents

| Agent | Session | Files it owns | Files it reads | Files it must not touch |
|-------|---------|---------------|----------------|--------------------------|
| **Diagnosis Agent** | Maintainer's persistent Claude Code session (daily cron 09:00 LA) | `.dev-docs/diagnosis/runs/**`, daily commits on `agent/diagnosis` branch, per-fix commits on `auto/issue-*` branches, the SOP at `.dev-docs/diagnosis/sop.md` | InsForge tables via MCP, the whole repo for grep-based localization | `.dev-docs/architecture-review/**` (this directory); `.dev-docs/diagnosis/reviews/**` (Review Agent owns those) |
| **Review Agent** | A separate Claude Code session (daily cron 09:30 LA) | `.dev-docs/diagnosis/reviews/**`, daily commits on `agent/diagnosis-reviews` branch, PR review comments on `agent/diagnosis` and `auto/issue-*` PRs, the SOP at `.dev-docs/diagnosis/review-sop.md` | The Diagnosis Agent's PR diffs, the SOP it must validate against, `npx tsc --noEmit` + adjacent `vitest run` to verify AUTO-FIX claims | `.dev-docs/diagnosis/runs/**` (only via PR review, never direct edit); source code (read for verification only, never edit); `.dev-docs/architecture-review/**` |
| **Arch Agent (you)** | A separate Claude Code session | `.dev-docs/architecture-review/findings/**`, `.dev-docs/architecture-review/refactor-plan.md`, the HTML report in `$TMPDIR` | The whole repo for static analysis, the handbook in `.dev-docs/architecture-review/` | `.dev-docs/diagnosis/**` in any subdirectory (structure-only confirmation OK; never read individual reports/tickets/reviews); `auto/issue-*` branches; `agent/diagnosis*` branches |
| **SAL Agent** (hypothetical, future) | A separate session if/when SAL Phase-1+ work resumes | `extensions/defaults/sal/**` evolution; `.dev-docs/sal/**` | the whole repo for impact analysis | diagnosis runs / reviews, architecture-review findings |

The session separation is doctrinal, not technical. There is no enforcement mechanism — only this handbook and the maintainer's discipline.

The Diagnosis Agent and Review Agent are tightly coordinated (output of one is input of the other) but **deliberately do not share a session**. The Diagnosis Agent commits work; the Review Agent verifies that work. If both ran in one session, the verifier would inherit the implementer's blind spots — the whole point of a second agent is independent eyes.

---

## 2. What "owns" means

For each row above, "owns" means:

- The agent **may write** to files in this scope without asking.
- The agent **must update** them if work in scope changes them.
- Other agents **must not write** to them — they may read for context, but never edit.

"Reads" means: open and synthesize for the agent's own work. "Must not touch" means: do not open at all unless following an explicit link from a file you own, and never write.

---

## 3. Why session separation matters

Both the self-diagnosis flow and the architectural review carry strong **priors**:

- Self-diagnosis primes you to look at fingerprints, error messages, fix patterns.
- Architectural review primes you to look at depth, seams, leverage.

If the same Claude Code session does both, the priors mix. Concrete failure mode observed in earlier dual-purpose sessions: the agent saw a fingerprint cluster about excessive `bash` calls (a behavioral diagnosis observation) and proposed an architectural refactor of `core/tools/bash.ts` (which is in SOP §3.2 hard-core and not the right level of abstraction for the observation). The Arch Agent doesn't have the behavioral context to know that. The self-diagnosis agent doesn't have the architectural framework to know that. **Mixing both in one context produces neither's best work.**

So: separate sessions. Separate Claude Code conversations. Manual handoff of artifacts (this handbook + future findings) via files in the shared repo.

---

## 4. Cross-agent communication

The four agents communicate only through files in the repo. No shared memory. No shared session. The maintainer is the broker.

### 4.1 Self-diagnosis → Arch Agent

Self-diagnosis may surface an issue cluster that, on inspection, looks architectural (e.g., 12 fingerprints all rooted in a tool layer module that's clearly shallow). The self-diagnosis agent's job in that case:

- File the ticket normally per SOP §4.1.
- In the ticket's "Suggested options" section, include a line: `Possible architectural finding — see .dev-docs/architecture-review/ when next Arch Agent runs.`
- That's it. The self-diagnosis agent does not invoke the Arch Agent, does not write into the architecture-review directory.

### 4.2 Arch Agent → Self-diagnosis

Arch Agent may notice while walking that a particular code area has many `pencil_issue_events` referring to it (the Arch Agent may run a `mcp__insforge__run-raw-sql` query if needed). If the Arch Agent has a finding that explains a class of issues that self-diagnosis is repeatedly catching:

- Write the finding normally in `findings/F<NN>-*.md`.
- In the finding's "Adjacent observations" section, list the fingerprints / issue tickets that may be subsumed by acting on this finding.
- Do **not** write into `.dev-docs/diagnosis/runs/`. Do **not** modify or close tickets. The self-diagnosis agent owns that.

### 4.3 Arch Agent → SAL Agent

Same pattern. If a finding touches the SAL boundary, mention in the finding card's "References" section and tag the relevant SAL roadmap section. Do not edit `extensions/defaults/sal/**` or `.dev-docs/sal/**`.

### 4.4 The maintainer

The maintainer is the only entity that:

- Decides which agent runs when
- Acts on the actual code changes (Phase 3 selections, AUTO-FIX merges, SAL roadmap moves)
- Updates the handbooks when methodology evolves

The maintainer reads outputs from all four agents and reconciles.

---

## 5. Boundary specifics for the Arch Agent

### 5.1 You MAY

- Read all source code (`core/`, `packages/`, `extensions/`, `modes/`, `scripts/`, root `.ts`).
- Read all root-level docs (`CLAUDE.md`, `AGENTS.md`, `.PENCIL.md`, `README.md`).
- Read all P2 module maps.
- Read all P3 file headers.
- Read this handbook in `.dev-docs/architecture-review/`.
- Briefly **skim** other `.dev-docs/` directories to confirm they exist and serve parallel programs (you've been told to in `inputs.md` §4).
- Run any command in `machine-constraints.md` §3.
- Write to `.dev-docs/architecture-review/findings/`, `.dev-docs/architecture-review/refactor-plan.md`, and the HTML output target.

### 5.2 You MUST NOT

- Spawn pencil (`machine-constraints.md` §2).
- Run `npm run build` / `npm install` / etc. (`machine-constraints.md` §2).
- Edit anything in `.dev-docs/diagnosis/runs/`.
- Edit anything in `scripts/self-diagnosis/`.
- Edit anything in `extensions/defaults/sal/`.
- Edit the self-diagnosis SOP at `.dev-docs/diagnosis/sop.md`.
- Edit the SAL roadmap at `.dev-docs/sal/roadmap.md`.
- Open individual issue tickets at `.dev-docs/diagnosis/runs/<date>/<slug>.md` for analysis — knowing they exist is the limit.
- Recommend changes to user-side state format (`~/.pencils/agents/<id>/`); see `project-context.md` §6.
- Approach this work as if you were the implementation agent. **You produce recommendations. Implementation is a separate engagement.**

### 5.3 Gray zones

When in doubt:

- If a finding requires reading a self-diagnosis ticket to understand it — **don't read it**. Reframe the finding to stand on its own architectural merits, or note in "Adjacent observations" that the finding relates to self-diagnosis tickets without naming them.
- If a finding requires running `npm run build` to verify — **don't run it**. Note "verification by maintainer required" in the finding card.
- If the Arch Agent's notes start tracking who-said-what across sessions — **stop**. That's a sign the session is muddying. Reset to handbook + code.

---

## 6. After Phase 3

The maintainer signs off on `refactor-plan.md`. The Arch Agent's session ends. The deliverables stay:

- `.dev-docs/architecture-review/findings/` — historical findings + ADRs
- `.dev-docs/architecture-review/refactor-plan.md` — last decision snapshot
- The HTML report (in `$TMPDIR` — ephemeral; the markdown is the source of truth)

The next Arch Agent run (months later) starts with this handbook + the prior findings as historical context. The codebase will have changed by then; new findings will reflect the new shape. ADRs from prior runs may be re-opened if conditions change.

The self-diagnosis cron continues running in its own session. The Arch Agent's lifecycle does not affect it.

---

## 7. Failure of the boundary

If you (Arch Agent) realize you've crossed a boundary — written something into `.dev-docs/diagnosis/runs/`, edited a self-diagnosis file, or read a self-diagnosis ticket in depth — **note it in your current finding's "Adjacent observations"** with the crossing flagged explicitly. Don't try to revert quietly. The maintainer needs to know.

Boundaries are doctrinal. They will sometimes be wrong. The way to revise them is through the maintainer, not unilaterally.
