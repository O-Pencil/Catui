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
- Added quarantine records for invalid active revisions so corrupted or tampered artifacts stop injecting and remain auditable.
- Added `before_agent_start` injection for promoted `prompt_note` and `memory` artifacts only.
- Added `evolution_refine` so the model can create declarative artifacts and auto-promote scoped artifacts without installing code.
- Added `evolved_tool` so promoted declarative `tool_spec` artifacts become reusable model-callable procedures without executable code; structured metadata can declare required inputs, ordered steps, and existing tool names, and invocation returns a non-executable plan.
- Added deterministic `turn_end` observation for explicit reusable lessons and structured `catui_evolution` JSON proposals.
- Added deterministic harness eval gating for automatic promotion; projects can provide declarative JSON corpora under `.catui/evolution/`, passing revisions persist gate reports, and failed gates leave candidates inactive with evidence.
- Added AgentStream-style harness stream scenarios (`isolated`, `sequential`, `interleaved`) so future gates can evaluate task-flow reliability beyond independent single-task fixtures.
- Added stream summaries to evolution gate reports so revisions and failed candidates preserve which stream mode produced the gate evidence.
- Added trace-derived `eval_fixture` proposal from validated local run trace JSONL files, including `tracePath: "latest"` discovery under workspace `.catui/traces/`; model tool proposals stay inactive, structured turn-end proposals may auto-promote only after current gate plus candidate fixture replay, and promoted fixtures join future automatic promotion gates without executing project code.
- Added bounded workspace trace sweep proposal so the model can mine recent `.catui/traces/*.jsonl` files into inactive `eval_fixture` candidates in one call; duplicate fixture content is skipped without failing the sweep.
- Added per-scope `eval_fixture` content-hash dedupe across proposed/promoted candidates and revisions.
- Added active `eval_fixture` retention: the newest three promoted fixture artifacts remain active for future gates, older fixture ids are archived by pointer while immutable revisions remain intact.
- Added bounded global auto-promotion for low-risk `prompt_note`, `memory`, and declarative `tool_spec` artifacts with explicit applicability; global `tool_spec` artifacts also require explicit non-applicability; broader global artifacts remain inactive candidates.
- Added focused tests for store safety, active revision quarantine, extension prompt consumption, prediction manifest persistence, post-hoc prediction attribution, conservative auto-rollback, model-created artifacts, eval-gated promotion, project eval corpora, stream eval scenarios, stream-aware gate evidence, trace-derived and turn-end eval fixtures, bounded trace sweeps, fixture dedupe, structured auto-observation, evolved tool reuse with input validation and structured plans, and global promotion bounds.

## Deferred

- Richer fixture aging/compaction policies beyond active pointer retention and duplicate suppression.
- Stream-aware rollback thresholds based on repeated falsified attributions across isolated/sequential/interleaved stream outcomes.
- Richer project eval fixture formats beyond declarative recorded/observed trace JSON.
- Executable generated skills, tools, extensions, or source patches.
- Unattended global promotion for `skill_manifest`, `subagent_spec`, executable artifacts, permission changes, network endpoints, package installs, or source patches.

## Reopen Conditions

- The extension needs new host capabilities beyond `ExtensionContext`.
- Any generated artifact becomes executable.
- Evolution becomes default-enabled.
