# Evidence-Gated Evolution Benchmark Design

## Objective

Make behavioral Catui evolution promotion depend on reproducible, paired, held-out evidence rather than synthetic replay or model judgment. A candidate may become active only when the same frozen model, corpus, limits, and repetitions show a statistically credible task-success improvement without safety, slice, cost, or latency regressions.

This is the first closed-loop slice of the broader Catui Harness goal. It consumes real task results from PawBench or another adapter; later slices automate task execution, failure clustering, candidate mutation, canary observation, and rollback.

## Evidence Boundary

The benchmark producer writes two versioned snapshots: champion baseline and inactive candidate. Both snapshots must name the same corpus id/version/digest and the same execution envelope: model id/version, temperature, token limit, timeout, and total budget. The candidate snapshot also carries the immutable candidate artifact content hash shown by `/refine inspect`. Runs are paired by held-out task id and repetition.

Each run records:

- task id, repetition, split, and diagnostic slices;
- binary success and normalized score;
- cost and latency;
- policy violations, replay divergences, and unpaired tool calls.

The Catui comparator validates the snapshots, rejects mismatched or incomplete pairs, aggregates repetitions per task, and emits an immutable promotion report tied to both candidate id and artifact content hash. The store recomputes that artifact hash before promotion. The comparator never receives prompts, expected answers, grader code, or secrets.

## Statistical Decision

Promotion uses held-out tasks only. The default gate requires:

- at least three paired repetitions for every held-out task;
- candidate pass-rate gain of at least 0.05;
- a deterministic task-cluster bootstrap 95% lower confidence bound above zero;
- no diagnostic slice regression worse than 0.02;
- zero candidate policy violations, replay divergences, and unpaired tool calls;
- cost per success no more than 10% above baseline;
- P95 latency no more than 15% above baseline.

Bootstrap sampling operates over tasks, not individual repetitions, so repeated trials do not masquerade as independent tasks. A deterministic seed derived from the corpus digest and candidate id makes the report reproducible.

## Ownership and Data Flow

`extensions/optional/evolution/benchmark-types.ts` owns the extension-local evidence contracts. `benchmark-comparison.ts` owns validation, pairing, statistics, checks, and report integrity. `scripts/evolution-benchmark.ts` is a thin offline CLI that converts two snapshots into `.catui/evolution/benchmarks/<candidate-id>.json`.

`evolution-gate.ts` first executes the existing replay/safety corpus, then loads and verifies candidate benchmark evidence. `evolution-store.ts` is the final fail-closed boundary: every candidate containing a behavioral artifact requires a passing benchmark report. Pure `eval_fixture` candidates remain non-behavioral verifier assets and continue to require their fixture/replay validation instead.

Manual approval cannot override missing or failed behavioral benchmark evidence. Missing evidence leaves the candidate inactive and explains the expected report path.

## Compatibility and Safety

- No public package or `catui-protocol` type changes.
- No provider or network call is added.
- Existing candidates remain readable; they simply cannot be promoted without evidence.
- Benchmark reports contain aggregate evidence and run metadata, never raw prompts or credentials.
- Candidate code cannot edit the held-out corpus or comparator through this feature; benchmark execution must occur from a trusted checkout/container. A later slice will add signed provenance and automated PawBench orchestration.

## Acceptance

Unit tests must prove valid promotion, each independent gate failure, mismatched execution/corpus rejection, missing pairs/repetitions rejection, deterministic reports, tamper detection, missing-evidence promotion rejection, and the `eval_fixture` exception. Repository DIP, quality, package-boundary, build, and TypeScript gates must pass.
