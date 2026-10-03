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
| S02 | Implemented (structural) | `package.json`, `.dev-docs/vibe-coding/verification-plan.json`, `.github/workflows/ci.yml`, `tsconfig.scripts.json`, `test/verification-contract.test.ts` (34), `test/verification-stage-order-recheck.test.ts` (9), `test/verification-ci-parity-recheck.test.ts` (10) | See S02 detail below | Three test files run more than once, each allowlisted per flow with a reason; CI runs two npm steps the plan does not describe, both on an explicit reasoned allowance list; the npm-run graph walk now has a named traversal strategy, so the global-visited alternative is tested rather than argued against; full-build scripts are recognised by a vocabulary that is itself checked against the graph, which found prepublishOnly missing from it |
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
| S06.2 verified outcome vs self-report vs unknown | turn-end marks both sources `provenance` (model self-report) with no `verified` flag; `LESSON_PATTERN` `evolution-auto.ts` still regexes the assistant's own prose, so the regex finding stands | `test/evolution-auto-provenance.test.ts`, `test/evolution-auto-promotion-gate.test.ts` | **implemented (provenance)** — self-report cannot self-promote |
| S06.3 retrieve existing skills in scope | `existingArtifactInventory` `evolution-refiner.ts` reads `getEvolutionScopeRoot` + `loadActiveEvolutionArtifacts` and lists id/kind/title, bounded at 40 | `test/evolution-refiner-existing-skills.test.ts` (7 cases) | **implemented** — `inspectEvolution` has no active-artifact list, so the store loader is used instead |
| S06.4 small update or new inactive skill | `planEvolutionCandidate` `evolution-refiner.ts:127`; inactive path `evolution-refine-tool.ts:265` | `evolution-extension.test.ts` inactive-plan case | partial (prompt only) |
| S06.5 provenance + predicted benefit in metadata | `EvolutionPrediction` `evolution-types.ts:35`; `skillMarkdown` `evolution-store.ts:149` | `evolution-store.test.ts` prediction case | already-covered (shape) |
| S06.6 skill body states trigger/prereqs/steps/pitfalls/verification/limits | `validateSkillManifestStructure` `evolution-store.ts`; trigger/limits ride on the existing `applicability`/`nonApplicability` fields rather than a second prose copy | `test/evolution-skill-body-structure.test.ts` (20 cases) | **implemented** — write-only enforcement; see the store-validation compatibility note below |
| S06.7 no whole traces or credentials in skills | `MAX_CONTENT_CHARS` `evolution-store.ts:36`; `EXECUTABLE_PATTERNS` `evolution-store.ts:57` | `evolution-store.test.ts` rejection cases | partial |
| S06.8 acceptance set | no test for "no lesson → no candidate"; no test for malformed `catui_evolution` JSON | none | missing |
| S07.1 reuse size limits and dedup | limits reused; `assertNoDuplicateProseArtifact` refuses a copied prose body pairwise, both within a candidate and against the ledger; `nearDuplicateProseWarnings` reports a mere rewording; `assertNoDuplicateEvalFixture` untouched | `test/evolution-skill-dedup.test.ts` (17 cases) | **implemented** — eval_fixture rule unchanged |
| S07.2 prefer update over near-duplicate | `EvolutionArtifact.overrides` `evolution-types.ts` plus `resolveOverrideArtifacts` `evolution-store.ts`; the older `mergeScopedArtifacts` `workflow.ts` remains dead code | `test/evolution-overrides.test.ts` (16 cases) | **implemented** — overrides resolve at promotion against the verified baseline |
| S07.3 at most four logical edits, enforced | `MAX_LOGICAL_CHANGES_PER_CANDIDATE` `evolution-store.ts` counted by `logicalArtifactChanges`, enforced in `assertValidInput` so an over-budget candidate is never persisted | `test/evolution-edit-budget.test.ts` (10 cases) | **implemented** — artifact-level add/change/delete, rejected whole |
| S07.4 reject over-budget, do not truncate | `assertValidInput` `evolution-store.ts:501` throws before persistence | `evolution-store.test.ts` rejection cases | already-covered |
| S07.5 feed rejected changes back to the refiner | `listRejectedCandidates` plus a bounded, redacted, explicitly untrusted history block in `planEvolutionCandidate` | `test/evolution-rejection-feedback.test.ts` (13 cases) | **implemented** — reasons and source revisions only, never bodies |
| S07.6 no permanent blacklist | no blacklist exists; one scope-root-keyed `COOLDOWN_TURNS` gate in `evolution-auto.ts` now covers every proposing branch and is in-memory, so it expires and a restart clears it | `test/evolution-auto-cooldown.test.ts` (8 cases) | **implemented** — the repeated-structured-proposal gap is closed |
| S07.7 acceptance outcomes | stale baseline and scope mismatch both refused before anything is written; `evolutionScopeOfRoot` enforces scope/root agreement | `test/evolution-scope-and-stale-rejection.test.ts` (10 cases) | **implemented** — the scope half was a live policy bypass |
| S08.1 bind ID, hash, corpus, envelope | `verifyEvolutionBenchmarkReport` `benchmark-comparison.ts:201`; `validateBenchmarkPair` `benchmark-evidence.ts:186` | `evolution-benchmark-promotion.test.ts` | already-covered except baseline revision |
| S08.1 baseline revision bound | `EvolutionCandidateInput` `evolution-types.ts:79` has no `baselineRevisionId`; the field exists only in dead `prompts.ts:98` | none | missing |
| S08.2 validation separate from mutation inputs | held-out split enforced in `validateBenchmarkPair`; `verifyEvolutionBenchmarkReport` compares `candidateContentHash`, so mutation invalidates the report | `evolution-benchmark-promotion.test.ts` | already-covered |
| S08.3 no manual override to bypass evidence | no override path found on the live path | `evolution-extension.test.ts` evidence-required case | already-covered |
| S08.4 safety/cost/latency/slice/replay checks | `benchmark-comparison.ts:131-136` | `evolution-benchmark-promotion.test.ts` | already-covered |
| S08.5 materialization and rollback change discovery | `rollbackEvolution` `evolution-store.ts:1003` rewrites the current pointer, but `evolution-store.ts:1098-1123` deliberately retains prior skills "so users benefit from all their accumulated skills" | `evolution-store.test.ts` rollback cases | **partial — design conflict, see below** |
| S08.6 restart/persistence | store is file-backed and reloaded in existing tests | `evolution-store.test.ts` | already-covered |
| S08.7 end-to-end discovery after rollback | no test calls `loadActiveEvolutionSkillPaths` after a rollback | none | missing |
| S10.1 isolated/sequential/interleaved streams | `BUILTIN_HARNESS_EVAL_MANIFEST` `core/harness-eval/scenarios.ts:31` has no streams; only reachable via a hand-written manifest | `evolution-extension.test.ts:1054` | partial |
| S10.2 reuse existing observer and budget | the observer exists (`evolution-auto.ts`) and is default-inert; the behavior path now also has a real budget (`evolution-budget.ts`) rather than only the unreachable source-side one | `test/evolution-default-off.test.ts` (11 cases), `test/evolution-model-budget.test.ts` (15) | **implemented** — observer stays default-inert; budget guards the one model call |
| S10.3 require new evidence since last attempt | `evidence-cursor.json` per scope root, keyed to the turn stream that wrote it | `test/evolution-evidence-cursor.test.ts` (8 cases) | **implemented** — written only when a turn produces a candidate |
| S10.4 reserve budget before calling a model | `evolution-budget.ts` reserves against a daily owner-only ledger under the existing evolution root, immediately before the extension's only `completeSimple`, serialized by an exclusive lock it never removes on a guess about who owned it | `test/evolution-model-budget.test.ts` (15 cases), `test/evolution-concurrent-budget.test.ts` (5) | **implemented** — exhausted means zero model calls; an orphaned lock is refused, never taken over, and removed by hand only once no writer can be racing it |

