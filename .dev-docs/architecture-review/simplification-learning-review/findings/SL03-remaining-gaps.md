# SL03: Remaining Batch 2 Gaps, With The Product Decisions They Need

Status: open. Two items are implemented (SL02 rollback discovery, and the S08.1 baseline-revision
binding described in the closure). The rest are recorded here with a concrete design and the
product decision each one needs before code.
Parent: [proposal](../README.md). Sibling: [SL01](SL01-scope-and-evidence.md),
[SL02](SL02-rollback-discovery.md).

Audit basis: the live entry is `extensions/optional/evolution/index.ts:249`. Its import closure
excludes `consumers.ts`, `evaluation.ts`, `store.ts`, `workflow.ts`, `automation.ts` and `paths.ts`
— those are test-only. Several existing tests assert against that dead cluster, which is why the
proposal's evidence base overstates real coverage.

## Implemented in this batch

| Item | Change | Test |
| --- | --- | --- |
| S05.4 | `planEvolutionCandidate` now calls the existing `redactEvolutionEvidence` before the model call. Up to 24,000 raw session characters, which can carry provider keys, bearer tokens and private paths, previously left the process unredacted. | `test/evolution-refiner-redaction.test.ts` — fails on pre-fix code, verified via `git stash` |
| S08.5 / S08.7 | `discoverLocalSkillPaths` excludes revisions withdrawn by a rollback and deletes their materialized directories. See [SL02](SL02-rollback-discovery.md). | `test/evolution-rollback-discovery.test.ts` — 4 of 5 fail without the fix |
| S08.1 | `EvolutionCandidateInput.baselineRevisionId` plus a promotion check that rejects a stale base. Optional field, so records written before it stay valid. | `test/evolution-baseline-binding.test.ts` — 5 tests |

## Not implemented, with the decision each needs

### SL03-A: S06.2 — verified outcome vs model self-report vs unknown

`LESSON_PATTERN` (`evolution-auto.ts:22`) matches the assistant's own prose, so a model can
narrate a lesson and have it become a candidate. The source-evolution side already discriminates
correctly (`source/assessment/measurement.ts:14` requires a real result observation and rejects
tool-inflated samples).

Design: require a `catui_evolution` structured marker carrying an explicit outcome, and treat
prose matches as unverified — they may seed a candidate but must not count as evidence.

Decision needed: should an unrecognized prose lesson still create a candidate, or be dropped?
Recommended: keep it, but record `evidenceVerified: false` so the existing inactive-candidate
path handles it and promotion still demands real evidence. Dropping it outright loses legitimate
recording.

### SL03-B: S06.3 — retrieve existing skills in scope before proposing

Nothing in the refiner, refine tool or observer consults what already exists, so the model
proposes near-duplicates and the operator has to notice.

Design: call the existing `inspectEvolution(scopeRoot)` before building the proposal prompt and
include the active skill ids and titles as "already exists, prefer an update" context.

Decision needed: none of substance. It is a small, local read using an existing function. Deferred
only because it is prompt-shaping, and S03's own finding is that prompt changes need the S09
measurements to be justified. Implementing it now would be an unmeasured prompt change.

### SL03-C: S07.2 / S07.3 — prefer updates, and cap edits

No `overrides` field on the live `EvolutionArtifact`, so a refinement cannot say "update this
skill" — it always creates a new one. And `formatEvolutionChanges` (`evolution-format.ts:116`)
renders added/changed/removed without counting them, so there is no edit budget at all.

Design, both in the existing owner: add optional `overrides: { skillId: string }` to
`EvolutionArtifact`, and enforce a maximum of four logical changes per candidate in
`validateEvolutionCandidateInput`, rejecting rather than truncating.

Decision needed: the proposal suggests "at most four logical add/delete/replace changes per
refinement, subject to a documented mapping onto existing artifact semantics." Options:

| Option | Behavior | Cost |
| --- | --- | --- |
| A. Count changed artifacts | Bound = artifacts per candidate (already capped by `MAX_ARTIFACTS_PER_CANDIDATE`) | No new semantics; but a single large artifact can still rewrite everything |
| B. Count structural sections within an artifact | Bound = named sections changed | Closer to the proposal's intent; needs a defined section grammar for `skill_manifest` |
| C. Bound both | Artifact cap plus per-artifact section cap | Most faithful; most work |

Recommended: **C**, but C's section grammar is a product-visible contract for skill authoring and
should not be invented unilaterally. This is the main reason it is not implemented in this pass.

### SL03-D: S07.5 — feed rejected proposals back to the refiner

`rejectEvolutionCandidate` (`evolution-store.ts:974`) persists the reason, but
`planEvolutionCandidate` never reads prior candidates, so rejection feedback is write-only.

Design: pass a bounded list of recent rejections (reason plus source version) into the proposal
prompt, clearly marked as untrusted historical evidence.

Decision needed: none of substance — reuse the existing store, no new state. Deferred because it
changes the proposal prompt, same reason as SL03-B.

### SL03-E: S10.2 / S10.3 / S10.4 — budget reservation and evidence cursor

The behavioral observer has no budget reservation and no evidence cursor, so repeated turns can
spend model calls on unchanged evidence. A budget mechanism exists only on the source-evolution
side, and `COOLDOWN_TURNS` is applied only on the `LESSON_PATTERN` branch.

Design, all in `evolution-auto.ts` and the existing evolution scope root: reserve a call before
`completeSimple`, record an evidence fingerprint with the last attempt, and skip when unchanged.

This does need new local state, which the user explicitly asked not to treat as a reason to skip.
It is listed here because it is the one remaining item whose correct design depends on a decision
that has not been made: **what should the behavioral budget be, and should it be shared with the
source-evolution budget or separate?** Options:

| Option | Behavior | Cost |
| --- | --- | --- |
| A. Separate per-scope daily counter | Behavioral and source budgets independent | A day of heavy behavioral learning cannot starve source repair, or vice versa |
| B. Shared counter | One ceiling for the whole extension | Simpler, but source repair loses its reserved share |
| C. Separate counters, behavioral only when explicitly enabled | Nothing new runs unless the user opts in | Safest default; matches the proposal's "do not silently turn currently disabled idle behavior on" |

Recommended: **C**, defaulting off, with **A** once enabled. Rationale: the proposal forbids
turning currently-disabled behavior on for existing users, and option A alone would do exactly
that. The open question is whether the opt-in belongs in settings or behind an env switch like the
S04 awakening candidate; settings is more discoverable, env is more reversible.

### SL03-F: dead cluster removal

`consumers.ts`, `evaluation.ts`, `store.ts`, `workflow.ts`, `automation.ts`, `paths.ts` plus parts
of the older `types.ts` / `prompts.ts` are unreachable from `index.ts`, but are covered by
passing tests. This is why S06/S07 look covered and are not.

Deleting them is the honest fix, but it removes modules that may be referenced by external
extension consumers, and it would delete the tests that currently appear to cover S06/S07. That is
a compatibility decision, not a cleanup, and it needs its own finding before code. Recorded as a
reopen condition in SL01.
