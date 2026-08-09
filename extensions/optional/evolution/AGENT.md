# extensions/optional/evolution/

> P2 | Parent: ../AGENT.md

Member List
index.ts: Optional evolution extension entry, registers /refine, evolution_refine, evolved_tool, before_agent_start prompt injection, and turn_end observation
evolution-store.ts: Scope path resolution, candidate/revision/current/quarantine ledger IO, validation, prediction manifests, post-hoc attribution records, conservative auto-rollback, eval_fixture content-hash dedupe and active-fixture retention, bounded global auto-promotion policy for prompt_note/memory/tool_spec, promotion, rejection, rollback
evolution-types.ts: Evolution artifact, prediction/attribution, stream-aware gate report, eval_fixture, candidate, revision, current pointer, active fixture pointer, quarantine, and command result contracts
evolution-format.ts: Human-readable status, prediction/attribution inspection, command result, and prompt injection formatting
evolution-fixture.ts: Non-executable trace path discovery/resolution and eval_fixture content construction from validated workspace run trace JSONL
evolution-gate.ts: Deterministic harness eval adapter for auto-promotion gate reports with stream summaries; reads project JSON corpora from .catui/evolution/ when present, then active eval_fixture artifacts with id dedupe, otherwise built-in fixtures; validates candidate eval_fixture artifacts before auto-promotion
evolution-refiner.ts: LLM proposal prompt, JSON extraction, prediction normalization, and candidate input normalization
evolution-refine-tool.ts: Autonomous model-callable evolution_refine tool for session/workspace declarative artifact creation/promotion, trace-derived eval_fixture proposal from explicit trace paths, workspace .catui/traces/latest discovery, and bounded workspace trace sweeps, low-risk global prompt_note/memory and bounded tool_spec auto-promotion, and gated global candidate proposal
evolution-tool.ts: Controlled evolved_tool registration, lists promoted declarative tool_spec artifacts, validates declared inputs, and returns structured non-executable plans for reuse
evolution-auto.ts: Deterministic turn_end observer that converts explicit reusable-lesson markers and structured catui_evolution JSON proposals into candidates; session/workspace proposals may auto-promote, low-risk global prompt_note/memory and bounded tool_spec may auto-promote, workspace eval_fixture proposals may auto-promote only after current gate plus candidate fixture replay, broader global artifacts remain approval-gated

Rule: Generated artifacts are untrusted data; no executable artifact is activated by this extension.

[COVENANT]: Update this file on member changes and verify against parent AGENT.md