**Store-validation compatibility change, and why the rule is write-only.** S06.6 adds a
structural requirement to `skill_manifest` bodies. The first implementation put the check inside
`validateArtifact` unconditionally, on the assumption that reading a stored revision does not
re-validate. That assumption was wrong: `loadRevision` `evolution-store.ts` does call
`validateEvolutionCandidateInput`, so a skill promoted before the rule existed would fail to load,
`loadCurrentEvolution` would quarantine it, and the skill would drop out of prompt and skill
discovery without any error reaching the user.

The rule is therefore enforced on write only. `validateEvolutionCandidateInput` takes a private
`enforceSkillBodyStructure` flag that defaults to on, and `loadRevision` is the sole caller that
turns it off; `loadActiveEvolutionArtifacts`, `loadActiveEvolutionSkillPaths`, and `rollbackEvolution`
all route through it, so historical skills stay readable, renderable, and rollback-able. The flag is
deliberately not exported: a public switch that disables validation is one a future caller will
disable by accident. `test/evolution-skill-body-structure.test.ts` writes a pre-rule revision
straight to disk to prove the compatibility claim, since going through `createEvolutionCandidate`
would only ever produce conforming records and prove nothing.

Fence tracking in `markdownHeadings` is CommonMark-shaped on purpose: the opening run fixes both the
marker character and its length, and only a bare run of that same character at least that long
closes the block. A boolean toggle was the first implementation and it was wrong — supervisor
review reproduced a body that opened with four backticks, closed the block with three, and had all
four required headings counted as real sections. Unrecognized markers leave the block open, which
can only fail validation, never fake a section.

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

### S02 detail

Base had three disagreeing verification surfaces: `npm test` compiled inside `test:release`,
`verify:all` skipped the build and every suite, and the dev-loop plan listed a fourth, smaller set
with no post-build dist boundary step at all. `verify:full` is now the single documented full run.

