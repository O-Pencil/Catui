# Simplification and Evidence-Gated Skill Learning

Status: proposed for implementation; no application changes made by this proposal.
Prepared: 2026-10-02.
Executor: MiniMax 3.1, in a separate user-directed execution session.
Acceptance reviewer: Codex, after the user returns the implementation for review.

## 1. Objective and delivery contract

Reduce duplicated configuration, default context overhead, and unnecessary model
work. Connect existing execution evidence to small, verifiable skill improvements
without creating a second evolution framework.

This document is an implementation handoff, not evidence that its proposed changes
are already correct. Repository code at the execution base is authoritative. Verify
each finding before editing, and record any drift from the observations below.

Implement in three batches. Do not turn this proposal into an unbounded rewrite.
Prepare reviewable commits and a PR using the repository workflow. Do not merge,
publish, enable a service, or modify the user's live memory/skills/configuration as
part of this handoff. The user intends an independent acceptance review afterward.
Routine reversible implementation and tests do not need repeated confirmation.
Missing credentials or model budget block only the experiments that need them;
continue independent code work and report the exact unverified outcome.

Use English for repository documentation, code, prompts, comments, and commits.
Preserve existing user data, public compatibility, and unrelated working changes.

## 2. Required reading and architectural placement

Read before implementation:

- [Feature workflow](../../feature-workflow.md), especially sections 2b, 3, 5, 6.
- [Type placement](../evolution/dev-conventions.md), section 3b.
- [Current refactor ledger](../REFACTOR-LEDGER.md).
- [Runtime/skills cleanup closure](../runtime-skills-cleanup-review/closure.md).
- [Evidence-gated evolution closure](../evidence-gated-evolution-review/closure.md).
- [Source learning closure](../source-learning-review/closure.md).
- P2 maps and relevant P3 headers for every module being changed.

This review directory satisfies the initial review-container requirement. Before
each batch, extend [findings](findings/SL01-scope-and-evidence.md) with the actual
owner, dependencies, compatibility implications, and chosen implementation. Add
another finding card if a new boundary dispute appears. Record acceptance in
[closure.md](closure.md); do not mark it complete ahead of evidence.

| Concern | Owner / placement | Constraint |
| --- | --- | --- |
| Built-in selection and path resolution | Existing root `builtin-extensions.ts` | Keep product composition at its current owner; no new registry framework |
| Verification orchestration | `scripts/dev-loop/`, existing JSON plan, package scripts, CI | One defined gate set, with explicit platform/matrix differences |
| Skill discovery and generic formatting | Existing resource loader and `core/skills.ts` | Generic primitives only; product policy remains in extensions |
| Prompt bootstrap and Presence behavior | Relevant `extensions/builtin/` owners | No cross-extension imports to share business behavior |
| Candidate skills, evaluation, promotion | `extensions/optional/evolution/` | Reuse existing candidate/revision/gate semantics |
| Source repair and independent audits | `extensions/optional/evolution/source/` | Keep its protected verifier and delivery authority separate |
| Benchmark CLI and experiment reporting | Existing `scripts/evolution-*` and benchmark modules | Offline orchestration must not grant runtime execution authority |

Keep types at the narrowest consumer scope. Do not expand `catui-protocol` unless
an actual published-package consumer requires a contract change. No new dependency
is expected. A dependency, public API, or persisted schema change requires an
explicit finding with migration and compatibility evidence before implementation.

## 3. Verified starting observations and limits

Observations from the local checkout on 2026-10-02; remeasure at the execution SHA:

1. `builtin-extensions.ts` has 35 descriptors, 32 marked default-enabled. Its path
   function returned 33 paths and 32 unique paths. `next-step` is appended twice.
   This demonstrates redundant configuration, not proven double hook execution;
   downstream paths can be deduplicated. Preserve actual loader behavior.
2. Metadata, path constants, and resolution branches are maintained separately.
   Registration order carries behavior: Diagnostics precedes SAL, SAL precedes
   NanoMem, and next-step precedes Presence.
