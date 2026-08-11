# Self Evolution Review Closure

status: implemented controlled autonomous slice

## Implemented

- Added `extensions/optional/evolution/` as the owner for controlled self-evolution.
- Added `/refine` manual proposal, status, inspect, promote/approve, reject, and rollback commands.
- Added `<agentDir>/evolution/v1/` scoped stores for global, workspace, and session evolution.
- Added static validation that rejects unnamespaced, oversized, executable, package, command, server, and credential-like artifacts.
- Added immutable revisions, `current.json` activation, append-only history, and pointer-only rollback.
- Added prediction manifests so candidates can declare falsifiable metric/direction/target expectations, and promoted revisions preserve those predictions for later attribution.
- Added post-hoc attribution records so later gate metrics classify revision predictions as kept, falsified, or inconclusive without mutating immutable revision manifests.
- Added conservative auto-rollback so falsified attribution on the current revision can move `current.json` back to its predecessor without deleting revisions or touching non-current revisions.
- Added stream-aware auto-rollback thresholds so workspace/global revisions require repeated stream falsification, while interleaved falsification is treated as stronger contamination evidence.
- Added quarantine records for invalid active revisions so corrupted or tampered artifacts stop injecting and remain auditable.
- Added `before_agent_start` injection for promoted `prompt_note` and `memory` artifacts only.
- Added `evolution_refine` so the model can create declarative artifacts and auto-promote scoped artifacts without installing code.
- Added active `skill_manifest` materialization through `resources_discover`, exposing namespaced evolved `SKILL.md` resources from private evolution roots without writing to user/project skill directories.
- Added `evolved_tool` so promoted declarative `tool_spec` artifacts become reusable model-callable procedures without executable code; structured metadata can declare required inputs, ordered steps, and existing tool names, and invocation returns a non-executable plan.
- Added `workflow_spec` as a first-class declarative workflow asset. Workflow specs require structured phases/checks and success signals, then become reusable through `evolved_tool` without executing generated code, installs, releases, or publish actions.
- Added `evolved_executable_tool` as a workspace-only restricted executable prototype. It only runs promoted `executable_tool` artifacts after approved content-hash and no-IO permission-manifest checks, and the runtime supports only safe in-memory DSL transforms: template rendering, bounded regex extraction, and JSON path extraction.
- Added append-only usage records for promoted `tool_spec`, `workflow_spec`, and `executable_tool` invocation. Usage stores artifact id/kind, revision id, status, timestamp, caller, input hash, and bounded result/error summaries without persisting raw task input.
- Added `/refine feedback <usage-id> useful|not-useful [note]` for append-only usefulness feedback tied to usage records without mutating usage, revision, or artifact manifests; secret-like note fragments are redacted before persistence.
- Added `/refine review` so users can inspect per-asset usage, success/error counts, useful/not-useful feedback, and conservative keep/watch/review recommendations without changing active pointers.
- Added deterministic `turn_end` observation for explicit reusable lessons and structured `catui_evolution` JSON proposals.
- Added deterministic harness eval gating for automatic promotion; projects can provide declarative JSON corpora under `.catui/evolution/`, passing revisions persist gate reports, and failed gates leave candidates inactive with evidence.
- Added AgentStream-style harness stream scenarios (`isolated`, `sequential`, `interleaved`) so future gates can evaluate task-flow reliability beyond independent single-task fixtures.
- Added stream summaries to evolution gate reports so revisions and failed candidates preserve which stream mode produced the gate evidence.
- Added trace-derived `eval_fixture` proposal from validated local run trace JSONL files, including `tracePath: "latest"` discovery under workspace `.catui/traces/`; model tool proposals stay inactive, structured turn-end proposals may auto-promote only after current gate plus candidate fixture replay, and promoted fixtures join future automatic promotion gates without executing project code.
- Added bounded workspace trace sweep proposal so the model can mine recent `.catui/traces/*.jsonl` files into inactive `eval_fixture` candidates in one call; duplicate fixture content is skipped without failing the sweep.
- Added deterministic trace distillation for workspace trace sweeps: traces are clustered by completion/failure signature, summarized into compact root-cause evidence, and each candidate links to its evidence slice.
- Added per-scope `eval_fixture` content-hash dedupe across proposed/promoted candidates and revisions.
- Added active `eval_fixture` retention: the newest three promoted fixture artifacts remain active for future gates, older fixture ids are archived by pointer while immutable revisions remain intact.
- Added bounded global auto-promotion for low-risk `prompt_note`, `memory`, and declarative `tool_spec` artifacts with explicit applicability; global `tool_spec` artifacts also require explicit non-applicability; broader global artifacts remain inactive candidates.
- Added scoped `/refine status` and `/refine changes` views so users can inspect active state, revision rationale, added/changed/removed artifacts, attribution, and stream evidence without opening JSON ledgers.
- Default-enabled `evolution` through `builtin-extensions.ts` after product approval while keeping source under `extensions/optional/evolution/`; default loading is idle-neutral until candidates or promoted artifacts exist.
- Added focused tests for store safety, active revision quarantine, extension prompt consumption, evolved skill resource discovery, workflow spec validation/reuse, usage ledger recording and UX, usefulness feedback recording/redaction and UX, usefulness review summaries, prediction manifest persistence, post-hoc prediction attribution, stream-aware conservative auto-rollback, model-created artifacts, eval-gated promotion, project eval corpora, stream eval scenarios, stream-aware gate evidence, trace-derived and turn-end eval fixtures, bounded trace sweeps with distilled evidence, fixture dedupe, structured auto-observation, evolved tool reuse with input validation and structured plans, workspace executable tool validation/runtime, safe DSL transforms, scoped changes UX, and global promotion bounds.

## Deferred

- Richer fixture aging/compaction policies beyond active pointer retention and duplicate suppression.
- Richer project eval fixture formats beyond declarative recorded/observed trace JSON.
- Arbitrary executable generated skills, tools, extensions, or source patches.
- Unattended global promotion for `skill_manifest`, `subagent_spec`, executable artifacts, permission changes, network endpoints, package installs, or source patches.

## Reopen Conditions

- The extension needs new host capabilities beyond `ExtensionContext`.
- Default-loaded evolution stops being idle-neutral on unused startup.
- The restricted `executable_tool` interpreter expands beyond no-IO, in-memory, whitelist DSL transforms.
