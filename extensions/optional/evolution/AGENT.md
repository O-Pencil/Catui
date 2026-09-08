# extensions/optional/evolution/

> P2 | Parent: ../AGENT.md

Member List
source/: Independently configured source evolution sidecar, evidence-driven repair, verified automatic PR merge/release and managed version adoption
index.ts: Optional evolution extension entry, registers /refine status/inspect/changes/review/feedback/promote/reject/rollback, evolution_refine, evolved_tool, evolved_executable_tool, resources_discover skill path exposure, before_agent_start prompt injection, and turn_end observation
automation.ts: Earlier guarded automation policy, mode state, authorization reservation, and symlink safety helpers retained for compatibility tests
consumers.ts: Earlier promoted prompt/resource rendering helpers retained for compatibility with v1 active artifact consumers
evaluation.ts: Earlier candidate-vs-baseline session scenario evaluation helpers retained for compatibility checks
paths.ts: Earlier confined evolution/v1 scope path resolution and workspace hashing helpers
prompts.ts: Earlier bounded session evidence and refinement prompt builders
schema.ts: Earlier declarative proposal validation and untrusted-content safety rules covered by evolution-schema tests
store.ts: Earlier EvolutionStore read compatibility for immutable proposals/revisions; legacy promotion is fail-closed and disabled
types.ts: Earlier extension-local artifact, proposal, candidate, evidence, revision, and pointer contracts
workflow.ts: Earlier candidate state transition, scope merge, and validation evidence helpers
evolution-store.ts: Scope path resolution, candidate/revision/current/quarantine ledger IO, validation, active skill_manifest materialization, workflow_spec metadata validation, workspace executable_tool safe DSL manifest validation, usage and feedback records, prediction manifests, stream-aware post-hoc attribution records, conservative stream-threshold auto-rollback, eval_fixture content-hash dedupe and active-fixture retention, bounded global auto-promotion policy for prompt_note/memory/tool_spec, promotion, rejection, rollback
evolution-types.ts: Evolution artifact, workflow_spec, executable_tool, usage/feedback records, prediction/attribution, per-stream attribution, stream-aware gate report, eval_fixture, candidate, revision, current pointer, active fixture pointer, quarantine, and command result contracts
benchmark-types.ts: Versioned real-task snapshot, policy, metrics, checks, and candidate-bound promotion report contracts
benchmark-evidence.ts: Fail-closed unknown-input parsing plus frozen corpus/execution and exact held-out pair validation
pawbench-import.ts: Byte-bound PawBench checkpoint and attestation-manifest validation into sanitized benchmark snapshots
benchmark-diagnosis.ts: Deterministic sanitized failure-signal cohorts, canonical snapshot/report hashing, and fail-closed report integrity verification
benchmark-comparison.ts: Deterministic task-cluster bootstrap, slice/safety/cost/latency checks, canonical report hashing, and integrity verification
evolution-format.ts: Human-readable scoped status, revision changes, usefulness review, usage/feedback summaries, prediction/per-stream attribution inspection, command result, and prompt injection formatting
evolution-fixture.ts: Non-executable trace path discovery/resolution and eval_fixture content construction from validated workspace run trace JSONL
evolution-distillation.ts: Deterministic trace clustering and distilled evidence summary construction for workspace trace sweep candidates
evolution-gate.ts: Deterministic replay/safety adapter with stream summaries plus candidate-bound held-out benchmark report loading from .catui/evolution/benchmarks; pure eval_fixture candidates remain fixture-replay gated
evolution-refiner.ts: LLM proposal prompt, JSON extraction, prediction normalization, and candidate input normalization
evolution-refine-tool.ts: Model-callable evolution_refine tool for inactive declarative candidate creation, evidence-gated promotion attempts, workspace executable_tool proposals, trace-derived eval_fixture proposals, latest-trace discovery, and bounded trace sweeps
evolution-tool.ts: Controlled evolved_tool registration, lists promoted declarative tool_spec and workflow_spec artifacts, validates declared inputs, and returns structured non-executable plans/workflows for reuse
evolution-executable-tool.ts: Controlled evolved_executable_tool registration, lists workspace executable_tool artifacts, verifies approved content hash and no-IO permission manifests, and runs safe DSL transform steps in a restricted interpreter
evolution-auto.ts: Deterministic turn_end observer that converts explicit reusable-lesson markers and structured catui_evolution JSON into inactive behavioral candidates unless candidate-bound benchmark evidence exists; workspace eval_fixture proposals may activate only after current-gate plus candidate-fixture replay

Related offline boundary: `scripts/evolution-pawbench.ts` is not an extension member; it performs bounded no-follow regular-file reads and atomic private local-file writes, then delegates import and advisory diagnosis to `pawbench-import.ts` and `benchmark-diagnosis.ts` without adding runtime execution authority.

Rule: Declarative artifacts remain untrusted data. Source evolution uses a separately configured subprocess/verifier/delivery boundary; model workers cannot change that authority.

[COVENANT]: Update this file on member changes and verify against parent AGENT.md