3. Five bootstrap hooks returned 4,388 characters in a minimal mock API execution:
   TypeSafe 1,112; Discipline 1,205; Catpaw 872; Humanizer 362; CATAIL 837.
   This is not a tokenizer count or full prompt measurement. Skill descriptions
   and other extensions add separate context. Skill bodies already load on demand.
4. Presence has a separate `generateAwakening()` model call, enabled under its UI,
   settings, model and credential conditions. Its result is appended to subsequent
   system prompts. Presence also calls `collectSoulHints(ctx.getSoulManager())`,
   while the default AgentSession Soul getter now always returns `undefined`.
5. `npm test` invokes `test:release`, which performs a full build. Running build
   before this test chain rebuilds. `verify:all` does not run the full root build.
   Local, dev-loop, and CI test selections differ.
6. Evolution already includes `skill_manifest`, trace distillation, predictions,
   candidates, revisions, quarantine, candidate-bound held-out benchmark gates,
   attribution and rollback mechanisms. Source evolution also has independent
   audit/verification work. These are existing assets, not new features to recreate.
7. Harness fixtures exercise deterministic runtime invariants. Passing them does
   not establish real-model skill effectiveness or lower token cost.

The proposal author ran only local path/bootstrap probes and source inspection.
The checkout lacked `tsx`; native Node TypeScript support was sufficient for those
limited probes. Full build/tests, provider-backed experiments, and terminal smoke
were not run. Historical closure results are not current-branch test receipts.

## 4. Iteration overview: item, change, benefit

| ID / batch | Item | Change | Expected benefit |
| --- | --- | --- | --- |
| S01 / 1 | Extension registry | Derive ordinary paths from one ordered descriptor list | Fewer edit sites and selection/order drift |
| S02 / 1 | Verification entrypoint | Reuse the existing plan; separate build from artifact tests | Consistent gates and fewer redundant builds |
| S03 / 1 | Bootstrap prompts | Remove duplicate routing prose; retain necessary constraints | Less default context and competing guidance |
| S04 / 1 | Presence | Remove obsolete default-host Soul work; evaluate awakening removal | Less dead behavior and potentially fewer model calls |
| S05 / 2 | Learning destination | Route facts, task state, procedures, defects to existing owners | Less duplicate storage and global rule pollution |
| S06 / 2 | Candidate skill loop | Connect traces/results, reflection, existing-skill lookup and proposals | Reuse actual experience instead of repeated trial and error |
| S07 / 2 | Bounded edits | Prefer updates; cap edits and retain rejected-edit feedback | Less library growth and overfitting |
| S08 / 2 | Promotion/rollback | Verify and fill gaps in existing evidence-bound lifecycle | Prevent unproven or regressing skills becoming active |
| S09 / 3 | Ablation experiments | Compare one changed component at a time under frozen conditions | Evidence for keeping, shortening, or deleting components |
| S10 / 3 | Streaming and idle budgets | Test transfer/interference; avoid learning without new evidence | Bounded learning cost and fewer cross-task regressions |

S01/S02 can demonstrate structural benefits directly. Prompt quality, latency,
task success, and model-cost benefits are hypotheses until measured.

## 5. Batch 0: baseline and gap inventory

Before coding, record in closure.md:

- Base commit, branch, dirty paths, Node/npm versions, OS, dependency state.
- Current registration IDs, resolved unique paths, loading order and env switches.
- Exact local/CI/dev-loop command sets, including builds performed transitively.
- Prompt hook character counts and assembled prompt/token measurements if available.
- Current tests relevant to each item, including any pre-existing failures.
- An evolution capability matrix: requirement, actual symbol/path, existing test,
  status (`already-covered`, `partial`, `missing`), and smallest remaining change.

Inspect current `evolution-types.ts`, `evolution-refiner.ts`,
`evolution-distillation.ts`, `evolution-auto.ts`, `evolution-store.ts`,
`evolution-gate.ts`, benchmark modules, and source/learning owners. Trace the actual
call path; a P2 entry is a navigation aid, not proof of working integration.

