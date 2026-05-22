# Pencil Self-Diagnosis Charter

> ⚠ **Audience: pencil maintainers only.** This is internal R&D. Code paths described here are invoked manually from `scripts/`, do not auto-load into user sessions, do not consume user tokens, and do not write to user-side persistent state (user mem-core, user soul-core, user CLAUDE.md, etc.). The insforge backend used here is developer-owned; credentials live in `.memory-experiments/credentials.json` (gitignored) or `NANOPENCIL_*` env vars.
>
> **What this is**: the governance document for how maintainers observe, examine, and improve pencil — via three coordinated activities (audit / diagnosis / reflexive self-study) against shared developer telemetry.
>
> **What this is not**: a redesign of SAL or the cognitive map. SAL is the data substrate this charter consumes; SAL evolution is governed at `.dev-docs/sal/roadmap.md`.
>
> **Status**: v0.2, rewritten 2026-05-17 after the GSA rollout. Earlier versions referenced user-side sinks (mem-core lesson entries, soul-core pattern writes) and cron-based automation; both were removed when the maintainer-only constraint was made explicit.

---

## 1. Two adjacent programs

| Program | Drives | Owns | Reads |
|---------|--------|------|-------|
| **SAL Cognitive Map** | how pencil builds an experience-driven understanding of the workspace it lives in | `extensions/defaults/sal/**`, weights, terrain index, anchor scoring, cognitive map schema; docs at `.dev-docs/sal/` | DIP P1/P2/P3, mem-core, tool traces |
| **Pencil Self-Diagnosis** (this doc) | how maintainers triage pencil defects and explore its self-awareness | `scripts/self-diagnosis/`, this charter, `.dev-docs/diagnosis/`, `.dev-docs/data/`, `.dev-docs/self-awareness/` | the InsForge tables SAL writes into; `pencil_issue_events` |

**Direction of dependency is one-way**: self-diagnosis reads SAL's outputs (`eval_tool_traces`, `eval_memory_recalls`, `eval_runs`, `eval_turns`, `eval_sal_anchors`). It does **not** instruct SAL. If self-diagnosis surfaces a finding that SAL should change behavior, that finding becomes an input to `.dev-docs/sal/roadmap.md`, not a direct edit to SAL extension code.

Prior SAL artifacts (now migrated into `.dev-docs/sal/`):
- `.dev-docs/sal/roadmap.md`
- `.dev-docs/sal/cognitive-map.md`
- `.dev-docs/sal/eval-method.md`
- `.dev-docs/sal/insight-report.md`

---

## 2. Three legs of self-diagnosis

### Leg 1 — Data integrity audit (irregular cadence)

Periodically validate that InsForge tables faithfully represent what they claim to. Output: a dated audit document.

- First pass: `.dev-docs/diagnosis/audit-2026-05-17.md`
- Companion: `.dev-docs/data/field-purpose-matrix.md` — the field-by-field judgment of what's alive, dead, or stale
- Triggers: schema change in any writer; > 30-day silence in an actively-used table; quarterly review

### Leg 2 — Issue triage (on demand)

Watch `pencil_issue_events` for fingerprints. Classify into BLOCK / REVIEW / AUTO-FIX / OBSERVE. File tickets or commit small fixes per the decision tree.

- SOP: `.dev-docs/diagnosis/sop.md`
- Operational reports (gitignored): `docs/issues/<YYYY-MM-DD>.md`
- Tickets (gitignored): `docs/issues/<YYYY-MM-DD>/<fingerprint-slug>.md`

This leg is **not automated**. Earlier drafts assumed a daily cron; that was withdrawn when the maintainer-only constraint was made explicit. Maintainers run the SOP manually when investigating an incident or doing scheduled triage.

### Leg 3 — Reflexive self-study (on demand)

Pencil receives a task **about itself**, reads its own `eval_*` rows as data, produces a deliverable + a trace. The maintainer observes four layers afterwards: deliverable quality, thinking path, tool selection, meta-reflection on tool choice.

- Archetype catalog: `.dev-docs/self-awareness/archetypes.md` (6 archetypes, 4 dispatch options)
- Runtime entry: `scripts/self-diagnosis/run.ts` (skeleton — implementation pending, see §4)
- Per-run artifacts (gitignored): `scripts/self-diagnosis/runs/<date>/{task.md,output.md,analysis.json}`
- First run on record: 2026-05-17, see §7

