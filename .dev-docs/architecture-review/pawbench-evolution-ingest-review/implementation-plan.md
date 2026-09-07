# PawBench Evolution Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert byte-bound PawBench checkpoints into Catui evolution snapshots and deterministic failure-cohort reports without granting runtime execution authority.

**Architecture:** A private optional-evolution adapter validates PawBench checkpoint data and a complete trusted sidecar manifest, then returns the existing benchmark snapshot contract. A separate pure diagnosis module clusters sanitized grader/audit signals and hashes the report. An offline CLI performs private file IO and prints only compact verdicts.

**Tech Stack:** TypeScript strict mode, Node.js `crypto`/`fs`, `node:test`, existing evolution benchmark contracts.

---

### Task 1: Specify importer behavior with failing tests

**Files:**
- Create: `test/evolution-pawbench.test.ts`
- Create later: `extensions/optional/evolution/pawbench-import.ts`

- [ ] Add a valid PawBench checkpoint fixture and a complete manifest fixture with byte digest, frozen execution data, two held-out repetitions, exact result indexes, costs, and trace-audit counters.
- [ ] Assert `importPawBenchEvolutionSnapshot(sourceText, manifest)` returns a snapshot accepted by `parseBenchmarkSnapshot`, normalizes score and taxonomy slices, preserves repetition/split/cost/audit values, and retains only sanitized failing grader keys as diagnostics.
- [ ] Assert changed source bytes, duplicate/missing indexes, model mismatch, `anomaly.has_error`, absent cost, and absent audit counters throw descriptive errors.
- [ ] Run `node --test --import tsx test/evolution-pawbench.test.ts`; expect module-not-found failure for `pawbench-import.ts`.

### Task 2: Implement the fail-closed PawBench importer

**Files:**
- Create: `extensions/optional/evolution/pawbench-import.ts`
- Modify: `extensions/optional/evolution/benchmark-types.ts`
- Modify: `extensions/optional/evolution/benchmark-evidence.ts`

- [ ] Add optional bounded `diagnostics` to `EvolutionBenchmarkRunV1` and parse it with the same identifier restrictions as slices.
- [ ] Implement strict record, text, number, integer, boolean, list, SHA-256, checkpoint-result, manifest, exact-index mapping, and anomaly validation helpers.
- [ ] Derive score as `score / max_score`, success from PawBench `passed`, latency from seconds to milliseconds, slices from normalized taxonomy plus manifest additions, and diagnostics from failing breakdown keys plus timeout/execution status.
- [ ] Parse the generated value again through `parseBenchmarkSnapshot` before returning it.
- [ ] Run the focused importer tests; expect all importer cases to pass.

### Task 3: Specify and implement deterministic failure cohorts

**Files:**
- Modify: `test/evolution-pawbench.test.ts`
- Create: `extensions/optional/evolution/benchmark-diagnosis.ts`

- [ ] Add tests asserting only unsuccessful runs are clustered, one run may contribute multiple independent signals, cohort ordering and IDs remain stable after run reordering, and report hash verification fails after tampering.
- [ ] Run the focused test and confirm failure because diagnosis exports are missing.
- [ ] Implement canonical hashing, snapshot hashing, signal extraction, deterministic cohort grouping, bounded task identifiers, and `verifyEvolutionFailureCohortReport()`.
- [ ] Run the focused test and confirm all diagnosis cases pass.

### Task 4: Add a private offline CLI

**Files:**
- Modify: `test/evolution-pawbench.test.ts`
- Create: `scripts/evolution-pawbench.ts`
- Modify: `package.json`
- Modify: `extensions/optional/evolution/README.md`
- Modify: `extensions/optional/evolution/AGENT.md`

- [ ] Add red tests for `import` and `diagnose` commands, private `0600` output files, compact stdout, and incomplete arguments.
- [ ] Implement explicit subcommands with strict `parseArgs`, owner-only writes, no raw input logging, and exit codes `0` success / `2` invalid input.
- [ ] Register `eval:evolution-pawbench` and add the new test to `test:evolution`.
- [ ] Document the manifest trust boundary, commands, and deliberate refusal to infer missing promotion evidence.
- [ ] Run the focused test and `npm run test:evolution`.

### Task 5: Close the review and verify the repository

**Files:**
- Create: `.dev-docs/architecture-review/pawbench-evolution-ingest-review/closure.md`
- Modify: `.dev-docs/architecture-review/pawbench-evolution-ingest-review/README.md`

- [ ] Record delivered invariants, executed evidence, public API/token/performance review, and deferred boundaries; change review status to `closed` only after evidence is fresh.
- [ ] Run `npm run test:evolution`, `npm test`, `npm run verify:dip`, `npm run verify:quality`, `npm run verify:package-boundary`, `npm run build`, `npx tsc --noEmit`, and `git diff --check`.
- [ ] Review `git diff --stat`, `git diff`, and public export changes; confirm no runtime/model/network/process authority was added.
- [ ] Commit, push `hap-52-evidence-gated-evolution`, and update PR 13.