An already-covered requirement needs evidence, not another implementation.
If a historical gap has since closed, remove it from this iteration's code scope.

## 6. Batch 1: reduce overhead and maintenance duplication

### S01. One ordered built-in registry

Entry points: `builtin-extensions.ts`, its consumers/tests, main.ts composition.

- Establish a single ordered declaration for normal built-in identity, defaults
  and entry location. Generate the common compiled-JS/source-TS fallback once.
- Retain explicit handling for NanoMem package fallback and Browser environment
  activation. Preserve Evolution's currently approved default-on behavior even
  though its source lives under `optional/`.
- Preserve exports and deprecated aliases unless separately approved for removal.
- Delete the duplicate next-step registration. Do not fix only by appending a Set
  while leaving three independent lists as the maintenance model.
- Do not equate default-loaded with background-active: idle-think currently has
  its own disabled-by-default behavior setting.

Acceptance: unique resolved paths; existing IDs/defaults/order remain equivalent;
source and built layouts work; missing optional resources degrade as before;
Browser env enabled/disabled and NanoMem fallback precedence remain covered.
Verify `--no-extensions` existing product semantics rather than silently changing
them. Use filesystem fixtures or existing loader tests, not a test that merely
compares a generated list to the same input list.

### S02. One verification contract, one build per full run

Entry points: package.json, `.dev-docs/vibe-coding/verification-plan.json`,
`scripts/dev-loop/`, `.github/workflows/ci.yml`, quality workflow, release tests.

- Make the existing plan the authoritative full-verification membership or give
  it one explicit source shared with scripts. Do not invent a new task runner.
- Separate a build-free artifact-test stage from a convenience release-test stage
  that ensures prerequisites. Preserve documented direct invocation behavior.
- Ensure a documented full-verification command covers all five mandatory gates,
  required test suites, and the post-build dist package-boundary check.
- Align local and CI mandatory coverage. Keep justified Node/platform matrix jobs;
  do not force identical command scheduling across OSes or remove native checks.
- Guard plan/script relationships against drift and accidental recursive scripts.
  Tests must fail when a required gate is removed or an artifact test runs against
  missing prerequisites.

Acceptance: document old/new command expansion; demonstrate no duplicate full
build in the intended aggregate flow; show failures propagate nonzero; retain
release packaging and prepublish verification. Report timing only if measured.

### S03. Shorter bootstrap, unchanged critical routing

Entry points: five measured extension index files, their skill metadata/content,
`core/skills.ts`, prompt tests and resource-discovery tests.

- Inventory each sentence as generic routing, unique policy, compatibility note,
  or task-specific procedure. Keep one owner for repeated generic routing.
- Put skill trigger information in discoverable metadata where it is reliably
  available before invocation. Move detail into on-demand skill references.
- Preserve CATAIL's explicit invocation/Athena scientific-intent boundary;
  ordinary coding must not trigger scientific workflow from keyword matches.
- Preserve Catpaw's incompatible external hook/config caveat at the point needed
  before executing a referenced command. Moving it must not imply automatic hooks.
- Preserve user-instruction precedence and existing permissions. Do not silently
  change mandatory workflow policy under the label of text deduplication.
- Do not introduce a model-based routing call or new per-turn filesystem scans.

Acceptance: report per-extension and assembled-prompt before/after counts with the
same fixture. Aim for at least a 25% reduction of the five measured bootstraps
without losing constraints; this is a target, not permission to remove safeguards.
If not achievable, record retained text and why. A shorter bootstrap is not a
success if an equivalent always-loaded description becomes longer.
Cover positive/negative routing cases (coding, prose, UI, explicit CATAIL,
Athena scientific task, Athena ordinary maintenance). Deterministic checks establish
availability and content; real-model routing effectiveness belongs to S09.

### S04. Presence and suspended Soul cleanup

Entry points: Presence implementation/tests, Persona references, default-host
Soul binding, runtime-skills-cleanup closure.

- Trace whether non-default hosts can still supply Soul hints. Remove only proven
  obsolete internal paths; keep deprecated public compatibility where required.