---

## 3. Where reflexive output goes

A self-study run produces three things:

| Output | Destination | Notes |
|--------|-------------|-------|
| Free-form markdown post-mortem | `scripts/self-diagnosis/runs/<date>/output.md` (gitignored) | Human-readable trail; not parsed by anything downstream |
| Structured analysis | `scripts/self-diagnosis/runs/<date>/analysis.json` (gitignored) | Machine-readable summary of the same content |
| One metric row | `eval_metric_results` table, `variant='self-diagnosis'` | The persistent, queryable record. Time-series across runs becomes the substrate for second-order analysis |

**`eval_metric_results` is the single sink.** Earlier drafts proposed writing to user mem-core or soul-core to "close the loop" — those were removed. Self-diagnosis is observer-only with respect to user state; it does not edit user runtime.

The exit criterion of this whole program is **not** "pencil's behavior shifts." That conflates exploration with productization. The exit criterion is **"the maintainer learns something rigorous about pencil's tool-use, memory-use, or error patterns that informs a future product decision."** Whether to productize self-awareness as a user-facing feature is a downstream decision out of scope here.

---

## 4. Roadmap

| Step | What | Gate |
|------|------|------|
| **S0 — Bootstrap** (done 2026-05-17) | Phase 1 audit complete; field × purpose matrix in `.dev-docs/data/`; maintainer handbook scaffolded at `.dev-docs/`; charter written. | n/a |
| **S1 — First Archetype A run** (partial pass 2026-05-17 — see §7) | Manual file-based run; inspect output for signal quality. | Does pencil produce useful data-anchored self-observations? **Met on content axis.** |
| **S1.5 — scripts/self-diagnosis/ implementation** (in progress) | Fill in the skeleton at `scripts/self-diagnosis/{run,archetypes/A-*,lib/eval-sink}.ts`. Specifically: (a) spawn pencil as a subprocess with stdout/stderr separated; (b) post-process output.md to strip `[Cron-Scheduler]` and similar log contamination; (c) write one `eval_metric_results` row per run with `variant='self-diagnosis'`; (d) handle the 64-turn convergence problem by designing the prompt to finish in <20 turns and using the Write tool for the final artifact instead of streaming. | A re-run produces a clean output.md and one new `eval_metric_results` row. |
| **S2 — Schema & writer alignment** | Land the maintainer decisions captured in `.dev-docs/data/field-purpose-matrix.md`: drop dead columns/tables, type-fix `pencil_issue_events`, migrate writer from `eval_tool_traces` to `eval_tool_calls`, mark 53 abandoned `eval_runs`, add `eval_turns.thinking`. Some of these touch SOP §3.3 telemetry-write-side code — go through REVIEW ticket flow, not AUTO-FIX. | All matrix recommendations either landed or explicitly deferred with a note. |
| **S3 — Cycle additional archetypes** | Bring in Archetype D (memory recall replay) and E (diagnostic synthesis). One every few weeks; each produces its own metric category. | Multiple `metric_category` values in `eval_metric_results` with comparable per-run rows. |
| **S4 — Second-order analysis** | When `eval_metric_results` has enough rows (≥ ~20 across archetypes), maintainer queries the time series: are pencil's self-observations consistent across runs? Do the same wished-tools keep coming up? Are there model-dependent patterns? Output: a synthesis report under `.dev-docs/self-awareness/`. | A report exists that argues for a concrete product decision (or explicitly argues against productization). |

**Anti-goals**:
- **No automation.** Self-diagnosis runs are manual maintainer dispatch. No cron, no scheduled routines, no auto-loaded extensions.
- **No user-side writes.** Reflexive insights stay in the developer-owned data plane. Never reach `~/.pencils/agents/<id>/`.
- **No premature productization.** Even if S4 produces strong signal, the decision to expose any of this to users is a separate process.

---

## 5. Interfaces

### 5.1 What self-diagnosis reads (from SAL's outputs)