| | Base | Now |
| --- | --- | --- |
| Full builds in one aggregate run | 1 (`test`) / 0 (`verify:all`) | 1 (`verify:full`, `test`) |
| `build:deps` executions in `verify:full` | n/a | 1 |
| Suites in the plan | 4 of 9 | all required suites, including the evolution lifecycle suites |
| Scripts under `tsc --noEmit` | not covered | covered by `tsconfig.scripts.json` |
| Dist package-boundary in the plan | absent | present, ordered after build |
| Scripts under `tsc --noEmit` | not covered | covered by `tsconfig.scripts.json` |

Command expansion, before and after:

```
base npm test      -> build -> test:release -> build -> (4 files) -> test:pre... -> test:harness-critical
now  npm test      -> test:release -> build -> test:release-contracts + test:artifact -> test:pre -> test:harness-critical
new  verify:full   -> build -> verify:dip -> verify:quality -> verify:package-boundary -> typecheck
                      -> verify:package-boundary:dist -> verify:contract -> test:release-contracts
                      -> test:artifact -> test:pre -> test:harness-critical
```

One coverage regression was introduced and fixed during this item. Splitting the release stage by
build dependency first put only `cli-output-disconnect` in `test:artifact`, which silently dropped
`release-build`, `sal-terrain-budget` and `persona-assets` from `npm test`. `context-management` was
a second loss: CI ran it through a raw `node --test` step that had no home in the script graph.
Both are restored and both are now pinned by `the default test chain still runs every file it ran at
base, plus context-management`, which was verified to fail against each removal.

`test/verification-contract.test.ts` (31 tests) enforces: required gates present and required, dist
boundary after build, one build per aggregate run, no script cycle, no plan command reaching
`verify:full`, plan and CI in agreement, no raw `node --test` in CI, that every regression file added
by this batch is reachable from `npm test`, that the evolution boundary suite duplicates no file
another stage already runs, that cross-stage duplication equals an explicit allowlist, that the
typecheck covers both the product and scripts programs, and the graph walk itself via counterexamples
that call the same function used on `package.json`.

Known, deliberate, allowlisted: `test/default-runtime-tools.test.ts` is listed in both `test:tools`
and `test:harness-critical`, so it runs twice. That predates this work. The harness-critical eval
gate is load-bearing and restructuring it is a separate decision, so it is recorded rather than
removed; the allowlist exists so the duplication cannot grow silently.

## Gate receipts

Environment: macOS 26.6.2, Node v24.21.0, npm 11.19.0. Base `3d1cce1`, branch
`refactor/simplification-learning-batch1`.

**These receipts are from a single `npm run verify:full` on head `fd46a3f` only.** Earlier runs in
this branch, and the CI results quoted on the pull request against earlier commits, are superseded
and are not evidence for this head. Re-run any gate before relying on it.

| Gate | Command | Result |
| --- | --- | --- |
| DIP | `npm run verify:dip` | pass, 702/702 P3 headers, 39 P2 modules |
| Quality | `npm run verify:quality` | pass, 767 TypeScript files scanned |
| Package boundary (static) | `npm run verify:package-boundary` | pass |
| Build | `npm run build` | pass, 1 invocation (`clean:dist` also 1) |
| Typecheck (product) | `tsc --noEmit` | pass |
| Typecheck (scripts) | `npm run typecheck:scripts` | pass, 0 errors |
| Package boundary (dist) | `npm run verify:package-boundary:dist` | pass, static + dist |
| Plan/script contract | `npm run verify:contract` and `npm run test:contract` | pass, 31 tests, both gates |
| Release contract tests | `npm run test:release-contracts` | pass, 9 tests |
| Artifact tests | `npm run test:artifact` | pass |
| Pre-build suites | `npm run test:pre` | pass |
| Evolution boundary suite | `npm run test:evolution-boundaries` | pass, 91 tests |
| Contract suite in the chain | `npm run test:contract` | pass, 31 tests |
| Harness critical + eval | `npm run test:harness-critical` | pass |
| Full test total | `verify:full` aggregate on head `fd46a3f` | **656 tests, 656 pass, 0 fail** |
| Registry probe | `scripts/dev-loop/bootstrap-length-probe.ts` | 32 paths, 32 unique, 0 duplicates; 3,176 bootstrap chars |
| `git diff --check` | whitespace | clean |
| Remote CI | `gh pr checks 23` | must be re-read against head `fd46a3f`; results shown against earlier commits are not valid for this head |
| Interactive smoke | not run | not run |
| Headless smoke | partial | covered indirectly by SDK/headless tests in `test:runtime-owners`; no manual terminal pass |
| Packaging | not run | `prepublishOnly` contract asserted by `test:release-contracts`; no publish attempted |

Deliberately not run: interactive terminal smoke, real-provider experiments (S09/S10), and any
publish, merge, or service activation.

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
