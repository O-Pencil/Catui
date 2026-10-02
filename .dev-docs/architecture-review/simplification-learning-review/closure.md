# Execution and Acceptance Record

Status: in progress, Batch 0 and Batch 1 partially executed. This file is a handoff record, not
a passing acceptance report.
Parent: [proposal](README.md).
Working branch: `refactor/simplification-learning-batch1`, branched from `main` at the base SHA
before any product edit. Not merged, not published, no service enabled.

## Execution baseline

- Base/head commit and branch: base `3d1cce1faab3a57a102b6aabed692e4736062522` (main, merge of PR #21).
- Working-tree changes at start: `M .dev-docs/architecture-review/README.md`,
  `?? .dev-docs/architecture-review/simplification-learning-review/`. No product code
  was dirty at the execution base; both entries are review-document changes.
- Node/npm/OS and dependency installation: Node v24.21.0, npm 11.19.0, macOS 26.6.2.
  `node_modules` was absent at start; `npm install` completed exit 0 (63 funding
  notices, `npm audit` reports 20 pre-existing vulnerabilities: 1 low, 5 moderate,
  12 high, 2 critical — not introduced by this iteration and not addressed here).
  `dist/` was absent at start.
- PR URL and final CI revision: pending.
- Capability/test gap matrix: pending; required before Batch 2 implementation.

### Baseline measurements (reproduced at base SHA)

Measured with `node --import tsx scripts/dev-loop/bootstrap-length-probe.ts`
(probe added by this iteration, no side effects).

| Measurement | Observed |
| --- | --- |
| `builtInExtensions` descriptors | 35 |
| Descriptors with `defaultEnabled: true` | 32 |
| `getBuiltinExtensionPaths()` length | 33 |
| Unique resolved paths | 32 |
| Duplicate path | `extensions/builtin/next-step/index.ts` (index 6 and 8) |
| typesafe bootstrap | 1,112 chars |
| discipline bootstrap | 1,205 chars |
| catpaw bootstrap | 872 chars |
| humanizer bootstrap | 362 chars |
| catail bootstrap | 837 chars |
| Assembled five-bootstrap total | 4,388 chars |

Character counts, not tokens. The proposal's observations 1 and 3 reproduce
exactly at the execution base; observation 4's Soul claim also reproduces
(`core/runtime/extension-core-bindings.ts:351` returns `undefined` from
`getSoulManager`, while `extensions/builtin/presence/index.ts` still calls
`collectSoulHints(ctx.getSoulManager())` at lines 663 and 846).

Load order observed at base (index: path), used as the S01 equivalence baseline:
typesafe, diagnostics, sal, mem-core extension, link-world, security-audit,
next-step, presence, **next-step (duplicate)**, ask-user-question, teach, grub,
context-management, goal, loop, plan, discipline, subagent, team, idle-think,
btw, recap, debug, mcp, task, lsp, insights, notebook, skill-tool, catpaw,
humanizer, catail, evolution.

### Baseline test state

`npm test` at base: **exit 0**, zero `not ok` lines across
`test:runtime-owners`, `test:dev-loop`, `test:security`, `test:commands`,
`test:tools`, `test:mcp`, `test:sessions`, `test:release`, `test:harness-critical`
(including `eval:harness`). No pre-existing failures to distinguish from
regressions. That run performs one full `npm run build` inside `test:release`.

### Baseline command sets

| Surface | Build | Gates | Tests |
| --- | --- | --- | --- |
| `npm test` | yes, once, inside `test:release` | none | runtime-owners, dev-loop, security, commands, tools, mcp, sessions, release, harness-critical |
| `npm run verify:all` | `build:deps` only, no full build | dip, quality, package-boundary (static), `tsc --noEmit` | none |
| `verification-plan.json` | yes, once, as `build` | dip, quality, package-boundary (static) | dev-loop, security, commands, tools |
| `ci.yml` test job | yes, once | `tsc --noEmit`, dip, `verify:package-boundary:dist` | dev-loop, security, commands, tools, context continuity, harness-critical |
| `quality.yml` | none | quality, static package boundary | none |

Three confirmed drifts at base: `verify:all` skips the full build and every test
suite; the plan omits the runtime-owners, mcp, sessions, release and harness-critical
suites; the plan has no post-build `verify:package-boundary:dist` step, so a
plan-driven run never reproduces the CI dist boundary check.

## Item outcomes

| ID | Status | Code/test references | Before/after evidence | Limit or blocker |
| --- | --- | --- | --- | --- |
| S01 | Implemented (structural) | `builtin-extensions.ts` (468 → 225 lines), `test/builtin-extension-registry.test.ts` (13 tests) | See S01 detail below | Behavioral effectiveness unmeasured (S09); metadata array order now equals load order, which differed from base metadata order — no consumer read that order |
| S02 | Not started | — | — | — |
| S03 | Implemented (structural) | `extensions/builtin/{typesafe,discipline,catpaw,humanizer,catail}/index.ts`, `extensions/builtin/catpaw/CATUI.md`, `test/bootstrap-routing.test.ts` (8 tests) | 4,388 → 3,176 chars, −27.6% | Routing effectiveness unmeasured (S09) |
| S04 | Partial | `extensions/builtin/presence/index.ts`, `test/presence-soul-cleanup.test.ts` (7 tests) | Soul reads removed from both live paths; awakening candidate gated by env | Interactive smoke not run; quality evidence unavailable, so shipped default deliberately unchanged |
| S05 | Partial (S05.4 closed) | `evolution-refiner.ts`, `test/evolution-refiner-redaction.test.ts` | Raw session evidence is now redacted before the model call; verified to fail on pre-fix code | S05.2 destination routing to memory / working notes unimplemented | Would need a second classifier; refused on scope grounds |
| S06 | Missing (see SL03-A/B) | — | `evolution-distillation.ts`, `evolution-refine-tool.ts`, `evolution-auto.ts` exist | See SL03-A, SL03-B | Retrieval and rejection feedback are prompt changes; shipping them unmeasured repeats the mistake S03 was reviewed for |
| S07 | Missing (blocked on decision, see SL03-C/D) | — | Size limits and rejection records exist | Edit budget, rejection feedback, update-over-duplicate | SL03-C needs a skill section grammar, which is a product-visible contract |
| S08 | Partial (S08.1 partial, S08.5/S08.7 implemented) | `evolution-store.ts`, `evolution-types.ts`, `test/evolution-rollback-discovery.test.ts` (5), `test/evolution-baseline-binding.test.ts` (5) | Rollback now withdraws the revision from both discovery scans and deletes its materialized directory; a candidate declaring a stale baseline cannot promote | None remaining in the audited scope |
| S09 | Blocked (no budget) | — | PawBench snapshot/import/comparison pipeline exists | A provider-backed executor run | No provider credentials or approved experiment budget in this environment |
| S10 | Missing (see SL03-E) | — | Source-side observer and budgets exist | Behavioral-path budget reservation, evidence cursor | Needs a budget/opt-in decision; defaulting on would violate the proposal constraint |

### Batch 2 capability matrix

Audit basis: the live entry is `extensions/optional/evolution/index.ts:249`
(`evolutionExtension`). Its import closure is `evolution-store`, `evolution-format`,
`evolution-refiner`, `evolution-refine-tool`, `evolution-gate`, `evolution-tool`,
`evolution-executable-tool`, `evolution-auto`, `evolution-types`, `source/runtime/bridge`.
Everything else in that directory is test-only — see the dead-code note below. The audit was
source-reading plus import-graph tracing, not a green run; the one change it motivated is verified
separately by a test that fails without the fix.

| Req | Symbol and location | Test | Status |
| --- | --- | --- | --- |
| S05.1 no universal record / second store | `EvolutionArtifactKind` `evolution-types.ts:11`; `ARTIFACT_KINDS` `evolution-store.ts:42` | `evolution-store.test.ts` validation cases | already-covered |
| S05.2 route to memory / working notes / skill_manifest / source repair / inactive record | only `memory` + `skill_manifest` kinds exist; no route to the memory integration or working notes | none | missing |
| S05.3 narrowest justified scope | `canAutoPromoteGlobalEvolution` `evolution-store.ts:476`; `scopeOf` `evolution-auto.ts:49` | `evolution-store.test.ts`, `evolution-extension.test.ts` scope cases | already-covered |
| S05.4 history is data, not authority | `redactEvolutionEvidence` existed at `prompts.ts:50` but was unreachable; `sessionExcerpt` `evolution-refiner.ts:77` sent 24,000 raw chars unredacted | **closed this batch** — `test/evolution-refiner-redaction.test.ts` | **implemented** |
| S05.5 acceptance examples for all destinations | none | none | missing |
| S06.1 bounded trace selection | `workspaceTracePaths` `evolution-fixture.ts:32` caps at 50, but selects by mtime recency only | `evolution-extension.test.ts` trace-sweep cases | partial |
| S06.2 verified outcome vs self-report vs unknown | absent on the behavioral path; `LESSON_PATTERN` `evolution-auto.ts:22` regexes the assistant's own prose. Source side does discriminate (`source/assessment/measurement.ts:14`) | `source-evolution.test.ts` (source side only) | missing (behavioral) |
| S06.3 retrieve existing skills in scope | no call from refiner, refine tool or observer into `inspectEvolution` / `loadActiveEvolutionArtifacts` | none | missing |
| S06.4 small update or new inactive skill | `planEvolutionCandidate` `evolution-refiner.ts:127`; inactive path `evolution-refine-tool.ts:265` | `evolution-extension.test.ts` inactive-plan case | partial (prompt only) |
| S06.5 provenance + predicted benefit in metadata | `EvolutionPrediction` `evolution-types.ts:35`; `skillMarkdown` `evolution-store.ts:149` | `evolution-store.test.ts` prediction case | already-covered (shape) |
| S06.6 skill body states trigger/prereqs/steps/pitfalls/verification/limits | `validateArtifact` `evolution-store.ts:412` checks kind, id, title, length, budget, executable content only | none | missing |
| S06.7 no whole traces or credentials in skills | `MAX_CONTENT_CHARS` `evolution-store.ts:36`; `EXECUTABLE_PATTERNS` `evolution-store.ts:57` | `evolution-store.test.ts` rejection cases | partial |
| S06.8 acceptance set | no test for "no lesson → no candidate"; no test for malformed `catui_evolution` JSON | none | missing |
| S07.1 reuse size limits and dedup | limits `evolution-store.ts:34`; dedup `assertNoDuplicateEvalFixture` `evolution-store.ts:542` is fixture-content-hash only | `evolution-store.test.ts` dedup case | partial |
| S07.2 prefer update over near-duplicate | live `EvolutionArtifact` `evolution-types.ts:23` has no `overrides`; the merge mechanism exists only in dead `workflow.ts:104` | `evolution-workflow.test.ts` tests dead code | missing |
| S07.3 at most four logical edits, enforced | `formatEvolutionChanges` `evolution-format.ts:116` renders changes but nothing counts or bounds them | none | missing |
| S07.4 reject over-budget, do not truncate | `assertValidInput` `evolution-store.ts:501` throws before persistence | `evolution-store.test.ts` rejection cases | already-covered |
| S07.5 feed rejected changes back to the refiner | write-only: `rejectEvolutionCandidate` `evolution-store.ts:974` persists, but `planEvolutionCandidate` never reads prior candidates into the prompt | none | missing |
| S07.6 no permanent blacklist | no blacklist exists; equally no re-evaluation trigger. Repeated identical structured proposals create a new candidate each turn because `COOLDOWN_TURNS` is applied only at `evolution-auto.ts:201` | cooldown test covers only the `LESSON_PATTERN` branch | missing |
| S07.7 acceptance outcomes | none of the six cases has a live outcome | none | missing |
| S08.1 bind ID, hash, corpus, envelope | `verifyEvolutionBenchmarkReport` `benchmark-comparison.ts:201`; `validateBenchmarkPair` `benchmark-evidence.ts:186` | `evolution-benchmark-promotion.test.ts` | already-covered except baseline revision |
| S08.1 baseline revision bound | `EvolutionCandidateInput` `evolution-types.ts:79` has no `baselineRevisionId`; the field exists only in dead `prompts.ts:98` | none | missing |
| S08.2 validation separate from mutation inputs | held-out split enforced in `validateBenchmarkPair`; `verifyEvolutionBenchmarkReport` compares `candidateContentHash`, so mutation invalidates the report | `evolution-benchmark-promotion.test.ts` | already-covered |
| S08.3 no manual override to bypass evidence | no override path found on the live path | `evolution-extension.test.ts` evidence-required case | already-covered |
| S08.4 safety/cost/latency/slice/replay checks | `benchmark-comparison.ts:131-136` | `evolution-benchmark-promotion.test.ts` | already-covered |
| S08.5 materialization and rollback change discovery | `rollbackEvolution` `evolution-store.ts:1003` rewrites the current pointer, but `evolution-store.ts:1098-1123` deliberately retains prior skills "so users benefit from all their accumulated skills" | `evolution-store.test.ts` rollback cases | **partial — design conflict, see below** |
| S08.6 restart/persistence | store is file-backed and reloaded in existing tests | `evolution-store.test.ts` | already-covered |
| S08.7 end-to-end discovery after rollback | no test calls `loadActiveEvolutionSkillPaths` after a rollback | none | missing |
| S10.1 isolated/sequential/interleaved streams | `BUILTIN_HARNESS_EVAL_MANIFEST` `core/harness-eval/scenarios.ts:31` has no streams; only reachable via a hand-written manifest | `evolution-extension.test.ts:1054` | partial |
| S10.2 reuse existing observer and budget | the observer exists (`evolution-auto.ts`); a budget mechanism exists only on the source side | `evolution-automation.test.ts:71` imports `automation.ts`, which nothing live loads | missing for the behavioral path |
| S10.3 require new evidence since last attempt | no evidence cursor in the behavioral scope | none | missing |
| S10.4 reserve budget before calling a model | no reservation on the live path | none | missing |

**Dead cluster, and why it matters for review.** `consumers.ts`, `evaluation.ts`, `store.ts`,
`workflow.ts`, `automation.ts`, `paths.ts` and the older `types.ts`/`prompts.ts` helpers have no
importer from `index.ts`. Tests such as `evolution-workflow.test.ts` and the cooldown case in
`evolution-automation.test.ts` pass against that unreachable code, which is why the proposal's
evidence base overstates existing coverage. This iteration did not delete them, because removing
a public-ish module is a separate decision with its own compatibility evidence. Recorded as a
reopen condition.

**Design conflict, resolved by SL02.** S08 acceptance asked that rollback remove the rejected
revision from active discovery, and `evolution-store.ts` deliberately did the opposite. SL02 records
three options and implements the middle one: unrelated historical skills stay discoverable, a
revision that some rollback moved away from is withdrawn and its materialized directory deleted.
The withdrawal record is the `rolled_back` event in `history.jsonl`, not the `current` pointer,
because the pointer only remembers the most recent rollback and a second rollback would otherwise
resurrect the first withdrawn revision. Both cases are covered by tests.

### Batch 2 changes actually made

1. **S05.4 redaction** — `evolution-refiner.ts` now redacts before the model call, using the
   redactor that already existed in the module. This closed a live hole: up to 24,000 characters
   of raw session text, which can contain provider keys, bearer tokens and private paths, were
   being sent to the model with the redactor sitting unused one file away.
   `test/evolution-refiner-redaction.test.ts` drives the real exported `planEvolutionCandidate`;
   verified to fail on pre-fix code (`git stash`: 1 failed, 1 passed).
2. **S08.5 / S08.7 rollback discovery** — see SL02. `test/evolution-rollback-discovery.test.ts`,
   5 tests; 4 of them fail against the pre-fix `discoverLocalSkillPaths`.
3. **S08.1 baseline-revision binding** — `EvolutionCandidateInput.baselineRevisionId` plus a
   promotion check. The field is optional, so candidates written before it stay valid.
   `test/evolution-baseline-binding.test.ts`, 5 tests, all driving the real fail-closed gate with
   real integrity-bound benchmark evidence.

Remaining gaps are not skipped. Each is recorded in
[findings/SL03-remaining-gaps.md](findings/SL03-remaining-gaps.md) with a concrete design and, where
one is needed, the specific product decision outstanding. Three of them (SL03-B, SL03-D, SL03-C)
are prompt changes that cannot be justified without the S09 measurements, and shipping them
unmeasured would repeat exactly the mistake S03 was reviewed for.

### S01 detail

Base had two separate lists: `builtInExtensions` (metadata) and 35 per-extension if/else
blocks (paths). `defaultEnabled` described metadata only and did not gate loading, so an
extension could be registered in one list and forgotten in the other.

The registry is now one ordered array, `REGISTRY`, from which both products derive.
`builtInExtensions` is a projection that strips the internal `entryRoot` / `activation` / `note`
fields, and `getBuiltinExtensionPaths()` walks the same array. `isEntryActivated()` is the only
loading rule: an entry loads when `defaultEnabled` is true, or when its activation switch is on.
The browser harness is the sole env-switched exception (`CATUI_ENABLE_BROWSER_EXTENSION`).
NanoMem keeps its own four-step package fallback because it ships as a package, not an
extension directory, which the `entryRoot`-optional activation type enforces.

| Measurement | Base | Now |
| --- | --- | --- |
| Descriptors | 35 | 35 |
| `defaultEnabled: true` | 32 | 32 |
| Resolved paths | 33 | 32 |
| Unique paths | 32 | 32 |
| Duplicate paths | `next-step` | none |
| Load order | 32 entries, `next-step` twice | identical 32-entry sequence, asserted against a recorded baseline |
| File size | 468 lines | 225 lines |

Load-order equivalence was checked by comparing the resolved id sequence against the base
sequence recorded in Batch 0: identical.

Drift protection, all in `test/builtin-extension-registry.test.ts`:
- `defaultEnabled is the loading decision` asserts metadata and the loaded set agree for all 35
  entries under both browser switch states. Negative check run: flipping `export-html` to
  `defaultEnabled: true`, and `insights` to `false`, each failed the suite; both were reverted.
- `the registry is one list` fails if a second `BUILTIN_LOAD_PLAN` list reappears, or if
  `builtInExtensions` stops being a projection of `REGISTRY`.
- `default load order is unchanged from the S01 baseline` pins the exact 32-entry sequence.
- `public metadata order matches load order` keeps the projection and the loader in agreement.
- `every extensions/builtin directory is registered, and non-opt-in ones load` reads the real
  filesystem, so a renamed or newly added directory without a registry entry fails.

Scope note: the public `builtInExtensions` array order now follows load order, whereas at base
it grouped `context-management` and `goal` next to related entries. No consumer reads that
order: `main.ts` and `core/runtime/sdk.ts` call only `getBuiltinExtensionPaths()`, and every
test uses `.find` / `.filter` / `.some`. `builtin-extensions.ts` is not re-exported from any
subpath in the `package.json` `exports` map and appears in no entry of
`.dev-docs/architecture-review/baseline/public-api-symbols-main.txt`, so this is not a public
API change.

## Gate receipts

Record exact command, commit, environment, exit code and relevant log path for:
DIP, quality, static/dist package boundaries, build, typecheck, focused tests,
full tests, harness evaluation, packaging, interactive/headless smoke, diff check
and final remote CI. No implementation gates have run for this proposal.

## Experiments

Record frozen baseline/candidate IDs and hashes, corpus, repetitions, model and
execution envelope, policy, metrics and uncertainty. Distinguish mock, pilot and
gate-sufficient runs. Current status: not run; no effectiveness claim.

## Compatibility, deviations and recovery

Record intentional behavior changes, public API/schema changes, retained aliases,
migrations, default settings, model-call effects, rollback procedure and rejected
designs only when needed to explain a trade-off. Current status: pending.

## Independent acceptance

- Structural: pending.
- Behavioral: pending.
- Effectiveness: pending.
- Remaining work / reopening conditions: pending.

Executor self-verification and independent reviewer acceptance are separate records.