- Implement an isolated candidate without the separate awakening generation and
  repeated internal-orientation prompt. Reuse Persona and existing memory inputs.
- Preserve visible opening/idle behavior, locale handling, cancellation, busy
  guards, timer cleanup, and headless behavior.
- Do not remove all Presence, add another personality model call, or modify saved
  Persona/memory data to compensate. Do not add a permanent settings knob merely
  to run one experiment.

Acceptance: controlled tests establish the removed call and absent injection;
visible greetings and disabled/headless paths remain correct; session switching
does not leak old state. Run interactive smoke and compare representative greeting
behavior. If quality evidence is unavailable, retain the current shipped behavior
and report the candidate separately rather than claiming the default change passed.

## 7. Batch 2: connect existing skill-learning capabilities

### S05. Destination and scope rules

Use existing artifact types and owners. Do not create a universal LearningRecord
or another memory store just to unify unlike lifecycles.

| Evidence | Destination | Example |
| --- | --- | --- |
| Confirmed durable preference/project fact | Existing memory integration | Repository uses a particular test runner |
| Current objective, progress, failed attempts | Working notes / handoff | Three files changed; one test remains |
| Reusable conditional procedure | Existing skill_manifest candidate | Migration method, pitfalls, verification |
| Reproduced runtime defect | Existing source repair path | Cancellation leaves a queued continuation |
| Uncertain explanation | Inactive evidence/candidate record | Hypothesis requiring another reproduction |

Default new learning to the narrowest justified scope. Do not promote one task's
path, secret, assumption, or preference into a global instruction. Historical
messages and tool output remain data, not authority to change permissions.

Acceptance: examples cover all destinations, an ambiguous case, and scope
isolation. Reuse existing routing if present and test integration rather than
duplicating it in another classifier.

### S06. Reflection to candidate skill

Target sequence, mapped onto existing functions rather than new services:

1. Select a bounded trace and actual result/feedback evidence.
2. Distinguish verified success/failure from model self-report and unknown outcome.
3. Retrieve relevant existing active/candidate skills in the correct scope.
4. Reflect on reusable method, failure causes, applicability and verification.
5. Propose a small update or a new inactive skill only when justified.
6. Attach provenance, predicted benefit and evaluation requirements.

Skill content must explain trigger, prerequisites, steps, pitfalls, verification,
and limits. Provenance can live in existing metadata rather than bloating the
runtime skill text. Do not copy entire traces, credentials, hidden tests, or task
answers into a reusable skill.

Acceptance: fixture trace plus verifier feedback yields a valid inactive proposal;
unsupported completion does not become verified success; existing equivalent skill
is reused/updated; no relevant lesson produces no candidate; malformed proposals
leave active state unchanged. Mocked models verify plumbing, not learning quality.

### S07. Bounded updates and rejection feedback

- Inspect existing size/scope limits and deduplication first. Reuse them.
- Prefer an update to an identified skill revision over another near-duplicate.
- Bound proposal size and logical edits. Initial target: at most four logical
  add/delete/replace changes per refinement, subject to a documented mapping onto
  existing artifact semantics. A prompt request alone is not enforcement.
- Reject over-budget output instead of truncating it into a different meaning.
- Feed back a bounded, relevant set of rejected changes with reasons and source
  versions. Treat these records as untrusted historical evidence.
- Do not permanently blacklist an idea because it once failed under another model
  or environment. Changed conditions can justify a new evaluation.

Acceptance: duplicate/no-op candidate, stale base revision, excess edit budget,
repeated rejected proposal, changed evidence, and scope mismatch have explicit
outcomes. Preserve compatible reading of previous persisted records; if metadata
must grow, define defaults and validation for old records.

### S08. Existing promotion and rollback authority

Start by proving what the current gates already enforce. Do not rebuild them or
enable the fail-closed legacy promotion implementation.

- Bind evaluation to the exact candidate ID, artifact hash, baseline revision,
  frozen task corpus and execution envelope.
