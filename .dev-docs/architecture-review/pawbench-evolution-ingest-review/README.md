# PawBench Evolution Ingest Review

```yaml
status: active
started_at: 2026-08-26
issue: HAP-52
decision: import exact PawBench result bytes through an explicit attestation manifest, then cluster sanitized failure signals offline
```

## Intent

Turn real PawBench checkpoints into Catui's versioned evolution snapshot without trusting implicit defaults or executing the benchmark from the runtime. The same offline boundary produces deterministic failure cohorts that can guide the next candidate, while promotion continues to depend only on the existing held-out comparator and store gate.

## Considered approaches

1. **Invoke PawBench directly from the evolution extension.** Rejected because it adds arbitrary process, Docker, credential, and model-spend authority to runtime code.
2. **Infer missing repetitions, costs, splits, and trace audits from current PawBench JSON.** Rejected because concurrency can reorder results and absent safety evidence would silently become zero.
3. **Require a byte-bound import manifest (chosen).** A trusted runner supplies exact result indexes, repetitions, splits, costs, and trace-audit counts. Catui verifies the source byte digest, consumes PawBench-owned scores/labels, and fails closed on incomplete or anomalous input.

## Ownership and data flow

`scripts/evolution-pawbench.ts` reads two explicit local JSON files. `pawbench-import.ts` owns untrusted PawBench and manifest parsing and returns the existing `EvolutionBenchmarkSnapshotV1`. `benchmark-diagnosis.ts` consumes only a validated snapshot and emits a content-hashed report of sanitized diagnostic cohorts. Neither module imports runtime internals, performs network requests, launches processes, or activates candidates.

```text
PawBench checkpoint bytes + trusted import manifest
                    |
                    v
          fail-closed offline importer
                    |
                    +--> benchmark snapshot --> existing paired held-out gate
                    |
                    `--> failure cohort report --> later candidate planning
```

## Invariants

1. The manifest binds the exact source bytes with SHA-256 and maps every result index exactly once.
2. Role, candidate identity, corpus, harness revision, frozen execution envelope, repetition, split, cost, and trace-audit counts are explicit; missing evidence is never defaulted to zero.
3. PawBench anomalies marked `has_error` invalidate the import instead of becoming benchmark failures.
4. Only normalized labels and failing grader keys enter snapshots; prompts, notes, transcripts, artifacts, and credentials are excluded.
5. Diagnosis is deterministic and advisory. It cannot authorize promotion or mutate candidate content.
6. This slice adds no model calls and spends no benchmark budget by itself.

## Acceptance

- Valid official-style PawBench checkpoint plus a complete attestation manifest imports to a parseable evolution snapshot.
- Byte tampering, incomplete result mapping, model mismatch, anomaly evidence, missing cost, and missing safety audit fail closed.
- Failure cohorts are stable across input order, bind the snapshot hash, and expose only normalized diagnostic identifiers.
- Existing promotion tests and repository architecture gates remain green.

## Deferred

PawBench process orchestration, hidden split custody, signed provenance, candidate mutation, canary scheduling, and automatic rollback orchestration remain later HAP-52 slices.
