# Evidence-Gated Evolution Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require reproducible paired held-out benchmark evidence before any behavioral Catui evolution candidate can be promoted.

**Architecture:** Keep the evidence contract, statistical comparator, and promotion policy private to `extensions/optional/evolution`. PawBench or another trusted runner emits versioned baseline/candidate snapshots; a thin offline CLI creates a candidate-bound report; the existing evolution gate verifies safety plus benchmark evidence; the store remains the final fail-closed activation boundary.

**Tech Stack:** TypeScript strict mode, Node.js test runner, Node crypto/fs, existing Catui evolution extension and scripts.

---

### Task 1: Define and Validate Versioned Benchmark Snapshots

**Files:**
- Create: `extensions/optional/evolution/benchmark-types.ts`
- Create: `extensions/optional/evolution/benchmark-evidence.ts`
- Create: `test/evolution-benchmark.test.ts`
- Modify: `extensions/optional/evolution/AGENT.md`

- [x] **Step 1: Write failing snapshot-validation tests**

Add fixtures for matching baseline/candidate snapshots and assertions that validation rejects unsupported schema versions, invalid numeric ranges, duplicate `(taskId,repetition)` keys, fewer than three held-out repetitions, corpus mismatch, and execution-envelope mismatch.

```ts
test("rejects candidate snapshots that change the frozen model or budget", () => {
  const baseline = snapshot("baseline");
  const candidate = snapshot("candidate", { execution: { ...baseline.execution, model: "other" } });
  assert.throws(() => validateBenchmarkPair(baseline, candidate, "candidate-a"), /execution envelope/i);
});
```

- [x] **Step 2: Run the focused test and confirm it fails**

Run: `node --test --import tsx test/evolution-benchmark.test.ts`

Expected: FAIL because `benchmark-evidence.ts` does not exist.

- [x] **Step 3: Add narrow extension-local contracts**

Define `EvolutionBenchmarkSnapshotV1`, `EvolutionBenchmarkRunV1`, `EvolutionBenchmarkPolicyV1`, `EvolutionBenchmarkPromotionReportV1`, metric/check types, and the `baseline | candidate` role. Required run fields are `taskId`, `repetition`, `split`, `slices`, `success`, `score`, `costUsd`, `latencyMs`, `policyViolations`, `replayDivergences`, and `unpairedToolCalls`.

```ts
export interface EvolutionBenchmarkRunV1 {
  taskId: string;
  repetition: number;
  split: "train" | "validation" | "heldout";
  slices: string[];
  success: boolean;
  score: number;
  costUsd: number;
  latencyMs: number;
  policyViolations: number;
  replayDivergences: number;
  unpairedToolCalls: number;
}
```

- [x] **Step 4: Implement fail-closed parsing and pair validation**

`parseBenchmarkSnapshot()` must construct normalized data from `unknown`; do not cast unvalidated JSON. `validateBenchmarkPair()` must enforce candidate id, identical corpus and execution envelopes, exact held-out keys, and at least the policy minimum repetitions for each held-out task.

- [x] **Step 5: Run focused tests**

Run: `node --test --import tsx test/evolution-benchmark.test.ts`

Expected: all snapshot validation tests pass.

### Task 2: Build Deterministic Paired Statistical Comparison

**Files:**
- Create: `extensions/optional/evolution/benchmark-comparison.ts`
- Modify: `test/evolution-benchmark.test.ts`

- [x] **Step 1: Add failing comparison tests**

Cover a clearly superior candidate, insufficient 5-point gain, a 95% lower bound at or below zero, one slice below `-0.02`, each safety counter, cost-per-success above `+10%`, P95 latency above `+15%`, deterministic output, and report hash tampering.

```ts
const report = compareEvolutionBenchmarks(baseline, candidate, DEFAULT_EVOLUTION_BENCHMARK_POLICY, {
  candidateId: "candidate-a",
  checkedAt: "2026-08-25T00:00:00.000Z",
});
assert.equal(report.passed, true);
assert.ok(report.metrics.passRateGain >= 0.05);
assert.ok(report.metrics.confidenceLowerBound > 0);
assert.equal(verifyEvolutionBenchmarkReport(report, "candidate-a"), true);
```

- [x] **Step 2: Run tests and confirm statistical cases fail**

Run: `node --test --import tsx test/evolution-benchmark.test.ts`

Expected: FAIL because comparison functions are missing.

- [x] **Step 3: Implement task-level aggregation and deterministic bootstrap**

Average repetitions within each held-out task. Bootstrap task deltas, sampling tasks with replacement for 10,000 iterations. Seed the PRNG from `sha256(corpus.digest + candidateId)`. Use the lower percentile at `(1 - confidenceLevel)`; never resample individual repetitions.

- [x] **Step 4: Implement operational and slice metrics**

Calculate baseline/candidate pass rate, pass-rate gain, lower confidence bound, per-slice task-level deltas, total safety counts, cost per successful run, and P95 latency.

- [x] **Step 5: Emit named checks and an integrity hash**

Every policy condition becomes a check with `id`, `passed`, `actual`, `threshold`, and `summary`. `report.passed` is `checks.every(check => check.passed)`. Hash canonical report content without `contentHash`; `verifyEvolutionBenchmarkReport()` recomputes it and checks the candidate id.

- [x] **Step 6: Run focused tests**

Run: `node --test --import tsx test/evolution-benchmark.test.ts`

Expected: all comparison, determinism, and tamper tests pass.

### Task 3: Add a Reproducible Offline Evidence CLI

**Files:**
- Create: `scripts/evolution-benchmark.ts`
- Modify: `package.json`
- Modify: `test/evolution-benchmark.test.ts`