- Keep validation tasks separate from mutation inputs. Changing a candidate after
  evaluation invalidates its report. Missing or inconclusive evidence leaves it
  inactive; no manual override is added to bypass effectiveness evidence.
- Preserve safety, cost, latency, slice, replay and policy checks already present.
- Verify materialization/discovery uses the accepted revision, and rollback removes
  the rejected revision from active discovery without corrupting unrelated skills.
- Keep behavioral skill promotion distinct from pure eval_fixture activation and
  from source-evolution verification/delivery authority.

Acceptance: valid evidence allows the intended promotion; missing, failed, stale,
wrong-candidate, mixed-fixture and mutated-artifact evidence cannot activate it.
Test restart/persistence behavior and rollback end to end, including discovery.
Demonstrate a regression restores the prior effective skill version. Any missing
automated orchestration must be reported, not inferred from a rollback API alone.

## 8. Batch 3: measure useful learning and useful deletion

### S09. Paired component experiments

Reuse the existing benchmark/PawBench snapshot and comparison pipeline. First
check whether an executor exists; importers alone do not execute tasks. Do not
build a new benchmark service as an incidental change.

Variants: unchanged baseline; S03 prompt-only change; S04 Presence-only change;
one accepted candidate skill versus its baseline. Combine changes only after
individual comparisons, so effects remain attributable.

Freeze corpus, grader, model/provider/version where available, reasoning settings,
tools, initial workspace/state, budgets and repetition policy before collecting
results. Use a task mix covering coding, debugging, prose, UI, long-context work
and irrelevant-skill negative controls as applicable to each hypothesis.

Record task pass rate, safety violations, input/output/cache tokens when available,
model/tool calls, wall-clock time, unnecessary clarification and skill misrouting.
Separate one-time learning cost from recurring execution cost. Character reduction
is not token reduction; shorter prompts are not automatically lower billed cost.

Use existing statistical/sample gates; never lower them to make the iteration
pass. Small pilot results are exploratory. Missing paired samples are inconclusive.
If no provider credentials or approved experiment budget are available, deliver
fixtures, reproducible commands and an explicit unrun experiment table. Do not use
mock traces as provider-backed effectiveness evidence or activate new skills.

### S10. Task-stream regression and budgeted idle learning

- Test isolated, sequential and interleaved task streams with controlled initial
  state. Look for irrelevant retrieval, order effects and cross-project leakage.
- Add orchestration only where absent. Reuse the existing observer and budget
  mechanism; no second background daemon, timer loop or storage namespace.
- Require new eligible evidence since the previous attempt. Persist a bounded
  evidence cursor/fingerprint using the existing store to avoid restart repeats.
- Reserve call/token budget before invoking a model; no unchanged-evidence loop.
  Preserve existing daily source-audit budgets and opt-in/background policies.
- Learning must not block foreground interaction. Errors produce diagnostics and
  leave active state unchanged; cancellation/shutdown releases owned resources.

Acceptance: repeated evidence causes no new call; restart preserves deduplication;
new evidence can run within budget; exhausted budget makes zero model calls;
concurrent triggers cannot double-spend; failure/abort does not activate a candidate.
Do not silently turn currently disabled idle behavior on for existing users.

## 9. Required verification and user-path checks

Run focused meaningful tests for changed invariants, then the final aggregate gate.
If S02 changes script names, retain an explicit mapping to the canonical commands.

```bash
npm run verify:dip
npm run verify:quality
npm run verify:package-boundary
npm run build
npx tsc --noEmit
npm run verify:package-boundary:dist
```

Also run affected suites and full repository tests through the new non-duplicating
flow. Include harness-critical/eval, evolution/promotion, resource discovery,
Presence, command catalogs and dev-loop coverage as relevant. Do not skip an
unrelated failing mandatory gate: distinguish baseline failures and document them;
the final status remains blocked or partial until resolved or reviewed explicitly.

Required smoke coverage: built CLI help/version; interactive opening/idle/disable;
headless prompt and skills discovery; extension reload; candidate review, rejection,
promotion with valid evidence, rollback and restart. Use temporary data roots, not
the user's live `.catui` data. Validate packaging still includes required skills,
licenses and assets. Review public exports and persisted-format compatibility.

