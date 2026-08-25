# Evidence-Gated Evolution Gates

## Behavioral Gates

- [x] Snapshot parser rejects schema, corpus, execution-envelope, run, and numeric-bound violations.
- [x] Comparator requires exact held-out task/repetition pairing and three repetitions per task.
- [x] Comparator uses task-cluster bootstrap and emits deterministic, hash-bound reports.
- [x] Promotion fails on insufficient gain, non-positive lower bound, slice regression, safety events, cost regression, or latency regression.
- [x] Behavioral promotion fails closed when evidence is missing or tampered.
- [x] Pure `eval_fixture` promotion remains fixture/replay-gated.
- [x] Automatic and manual command paths surface inactive-with-reason rather than activating.

## Repository Gates

- [x] `npm run test:evolution-benchmark`
- [x] `npm run test:evolution`
- [x] `npm run verify:dip`
- [x] `npm run verify:quality`
- [x] `npm run verify:package-boundary`
- [x] `npm run build`
- [x] `npx tsc --noEmit`
- [x] `git diff --check`
