# Evidence-Gated Evolution Review

```yaml
status: closed
started_at: 2026-08-25
closed_at: 2026-08-25
decision: require paired held-out benchmark evidence for every behavioral evolution promotion
```

## Scope

This review adds a versioned external-run benchmark contract, a deterministic paired comparator, an offline report CLI, and fail-closed promotion integration. PawBench is the first producer, but Catui owns the evidence contract so another real-task benchmark can provide equivalent snapshots.

It does not yet run PawBench itself, generate candidate mutations, sign reports, schedule canaries, or change model weights.

## Ownership

| Concern | Owner | Reason |
|---|---|---|
| Snapshot/report contracts | `extensions/optional/evolution/` | Private evidence for one product capability |
| Statistical comparison | `extensions/optional/evolution/` | Promotion policy belongs beside the evolution gate |
| JSON conversion CLI | `scripts/` | Offline operator entrypoint, no runtime behavior |
| Final activation refusal | `evolution-store.ts` | All call paths converge at the store |

## Invariants

1. Baseline and candidate use identical corpus and execution envelopes.
2. Held-out runs pair exactly by task and repetition, with at least three repetitions per task.
3. Repetitions are aggregated per task before statistical resampling.
4. Behavioral artifacts cannot activate without a valid, passing, candidate-bound report.
5. Human approval cannot bypass effectiveness or safety evidence.
6. `eval_fixture` is verifier data, not a behavioral promotion, and remains replay-gated.

## Acceptance

See [EG01](./findings/EG01-real-effectiveness-authority.md) and [gates.md](./gates.md).
