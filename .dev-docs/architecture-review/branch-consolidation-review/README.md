# Branch Consolidation Review

status: local integration accepted; remote CI required before merge
owner: extensions/optional/evolution/

## Intent and placement

Retain useful outstanding work on main through a reviewed pull request. The two
remaining feature slices share the evolution extension owner: verified recursive
source delivery and HAP-52 held-out behavioral evidence. Existing dedicated
reviews define their boundaries; no new core ownership or public API is added.

## Branch decisions

| Branch or worktree | Decision and evidence |
|---|---|
| feat/default-context-continuity | Already merged in PR #14; retain main's implementation. |
| feat/recursive-source-evolution-delivery | Integrate final source implementation and review fixes from 68e9739. |
| feat/recursive-source-evolution | Earlier uncommitted copies are superseded by context PR #14 and the delivery snapshot. Preserve the original worktree. |
| hap-52-evidence-gated-evolution | Integrate PR #13: candidate-bound held-out benchmarks, private PawBench ingestion and failure diagnosis. |
| cunyu6666/simplify-impl | Main already contains modular simplify, caching/concurrency and dependency-ordered builds with updated imports. |
| feat/diagnosis-and-arch-handbook | Main already contains the handbook and command/LLM/hook telemetry under current owners. |
| experiment/sal-ab-comparison | Both production fixes already exist: path overlap scoring and optional provider keys. Historical experiments contain large raw logs and obsolete paths; retain on the experiment branch. |
| v1.0 | Main already contains initializer sanitization and the characterization harness. |
| agent/diagnosis, agent/diagnosis-reviews | Only skipped/no-op operational reports; retain on their reporting branches. |
| reasonix delivery worktree | No unique commits; only local desktop metadata is untracked. |

All other fetched remote branch patches are already represented on main. Runtime
trace files, desktop metadata and dependency directories are excluded. No source
worktree is reset or deleted.

## Compatibility and acceptance

Context continuity remains enabled by default. Recursive source automation still
requires explicit source configuration. Behavioral declarative promotion now
requires held-out evidence; missing evidence cannot be manually overridden. The
offline comparator adds no model calls. The source daemon's configured worker
limits and model costs remain explicit in its own review.

Validate both slices together with all five repository gates, dist boundaries,
137 evolution benchmark/store/CLI tests, source containment/reproduction tests,
critical harness and context regressions. The PR must pass remote CI before
merge. Publication and service activation are outside this consolidation.
