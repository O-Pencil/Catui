# Workflow

Three phases. Do them in order. Do not skip ahead.

```
┌────────────────────────────────────────────────────────────────┐
│ Phase 1: Explore                                                │
│   → walk the codebase per inputs.md §5                          │
│   → log friction in a scratch buffer (your own working notes)   │
│   → no findings yet, no recommendations                         │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│ Phase 2: Report                                                 │
│   → write findings under findings/ (one card per finding)       │
│   → write refactor-plan.md (the prioritized backlog)            │
│   → produce architecture-review-<timestamp>.html report          │
│   → no interaction yet — maintainer reviews offline             │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│ Phase 3: Grilling                                               │
│   → maintainer selects findings to discuss                      │
│   → Arch Agent interactively defends or revises                 │
│   → rejected candidates get ADRs (rationale archive)            │
│   → CONTEXT.md gains any new vocabulary that emerges            │
└────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 — Explore

**Goal**: build a private mental map of the codebase, noting friction. **Do not write findings yet.**

### 1.1 Inputs

Read everything in `inputs.md` §§1–4. Do not yet open code files.

### 1.2 Quantitative scan

Run the read-only commands in `inputs.md` §6. Capture outputs in your working notes (your scratch buffer; do not commit). Build a mental ranking of: largest files, largest directories, deepest dependency chains, suspicious P2 drift.

### 1.3 Walk

Walk the code per `inputs.md` §5. For each module / file:

- **Snapshot fields**: size, P3 header claims, imports, exports.
- **Friction observations**: bouncing between small files; shallow interfaces; extracted functions that hide real bugs; tightly-coupled leaks; untested invariants; god modules.

Keep a **friction log** in your scratch buffer. Each entry is one line:

```
<file:line> — <one-sentence observation> — <which lens caught it: depth/seam/leverage/DIP/multiple>
```

Don't try to solve anything yet. Just observe.

### 1.4 Cluster

After walking, **cluster friction observations**. Many lines in your friction log will be different views of the same architectural fact. Group them. Each group is a *candidate finding*.

### 1.5 Deletion-test pass

For each candidate finding, run the deletion test (methodology.md §1.5) mentally:

- "If I deleted module X, does the complexity concentrate or vanish?"

Promote candidates that fail the test (complexity would vanish — module is scaffolding) or strongly pass it (complexity concentrates dramatically — module is load-bearing but maybe over-loaded). Demote candidates that pass cleanly without surprise (module is appropriately deep).

### 1.6 Phase 1 exit criterion

You exit Phase 1 when you can list **5–15 candidate findings** with one-sentence summaries. Fewer than 5: walk more. More than 15: cluster harder; you're over-fragmenting.

Do not write findings yet. Phase 2 is where they become formal.

---

## Phase 2 — Report

**Goal**: produce three artifacts: per-finding cards, refactor plan, HTML overview.

### 2.1 Create the output directory

```bash
mkdir -p .dev-docs/architecture-review/findings
```

### 2.2 Write one card per finding

For each promoted candidate, write `findings/F<NN>-<short-slug>.md` using the schema in `output-format.md`. Number them in the order they appear in your refactor plan (highest priority = F01).

### 2.3 Write the refactor plan

`.dev-docs/architecture-review/refactor-plan.md` — see schema in `output-format.md`. Order findings by:

1. Severity (load-bearing first, opinionated last).
2. Within severity, by **leverage gain divided by execution cost**.
3. Within ties, by dependency: if F03 must happen before F07, F03 ranks higher.

### 2.4 Render the HTML overview

mattpocock SKILL.md specifies a self-contained HTML file in OS temp directory. For nanoPencil, place it at `$TMPDIR/architecture-review-<YYYYMMDDhhmm>.html` (or `/tmp/...` on Linux, `%TEMP%/...` on Windows). The file:

- self-contained — no external assets, embedded CSS, inline SVG/Mermaid where applicable
- one card per finding (mirroring `findings/F<NN>-*.md`)
- a top-level refactor plan summary section
- ADR conflict callouts (when relevant)

The HTML is the maintainer's primary review surface. The markdown files in `findings/` are the source of truth.

### 2.5 Phase 2 exit criterion

You exit Phase 2 when:

- `findings/` contains one card per finding
- `refactor-plan.md` exists and orders all findings
- The HTML file exists and renders without errors
- The maintainer can read these three things and form an opinion without re-asking you anything

Do not start Phase 3 until the maintainer has reviewed Phase 2 artifacts.

---

## Phase 3 — Grilling

**Goal**: deepen alignment on the selected refactors, document rejections.

This phase is interactive. The Arch Agent's job is to **defend** findings the maintainer pushes back on, and **revise** when the maintainer reveals constraints the Arch Agent missed.

### 3.1 Selection

Maintainer picks N findings to act on (typically 3–6). Reject the rest.

### 3.2 Defense / revision

For each selected finding, the Arch Agent walks through:

- Why this finding (re-state in plain English)
- Deletion test result
- Proposed refactor sketch (deeper than the card; ~30-line outline)
- Dependencies on other findings

If the maintainer reveals a constraint that invalidates the finding, the Arch Agent revises the card or withdraws the recommendation. **Document the revision** — keep both versions visible.

### 3.3 ADRs for rejections

For each rejected finding, write `findings/F<NN>-<slug>-ADR.md` containing:

- The original finding (verbatim)
- The maintainer's rejection reason
- The architectural cost of the rejection (what future work will be slower or harder because this stays unaddressed)

ADRs are archival. Future Arch Agent runs may revisit them.

### 3.4 CONTEXT.md updates

If the grilling surfaced new vocabulary (concepts the maintainer used that should be reusable), append them to a new `.dev-docs/architecture-review/CONTEXT.md` (which the next Arch Agent run will read).

### 3.5 Phase 3 exit criterion

You exit Phase 3 when:

- Every Phase 2 finding has either a selection-for-action or an ADR.
- `refactor-plan.md` has been updated to reflect Phase 3 decisions.
- The maintainer signs off ("the plan reflects my decisions").

After Phase 3, the Arch Agent's job is done. Handoff to the maintainer (and to whomever they assign the refactor implementation work — possibly future Claude Code sessions, possibly themselves).

---

## Termination

The Arch Agent's lifecycle ends with Phase 3 exit. There is no "Phase 4 — implement". Implementation is a separate engagement, possibly involving a third agent or the maintainer themselves. The Arch Agent should **not** carry implementation into the same session — that pollutes both the review reasoning and the implementation reasoning.

After termination:

- The handbook stays in place.
- `findings/` and `refactor-plan.md` stay as historical records.
- Future Arch Agent runs (months later) re-read this handbook before walking the (now-changed) codebase.
