# SL01: Simplification Without Duplicating Evolution

Status: Batch 1 executed on `refactor/simplification-learning-batch1` from base `3d1cce1`;
Batch 2 capability audit in progress. Not merged, not published.
Parent: [proposal](../README.md).

## Evidence

- Built-in metadata and path resolution are maintained separately; the path probe
  found a duplicate next-step entry (33 returned paths, 32 unique).
- Five passive/skill bootstraps total 4,388 characters before skill catalog text.
- Presence has a separate awakening generation path and suspended-Soul hint reads.
- Verification membership differs across package scripts, the dev-loop plan and CI.
- Current Evolution P2 already lists skill materialization, candidate-bound evidence,
  attribution and rollback. Recreating those mechanisms would add competing owners.

These observations are bounded source/probe findings, not full runtime acceptance.

## Decision

Keep product policy in existing extensions, generic resource mechanisms in their
current core owners, and source-repair authority distinct from behavioral artifacts.
Use a capability/test gap matrix before adding evolution code. Prefer removal of
duplicate branches, text and calls over a generalized orchestration abstraction.

## Implementation design record (executor fills before each batch)

| Batch | Base SHA | Actual owner and files | Reused mechanisms | Missing behavior | Compatibility / cost impact | Chosen design |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `3d1cce1` | `builtin-extensions.ts`; `package.json`; `.dev-docs/vibe-coding/verification-plan.json`; `.github/workflows/ci.yml`; `extensions/builtin/{typesafe,discipline,catpaw,humanizer,catail,presence}/index.ts`; new `extensions/builtin/catpaw/CATUI.md`; new `scripts/dev-loop/bootstrap-length-probe.ts`. `scripts/dev-loop/` itself unchanged. | Existing extension loader and `DefaultResourceLoader`; existing i18n fallback lines; existing `test:release` entry point; existing dev-loop plan schema and validation; existing Persona and memory inputs | One ordered list instead of three; a loading decision that `defaultEnabled` actually controls; a documented single-build full run; a plan that matches what CI executes; a measurable bootstrap budget; removal of the dead Soul read | No public API, persisted schema, or dependency change. Default model-call count unchanged: the awakening candidate is env-gated, not shipped. Default prompt context reduced 1,212 chars. `builtInExtensions` array order now equals load order; no consumer read it | Delete duplicated declarations rather than wrap them. `defaultEnabled` becomes the loading predicate. Artifact tests split out of the build stage so a full run compiles once. The plan becomes the membership authority and a test enforces it. Removal over abstraction: the Soul read is deleted, not feature-flagged |
| 2 | `3d1cce1` | `extensions/optional/evolution/` only. No new module, store, or artifact type. | Existing candidate/revision/gate/quarantine/attribution/rollback; `evolution-distillation.ts`; `evolution-refine-tool.ts`; `evolution-auto.ts`; existing benchmark pair validation and report integrity | See the capability matrix in `closure.md`. Only genuine gaps are implemented | Must not weaken any existing gate. No new daemon, timer loop, or storage namespace | Already-covered requirements receive evidence and tests, not code. Where a gap is real, fill it inside the existing owner using existing artifact semantics |
| 3 | `3d1cce1` | `scripts/evolution-benchmark.ts`, `scripts/evolution-pawbench.ts`, existing benchmark modules | Existing PawBench snapshot/import/comparison pipeline and its frozen policy | A real provider-backed executor, if one does not already exist | No provider credentials or approved budget in this environment, so no effectiveness claim is possible | Document the unrun experiment table with reproducible commands. Do not lower statistical gates, do not present mock traces as effectiveness evidence, do not activate candidates |

### Design deviations from the proposal

1. **S01 was partial on first implementation, then corrected.** The first pass replaced 35
   if/else blocks with a `BUILTIN_LOAD_PLAN` list but kept `builtInExtensions` as a separate
   metadata array. That preserved exactly the drift the proposal warns about: two lists, and a
   `defaultEnabled` field that did not control loading. Corrected to a single ordered `REGISTRY`
   from which both derive. Recorded because the intermediate state was real and reviewable, and
   because "partial" is the honest first status rather than a silent rewrite.
2. **Awakening is gated, not removed.** S04 permits retaining shipped behavior when quality
   evidence is unavailable. No provider evidence exists here, so the candidate sits behind
   `CATUI_PRESENCE_AWAKENING=off` rather than becoming the default.
3. **`collectSoulHints` is retained, not deleted.** It is now unreachable from production, since
   the only host implementation returns `undefined`. It is pure, tested, and the prompt builder
   still accepts hints; deleting it would also delete the tests documenting the
   persona-locked-over-soul priority guarantee. The reopen condition is recorded in the code.
4. **New test files rather than new production modules.** All Batch 1 code landed in existing
   owners. The only new non-test artifact is `extensions/builtin/catpaw/CATUI.md`, which is
   documentation moved out of the always-loaded prompt.
5. **`test:presence` was widened** from one file to eight so the new S04 coverage runs in the
   same process as the existing Presence suites rather than as an isolated claim.

## Required invariants

- Built-in order, defaults, fallback precedence and public entrypoints remain compatible.
- Prompt reduction preserves skill invocation boundaries and permission authority.
- User data and cross-project state remain isolated.
- An unverified behavioral candidate cannot become active.
- Candidate mutation invalidates previous evaluation; rollback changes active discovery.
- No missing evidence is converted into a passing receipt or manual bypass.

## Reopen conditions

Public/persisted contract changes, uncertain custom-host Soul compatibility, a need
for another daemon, competing lifecycle ownership, benchmark-policy relaxation, or
default activation changes require a specific finding before implementation.