- [x] **Step 1: Add failing CLI argument and output tests**

Extract `runEvolutionBenchmarkCli(args, io)` for in-process tests. Require `--baseline`, `--candidate`, `--candidate-id`, and `--output`. Confirm the command writes a report for both pass and fail, returns exit code `0` only for pass, and never echoes snapshot contents.

- [x] **Step 2: Implement the thin CLI**

Read both JSON files, parse and compare with the default policy, create the output directory, write formatted JSON with mode `0600`, print a one-line verdict and failed check ids, and set `process.exitCode` without throwing after a valid failed comparison.

- [x] **Step 3: Register scripts**

```json
"eval:evolution-benchmark": "node --import tsx scripts/evolution-benchmark.ts",
"test:evolution-benchmark": "node --test --import tsx test/evolution-benchmark.test.ts"
```

- [x] **Step 4: Run CLI tests and a fixture smoke**

Run: `npm run test:evolution-benchmark`

Expected: all tests pass and the smoke report is byte-for-byte reproducible for fixed inputs/time.

### Task 4: Enforce Evidence at Every Behavioral Promotion Boundary

**Files:**
- Modify: `extensions/optional/evolution/evolution-types.ts`
- Modify: `extensions/optional/evolution/evolution-gate.ts`
- Modify: `extensions/optional/evolution/evolution-store.ts`
- Modify: `extensions/optional/evolution/index.ts`
- Modify: `extensions/optional/evolution/evolution-auto.ts`
- Modify: `extensions/optional/evolution/evolution-refine-tool.ts`
- Create: `test/evolution-benchmark-promotion.test.ts`
- Modify: existing evolution tests whose fixtures intentionally promote behavioral candidates

- [x] **Step 1: Write failing store-boundary tests**

Prove that prompt/memory/skill/subagent/tool/workflow/executable candidates reject promotion with no report, a failed report, a mismatched candidate report, or a tampered report. Prove that a passing report permits promotion and a pure `eval_fixture` candidate remains eligible with its existing replay gate.

```ts
assert.throws(
  () => promoteEvolutionCandidate(root, candidate.id, { approvedBy: "user" }),
  /passing held-out benchmark evidence/i,
);
```

- [x] **Step 2: Extend gate reports without breaking safety metrics**

Add optional `benchmark?: EvolutionBenchmarkPromotionReportV1` to `EvolutionGateReport`. `runEvolutionGate()` loads `.catui/evolution/benchmarks/<candidate-id>.json`, verifies hash and binding, then combines it with existing safety evaluation. A behavioral candidate fails with an explicit expected path when evidence is absent. A pure `eval_fixture` candidate skips effectiveness evidence.

- [x] **Step 3: Make the store the final authority**

Add `requiresBenchmarkEvidence(candidate)` and enforce it inside `promoteEvolutionCandidate()` for every behavioral artifact, regardless of `approvedBy`. Require `gateReport.passed`, `gateReport.benchmark.passed`, valid integrity, and matching candidate id.

- [x] **Step 4: Route all command and automatic paths through the gate**

Remove the executable-only gate behavior. Manual `/refine promote`, planned activation, `evolution_refine autoPromote`, structured turn-end proposals, and reusable-lesson promotion must run the gate and leave candidates inactive when evidence is missing or failed.

- [x] **Step 5: Run promotion and existing evolution suites**

Run: `node --test --import tsx test/evolution-benchmark-promotion.test.ts test/evolution-automation.test.ts test/evolution-extension.test.ts test/evolution-runtime-capabilities.test.ts test/evolution-schema.test.ts test/evolution-store.test.ts test/evolution-workflow.test.ts`

Expected: all tests pass; no behavioral test fixture bypasses the store.

### Task 5: Document PawBench Production and Close Repository Gates

**Files:**
- Modify: `extensions/optional/evolution/README.md`
- Modify: `extensions/optional/evolution/AGENT.md`
- Modify: `.dev-docs/architecture-review/README.md`
- Modify: `.dev-docs/architecture-review/evidence-gated-evolution-review/gates.md`
- Create: `.dev-docs/architecture-review/evidence-gated-evolution-review/closure.md`

- [x] **Step 1: Document the snapshot workflow**

Show PawBench adapters producing baseline and candidate snapshots from the same frozen 150-task corpus, three repetitions, fixed model/provider limits, and a concealed held-out split. Show the exact CLI output path expected by `/refine promote`.

- [x] **Step 2: Document anti-gaming and limitations**

State that verifier/grader edits, task-name specialization, timeout inflation, best-of-N selection, and budget changes invalidate evidence. Record that this slice imports results but does not yet orchestrate or sign PawBench runs.

- [x] **Step 3: Update DIP maps and review index**

Add new extension members to `AGENT.md` and the active review to the architecture-review index. Ensure every source file has a correct P3 header.

- [x] **Step 4: Run focused and mandatory gates**

Run `npm run test:evolution-benchmark`, `npm run test:evolution`, `npm run verify:dip`, `npm run verify:quality`, `npm run verify:package-boundary`, `npm run build`, `npx tsc --noEmit`, and `git diff --check`.

Expected: every command exits `0`.

- [x] **Step 5: Record executed evidence and close the review**

Replace review checkboxes with exact counts/results, record public API and token/performance review, and set review status to `closed` only after all gates pass.

- [x] **Step 6: Commit only HAP-52 files**

Stage the new benchmark, promotion, test, script, spec, plan, and review files explicitly. Commit with `feat(evolution): require held-out benchmark evidence`. Confirm the commit contains no files from the dirty main worktree.
