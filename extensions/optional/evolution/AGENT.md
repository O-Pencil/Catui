# extensions/optional/evolution/

> P2 | Parent: ../AGENT.md

Member List
index.ts: Optional evolution extension entry, registers /refine status/inspect/changes/review/feedback/promote/reject/rollback, evolution_refine, evolved_tool, evolved_executable_tool, resources_discover skill path exposure, before_agent_start prompt injection, and turn_end observation
automation.ts: Earlier guarded automation policy, mode state, authorization reservation, and symlink safety helpers retained for compatibility tests
consumers.ts: Earlier promoted prompt/resource rendering helpers retained for compatibility with v1 active artifact consumers
evaluation.ts: Earlier candidate-vs-baseline session scenario evaluation helpers retained for compatibility checks
paths.ts: Earlier confined evolution/v1 scope path resolution and workspace hashing helpers
prompts.ts: Earlier bounded session evidence and refinement prompt builders
schema.ts: Earlier declarative proposal validation and untrusted-content safety rules covered by evolution-schema tests
store.ts: Earlier EvolutionStore class for immutable proposal/revision persistence and rollback compatibility
types.ts: Earlier extension-local artifact, proposal, candidate, evidence, revision, and pointer contracts
workflow.ts: Earlier candidate state transition, scope merge, and validation evidence helpers
evolution-store.ts: Scope path resolution, candidate/revision/current/quarantine ledger IO, validation, active skill_manifest materialization, workflow_spec metadata validation, workspace executable_tool safe DSL manifest validation, usage and feedback records, prediction manifests, stream-aware post-hoc attribution records, conservative stream-threshold auto-rollback, eval_fixture content-hash dedupe and active-fixture retention, bounded global auto-promotion policy for prompt_note/memory/tool_spec, promotion, rejection, rollback
evolution-types.ts: Evolution artifact, workflow_spec, executable_tool, usage/feedback records, prediction/attribution, per-stream attribution, stream-aware gate report, eval_fixture, candidate, revision, current pointer, active fixture pointer, quarantine, and command result contracts
evolution-format.ts: Human-readable scoped status, revision changes, usefulness review, usage/feedback summaries, prediction/per-stream attribution inspection, command result, and prompt injection formatting
evolution-fixture.ts: Non-executable trace path discovery/resolution and eval_fixture content construction from validated workspace run trace JSONL
evolution-distillation.ts: Deterministic trace clustering and distilled evidence summary construction for workspace trace sweep candidates
evolution-gate.ts: Deterministic harness eval adapter for auto-promotion gate reports with stream summaries; reads project JSON corpora from .catui/evolution/ when present, then active eval_fixture artifacts with id dedupe, otherwise built-in fixtures; validates candidate eval_fixture artifacts before auto-promotion
evolution-refiner.ts: LLM proposal prompt, JSON extraction, prediction normalization, and candidate input normalization
evolution-refine-tool.ts: Autonomous model-callable evolution_refine tool for session/workspace declarative artifact creation/promotion, inactive workspace executable_tool proposal, trace-derived eval_fixture proposal from explicit trace paths, workspace .catui/traces/latest discovery, and bounded workspace trace sweeps, low-risk global prompt_note/memory and bounded tool_spec auto-promotion, and gated global candidate proposal
evolution-tool.ts: Controlled evolved_tool registration, lists promoted declarative tool_spec and workflow_spec artifacts, validates declared inputs, and returns structured non-executable plans/workflows for reuse
evolution-executable-tool.ts: Controlled evolved_executable_tool registration, lists workspace executable_tool artifacts, verifies approved content hash and no-IO permission manifests, and runs safe DSL transform steps in a restricted interpreter
evolution-auto.ts: Deterministic turn_end observer that converts explicit reusable-lesson markers and structured catui_evolution JSON proposals into candidates; session/workspace proposals may auto-promote, low-risk global prompt_note/memory and bounded tool_spec may auto-promote, workspace eval_fixture proposals may auto-promote only after current gate plus candidate fixture replay, broader global artifacts remain approval-gated

Rule: Generated artifacts are untrusted data; no executable artifact is activated by this extension.

[COVENANT]: Update this file on member changes and verify against parent AGENT.md
