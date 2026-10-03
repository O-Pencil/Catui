# SL03: Offline Closeout and Deferred Effectiveness Work

Status: offline implementation complete; provider effectiveness and dead-cluster removal remain deferred.
Parent: [proposal](../README.md). Siblings: [SL01](SL01-scope-and-evidence.md), [SL02](SL02-rollback-discovery.md).
Acceptance receipts: [closure](../closure.md).

The original audit correctly distinguished the live entry from test-only consumers/workflow/automation
modules. Its implementation status was subsequently superseded by the supervised development slices.
The following table records current behavior rather than treating the original recommendations as blockers.

| Finding | Current implementation | Acceptance |
| --- | --- | --- |
| A: outcome provenance | Structured declarations and prose lessons are classified; declared success alone grants no promotion authority | evolution-auto-provenance and no-lesson tests; real gate still required |
| B: existing-skill retrieval | Refiner retrieves scope-local existing skills with bounded prompt context | evolution-refiner-existing-skills tests |
| C: updates and budget | Existing artifacts can be overridden; maximum four logical artifact changes; reject rather than truncate | evolution-overrides and evolution-edit-budget tests |
| D: rejection feedback | Recent reasons and source versions are bounded, redacted and explicitly untrusted | evolution-rejection-feedback tests |
| E: budget and cursor | Inert observer, persisted session-bound cursor, reserve-before-model daily ledger and cross-process exclusive lock | default-off, evidence-cursor, model-budget and concurrent-budget tests |
| Rollback discovery | Withdrawn revisions leave discovery; unrelated historical skills remain | evolution-rollback-discovery tests |
| Baseline binding | Store captures active baseline; legacy records remain readable but cannot bypass an active revision | evolution-baseline-binding tests |
| Isolation and re-evaluation | Workspace roots do not share local candidates/revisions; a prior rejection does not permanently bar an idea | scope-and-stale-rejection and no-blacklist tests |

## Accepted boundaries

The edit budget counts logical artifacts, not arbitrary Markdown sections. Section-level accounting
would introduce an additional authoring contract and remains outside this pass. Skill bodies have a
write-only structural check; historical revisions remain readable.

The daily behavioral budget is separate from source evolution, shared across scopes of one agent
directory, and limits the existing explicit model call. The observer itself makes no model calls.
No daemon, timer, service activation or provider experiment was added. After a crash, an orphaned
budget lock refuses new reservations; manual removal requires all participating writers and waiters
to be quiescent. Automatic stale takeover was withdrawn after deterministic race reproduction.

## Deferred work and reopening conditions

- **Provider effectiveness (S09 / task streams):** collect frozen paired runs under an explicitly
  approved experiment budget. Offline fixtures demonstrate contract behavior only. No improvement,
  cheaper model usage or routing-quality claim follows from this merge.
- **Memory/working-note destination routing:** requires a classifier decision and evidence that it
  improves behavior without extra unintended calls. No second classifier was added.
- **Dead-cluster deletion:** review import consumers and compatibility before deleting historical
  modules and their tests. Their passing tests do not establish live-path coverage.
- **Presence greeting change:** the candidate remains gated; shipped greeting behavior is unchanged
  pending real user-path and quality evidence.

These are explicit scope boundaries, not failing local acceptance gates. Reopen when their evidence
or product decision exists; do not invent benchmark results or reduce statistical thresholds.