- `eval_runs(run_id, started_at, ended_at, task_description, model, status, total_duration_ms, total_tokens_used)` — run envelope
- `eval_turns(run_id, turn_id, user_prompt, duration_ms, tokens_used, thinking, ended_at)` — per-turn shell (`tokens_used` and `thinking` per S2)
- `eval_tool_calls(run_id, turn_id, call_id, tool_name, tool_args, duration_ms, success)` — per-call granular (after S2 migration; pre-S2 reads `eval_tool_traces` aggregated form)
- `eval_memory_recalls(run_id, turn_id, memory_id, memory_kind, score_final, was_injected, inject_rank)` — what mem-core recalled and injected
- `eval_sal_anchors(run_id, turn_id, anchor_type, module_path, file_path, confidence)` — SAL's spatial reasoning
- `pencil_issue_events(...)` — explicit diagnostic events

### 5.2 What self-diagnosis writes

- `eval_metric_results(run_id, metric_name, metric_category, score, score_normalized, details, computation_method, computed_at)` — **the only sink**. `variant='self-diagnosis'` enforced via the `eval_runs` parent row.
- `scripts/self-diagnosis/runs/<date>/*` — local per-run artifacts (gitignored).

### 5.3 What self-diagnosis does NOT touch

- SAL terrain index, anchor scoring, weights
- mem-core extraction or persistence
- soul-core persistence or evolution
- Core agent loop, model providers, CLI entry points
- User-side state under `~/.pencils/agents/<id>/`
- Anything in SOP §3.2 hard core boundary

---

## 6. Open questions / known gaps

These are not blockers for the next run; revisit when scope allows.

1. **Dispatch cadence.** Each archetype probably wants a different rhythm. Archetype A is one-shot per maintenance window. Archetype B (A/B comparison) is one-shot per code change. Don't pre-commit to "daily."
2. **Per-run artifact retention.** `scripts/self-diagnosis/runs/<date>/` is gitignored. Keep forever, or rotate older than 90 days? Decide once we have ≥ ~10 runs.
3. **Cross-archetype synthesis cadence.** S4 says "when enough rows exist." How many is enough? Probably 20 for any single archetype, 50 total across archetypes. Tune by feel.
4. **Runaway containment gap — failsafe watchdog (filed 2026-05-18, deferred).** Today `scripts/self-diagnosis/run.ts` has only two kill paths: the sentinel marker (only flips a flag — doesn't actually kill), and OS signal forwarding (only fires if the maintainer interrupts). There is **no wall-clock timeout, no byte-size cap, no inactivity-based kill, no per-turn detector that reliably triggers**. If pencil hangs without crashing or model output stalls, the script waits forever. The originally-intended post-sentinel turn counter at `run.ts:97` references a stderr marker `route_turn_anchor` that SAL does not actually emit (SAL's `turn_anchor` is an eval event that goes to InsForge, not stderr); the counter is dead code. **Acceptable for now** because each run is maintainer-initiated and they can Ctrl-C. **Pre-conditions for closing this gap**: (a) decide whether to implement wall-clock kill + buffer cap, or whether to require pencil itself to expose a structured `--max-turns` flag and `--quiet-after-sentinel` mode; (b) the second path crosses SOP §3.2 (touches `cli.ts` and the agent loop), so prefer (a) for self-diagnosis scope.
5. **Self-study tautology when test machine lacks InsForge MCP (filed 2026-05-19, deferred).** When `scripts/self-diagnosis/run.ts` is invoked from a host that does **not** have `mcp__insforge__run-raw-sql` available, pencil cannot query `eval_tool_traces` directly. Instead of failing loudly, pencil falls back to reading `.dev-docs/self-awareness/charter.md` §7 (where prior findings are recorded) and **regurgitates them** as if they were the day's new analysis. The 2026-05-19 test run produced an `archetype-A-report.md` whose three "selected turns" were identical to the three rows already in charter §7 — a self-fulfilling loop, structurally clean output but zero new signal. **Implication**: every reflexive run is only meaningful when the host has live access to the developer-owned InsForge backend, either via MCP or via direct SQL credentials passed to the pencil session. **Acceptable for now** because each run is maintainer-initiated and the constraint surfaces explicitly in the output (`constraintNote` in `analysis.json`). **Pre-conditions for closing this gap**: (a) extend the archetype prompt to require pencil to invoke `mcp__insforge__run-raw-sql` by name and fail if it is unavailable; (b) optionally have `scripts/self-diagnosis/run.ts` pre-flight the MCP availability and abort the run with a clear error before spawning pencil at all.

