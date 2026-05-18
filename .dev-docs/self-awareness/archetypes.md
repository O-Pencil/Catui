# Pencil-on-Pencil Self-Study — Design Proposal

> Phase 3 of the rework. This document **proposes**; it does not implement. The user picks the direction.

## 1. What we are trying to learn

The daily SOP (Phase 2) treats pencil as a system that produces *diagnostics*. This phase treats pencil as a system that produces *behavior*. Each day, pencil is given a task **about itself**, and we observe four things:

1. **The deliverable** — does the output advance pencil's own progress?
2. **The thinking path** — what reasoning structure shows up in the response (or `thinking` traces, when available)?
3. **The tool usage** — which tools did pencil reach for, in what order, with what success?
4. **The meta-reflection** — does pencil articulate *why* it used those tools, and whether they were the right choice?

Observability is already partly built: SAL eval writes to `eval_runs`, `eval_turns`, `eval_tool_traces`, `eval_memory_recalls`, `eval_sal_anchors`. The audit (`docs/insforge-audit-2026-05-17.md`) flagged real gaps there — many will need to be fixed before this phase yields clean signal. That's OK. Even with the current gaps, archetypes (A) and (D) below are useful.

## 2. Constraints

- I (the SOP runner) cannot spawn pencil sessions directly. The user — or a system cron, or an internal `/loop` task inside pencil — has to run them.
- pencil already has a `grub` extension for autonomous iterative tasks and a `subagent` extension for spawning isolated workers. Either is a candidate host for the self-study task.
- The deliverable should land in the repo (e.g., `docs/pencil-self-study/<date>.md`) so the next-day SOP can read it.
- The trace lands in `eval_*` automatically, as long as SAL eval is enabled.

## 3. Task archetypes (pick 1–2 to start)

### Archetype A — Self-trace post-mortem (RECOMMENDED start)

**Prompt to pencil:**
> Read your own `eval_tool_traces` from the last 7 days. Pick the 3 longest `tool_sequence` arrays. For each, describe (a) what you were doing, (b) which tools were redundant, (c) what tool you wished existed, (d) one concrete recommendation. Write the result to `docs/pencil-self-study/<today>.md`.

**Why this is the right first task:**
- Forces pencil to read its **own data as data**. Most self-reflection prompts are vapid because the model just narrates its priors. Anchoring to specific historical traces breaks that.
- The trace of the trace-reading run becomes a Layer-2 observation: which tools does pencil pick when its task is "inspect your trace"? Read? grep? mcp_insforge? Patterns are revealing.
- Output is auditable: the user can open the rows pencil cited and judge whether the analysis matches reality.
- Existing data is sufficient (382 trace rows); no schema fixes needed first.

**Risks:**
- `intent="unknown"` for 65% of rows means tool sequences are weakly contextualized. pencil may pick the wrong 3 if it doesn't read the underlying `user_prompt` from `eval_turns`. The prompt should explicitly require the join.

### Archetype B — Tool ergonomics A/B

**Prompt to pencil:**
> Take this fixed task: "{some real workspace task}". Solve it twice in two separate runs. Run 1: you may only use Read and Edit. Run 2: any tools. Then write a comparison: which path was faster (duration_ms), which had more tool calls, which felt more natural. Save to `docs/pencil-self-study/<today>.md`.

**Why useful:** Produces a comparable A/B pair in `eval_runs`, lets us measure tool-set cost directly.

**Risks:** Requires running pencil twice; the "fixed task" choice biases everything. Better suited to weekly than daily.

### Archetype C — Tool gap inventory

**Prompt to pencil:**
> Over your next 10 turns of real workspace tasks, every time you wished a different tool existed, write a one-line note. Aggregate at the end into a ranked wish list.

**Why useful:** Captures the friction that doesn't show up in `eval_tool_traces` (which records what was used, not what was wanted).

**Risks:** Self-reporting fidelity is low. Pencil may either over-report (every mild friction) or under-report (rationalize whatever tool it had). Best run alongside one of the data-anchored archetypes.

### Archetype D — Memory recall replay (RECOMMENDED second)

**Prompt to pencil:**
> Pull 10 random `eval_memory_recalls` rows where `was_injected=true`. For each, look up the matching `eval_turns.user_prompt` and the memory entry. Judge whether the recalled memory actually helped that turn (yes/no/unclear) and explain. Save to `docs/pencil-self-study/<today>.md`.

**Why useful:** The single best lever for improving pencil's effectiveness is calibrating its retrieval. 2031/5601 memories were injected; we have no idea how many helped.

**Risks:** Requires JOIN-style reasoning across tables. Pencil needs to be told the schema. Manageable.

### Archetype E — Diagnostic synthesis

