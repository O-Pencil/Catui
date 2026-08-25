# PE01 - PawBench Checkpoints Do Not Carry Promotion-Grade Provenance

## Evidence

- PawBench checkpoints contain task scores, labels, execution time, token usage, and anomaly summaries.
- They do not preserve a stable repetition index when concurrent runs finish out of order.
- They do not carry Catui policy-violation, replay-divergence, unpaired-tool-call, dollar-cost, candidate-content, or hidden-split attestations.
- Treating absent fields as zero would create a direct safety and evidence bypass.

## Decision

Require a versioned sidecar manifest produced by trusted benchmark orchestration. It binds the exact checkpoint bytes and supplies every field that PawBench cannot attest. The importer rejects partial mappings, inferred defaults, and anomaly-marked results.

## Reopen conditions

- PawBench publishes a stable, versioned per-run schema containing these provenance fields.
- A signed runner envelope replaces the local digest-and-manifest trust boundary.
- Non-PawBench producers need a shared adapter protocol rather than a private importer.