---

## 7. First-run record — S1 (2026-05-17)

Archetype A executed 2026-05-17T21:03Z → 23:59Z, model `kimi-k2.5`, run_id `np-2026-05-17T10-45-52-7essp2`. Outcome: **partial pass** — substantive content valid, harness layered failures.

### Deliverable (content was good)

Pencil read its own `eval_tool_traces` and picked three real historical turns by `tool_sequence` length:

| run_id | Observation | Tool pencil wished existed |
|--------|-------------|----------------------------|
| `np-2026-04-27T14-25-39-5akp67` | 22 consecutive bash for a Gateway 500 debug ("shotgun debugging") | `diagnose-service(endpoint, symptom)` |
| `np-2026-04-29T13-38-36-a2qsdl` | 5-read / 7-write cluster on UI work; **2× ExitPlanMode in a row is a real bug** | `write-multi(files[])` |
| `np-2026-04-29T14-16-22-5nipus` | 32 consecutive bash, 9 errors (22.5% error rate) for an npm uninstall | `uninstall-npx-package(name)` |

Verbatim meta-observation: *"I overuse `bash` as a catch-all tool."* Self-suggested next archetype: token-efficiency analysis.

### Harness failures observed (now folded into S1.5)

1. **stdout contamination.** Pencil's loop extension wrote `[Cron-Scheduler] Stopped` to stdout, intermixing with model output and corrupting `output.md` at line 5. → S1.5 (b): scripts/ post-processes to strip known log prefixes; do not touch the loop extension's logging.
2. **Termination sentinel ignored.** The task prompt asked pencil to end with `SELF-STUDY COMPLETE`. It emitted the sentinel then kept writing for ~100 more lines until the agent loop hit a 64-turn runaway cap. → S1.5 (d): prompt design must converge naturally; use the Write tool for the deliverable, leave stdout for a one-word "DONE".
3. **Mid-output resumption non-idempotent.** After interruption, pencil resumed mid-sentence; the first half of one section was lost. → Same fix as (2): if the deliverable is a tool-written file, resumption can't lose content because the file is the source of truth, not the stream.

### Cron-lock collision (separate, fixed)

The first attempt at this run produced empty output because `.claude/scheduled_tasks.lock` was held by an unrelated Claude Code session that had registered a `daily-pencil-review` cron earlier. That cron was cancelled, the lock file removed, and the rerun proceeded. The collision is not part of S1.5 because the new scripts/ flow doesn't register crons.

### Layer-2 observation — pending

Insforge MCP disconnected during this session before the post-mortem ran. `eval_tool_traces` for `np-2026-05-17T10-45-52-7essp2` cannot be inspected from here. The question *"what tools did pencil pick to look at its own data?"* is the actual Layer-2 reward and remains unanswered until MCP reconnection.

### Why S1 is "partial pass" not "done"

The content gate is met. The engineering gate is not — running the same task today would hit the same three failures plus the lock collision. S1.5 builds `scripts/self-diagnosis/` precisely so the rerun has none of those failure modes.

---

## 8. Provenance

- 2026-05-13: SOP for issue triage (Leg 2) drafted; `daily-pencil-review` cron registered. *(cron later cancelled in S1.5)*
- 2026-05-17 (morning): Phase 1 data audit (Leg 1) completed at `.dev-docs/diagnosis/audit-2026-05-17.md`; Archetype A first run prepared.
- 2026-05-17 (evening): S1 first run executed — outcome above; harness failures and lock collision diagnosed.
- 2026-05-17 (late): GSA rollout — maintainer-only constraint made explicit; charter rewritten (this file = v0.2); `.dev-docs/` skeleton created; SAL & diagnosis docs migrated out of gitignored `docs/`; `scripts/self-diagnosis/` skeleton placed; mem-core / soul-core sinks struck from the design.
- **Prior context**: the SAL cognitive-map roadmap (Claude memory `project_sal_evolution_plan.md`, 2026-04-22) established that pencil should accumulate experience by living in the workspace, not just indexing it. Self-diagnosis is the *defect-side* counterpart to that *capability-side* vision: SAL learns by walking, self-diagnosis learns by looking back at the walk.