**Prompt to pencil:**
> Read the 11 rows in `pencil_issue_events`. Group by code path (grep the repo using fingerprint substrings). For each group, write one paragraph: why does this fingerprint exist, and would you have written the code that way? Save to `docs/pencil-self-study/<today>.md`.

**Why useful:** Directly produces design rationale for the open 5 REVIEW tickets at `docs/issues/2026-05-13/`. Tightest feedback loop with Phase 2.

**Risks:** With only 11 rows the exercise is one-shot; loses value after a couple of repeats unless `pencil_issue_events` grows.

### Archetype F — CLAUDE.md self-audit

**Prompt to pencil:**
> Read `core/CLAUDE.md`. For each module section, open the referenced file. For each P3 contract that doesn't match the file's actual exports, propose a one-line fix. Save to `docs/pencil-self-study/<today>.md`.

**Why useful:** Tests pencil's ability to use its own DIP doctrine. The drift detection is real maintenance work.

**Risks:** Drift is rare on this well-maintained repo; may produce zero edits most days.

## 4. Mechanism options

How the task gets dispatched and how the deliverable + trace flow back.

### Option 1 — File-based (simplest)

- I write `docs/pencil-self-study/<date>/task.md` with the day's prompt.
- User manually runs: `npx tsx cli.ts --print < docs/pencil-self-study/<date>/task.md > docs/pencil-self-study/<date>/output.md`.
- SAL eval writes traces automatically (if enabled).
- Next-day SOP run reads both the output and the new `eval_*` rows.

**Pros:** Zero new code. User can inspect/edit task before running. Easy to skip days.
**Cons:** Requires user attention. No automation.

### Option 2 — `/loop` inside an always-on pencil session

- Pencil's `loop` extension is session-scoped (per `loop/README.md`). A `/loop 24h <prompt>` inside an open session fires daily.
- Requires the user to keep a pencil session running.

**Pros:** No infra. Uses existing pencil features.
**Cons:** Session-bound — same fragility as the current `daily-pencil-review` cron in this Claude session.

### Option 3 — System cron + headless pencil

- Add `scripts/pencil-self-study.sh` that runs `npx tsx cli.ts --print < docs/pencil-self-study/<date>/task.md`.
- Wire to system crontab (`30 17 * * *` UTC, an hour after the issue review).

**Pros:** Truly autonomous. Both Phase 2 and Phase 3 become real cron jobs.
**Cons:** Touches `scripts/`. The script itself is small but **affects nothing in §3.2 core boundary** — it can be AUTO-FIX-eligible per the SOP. Still: needs the user's machine on, and needs SAL eval credentials available to the cron environment.

### Option 4 — Pencil's `grub` extension as host

- `grub` is designed for long-running iterative tasks (`extensions/defaults/grub/`). A daily self-study task could be a `grub` run.
- The grub controller already persists state, has feature-list semantics, and runs autonomously.

**Pros:** Reuses an existing extension explicitly designed for this shape.
**Cons:** I haven't read `grub-controller.ts` enough to know whether it accepts external prompt sources. Worth exploring before committing.

## 5. Proposed first move

Start with **Archetype A** under **Option 1**. Concretely:

1. I draft `docs/pencil-self-study/2026-05-17/task.md` containing the Archetype A prompt, with explicit schema instructions (so pencil knows to join `eval_tool_traces` ↔ `eval_turns`).
2. User runs it once manually. Time-box to ~10 min of pencil wallclock.
3. We read `docs/pencil-self-study/2026-05-17/output.md` together and look at the new `eval_runs` row (its `tool_sequence` is the Layer-2 observation).
4. Based on what the trace reveals, we decide whether to (a) automate via Option 3, (b) add Archetype D next, (c) abandon and try a different archetype.

This is a one-cycle commitment. If the first run reveals that pencil can't usefully reason about its own traces, we redesign — better to learn that now than after building infrastructure.

## 6. Decision needed from the user

| Question | Default if you don't answer |
|----------|-----------------------------|
| Which archetype to start with? | A (self-trace post-mortem) |
| Which mechanism? | Option 1 (file-based, manual one-shot) |
| Where do self-study artifacts live? | `docs/pencil-self-study/<date>/` |
| When to also run Phase 2 audit recommendations (§6 in `insforge-audit-2026-05-17.md`)? | Do not implement until you approve; the schema changes are REVIEW per SOP |

## 7. Anti-goals

- **No "make pencil smarter at general coding."** The self-study is about its self-awareness of tools/memory/diagnostics, not its general capability.
- **No KPI dashboards yet.** Building dashboards before we know which signals are trustworthy is premature; the audit just demonstrated several signals are not trustworthy.
- **No silent automation of Phase 2 fixes based on Phase 3 output.** Phase 3 surfaces hypotheses; humans decide whether they become tickets or fixes.