Synchronize P1/P2/P3 only where actual structure/responsibility changes require it.
Run `git diff --check`. Stage named files only; never `git add -A`. Conventional
English commits, no Co-Authored-By trailer. CI must validate the final PR revision.

## 10. Delivery format for independent acceptance

Keep changes reviewable: suggested commits are registry, verification, bootstrap,
Presence, skill-loop gap fixes, lifecycle/evidence tests, experiment documentation.
Each code-bearing commit should preserve its stated invariants. Do not split by
file count at the expense of coherent behavior.

Update closure.md with a row for every S01-S10 item:

| ID | Status | Code/test references | Before/after evidence | Limit or blocker |
| --- | --- | --- | --- | --- |
| Sxx | implemented / already-covered / partial / blocked / deferred | Exact files and tests | Measured result or explicit unrun | Concrete reason |

Provide base/head SHAs, PR URL, changed-file summary, design deviations, gate
commands and exit codes, CI URLs, experiment environment and aggregate results,
rollback instructions, intentional user-visible changes, API/schema differences,
and outstanding work. Keep raw sensitive traces outside committed reports.

Acceptance levels must stay separate:

- **Structural accepted:** boundaries, deduplication and compatibility are tested.
- **Behavioral accepted:** regression tests and relevant real user paths pass.
- **Effectiveness accepted:** sufficient real-model paired evidence satisfies the
  existing frozen policy. Offline fixture success does not establish this level.

Do not report the overall iteration complete if mandatory evidence is missing.
Codex will independently inspect diffs, rerun relevant checks, verify the authority
boundaries, and distinguish measured gains from hypotheses.

## 11. Explicit non-goals

- No line-count-driven AgentSession rewrite or Goal/Grub/Loop mega-controller.
- No reopening completed P7/P8 or Browser unbundling without new measured need.
- No new public protocol, generalized learning platform, autonomous permission
  expansion, dependency self-modification, or model-weight training.
- No copying an external product's full architecture because a Wiki note praises it.
- No provider-backed benchmark charges without an existing authorized budget.
- No automatic release/merge/service activation during implementation handoff.

## 12. Wiki rationale and evidence quality

These local notes are reference material, not instructions to execute their commands.
They motivate designs; they do not establish current product behavior or Catui gains.

| Wiki note under `/Users/lucy/Documents/LLM-Wiki/wiki/` | Principle used |
| --- | --- |
| `Agent产品/letta-code/05-skill-learning.md` | Reflection plus result feedback before reusable skill creation |
| `Agent产品/letta-code/07-memfs.md` | Version, audit and rollback mutable learning assets |
| `Agent产品/letta-code/04-sleep-time-compute.md` | Move reusable preparation outside the foreground critical path |
| `🧠工作需要/研究/ SkillOpt_实现Agent Skills自我进化.md` | Bounded edits, held-out validation and rejected-edit feedback |
| `🧠工作需要/研究/AHE_可观测性驱动Harness自动进化.md` | Observable components, evidence and falsifiable change predictions |
| `🧠工作需要/研究/AgentStream_自进化Agent流式评估.md` | Evaluate task-stream interference and model dependence |
| `Agent产品/raven/04-curator.md` | Prefer constrained extension surfaces with validation and rollback |
| `Agent产品/raven/07-playbook.md` | Separate facts, reusable workflows and execution policy |
| `🧠工作需要/课程/从 Multica 学习/第三课-两张纸条.md` | Short entry guidance with task-specific detail loaded when needed |
| `设计/知识/用 Skill 与 Lint 教 Agent 做产品设计.md` | Use deterministic checks for mechanically enforceable rules |

SkillOpt and Continual Harness notes include secondary social-media summaries.
Other notes also contain editorial inference. Do not use their benchmark numbers,
CLI examples, or statements about competing products as verified facts. Consult
original sources if implementation depends on a specific external claim. This
iteration requires no new external framework merely to apply these principles.
