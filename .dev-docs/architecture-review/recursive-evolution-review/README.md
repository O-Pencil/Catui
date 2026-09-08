# Recursive Source Evolution Review

status: implemented; release and deployment acceptance tracked in closure.md
owner: extensions/optional/evolution/source/
parent: ../self-evolution-review/README.md

## Intent and authority

Observe actual Catui use, reproduce repeated defects or inefficiencies, repair
source in isolation, deliver daily PRs, merge and publish verified changes, adopt
the package, then measure subsequent use. The product owner explicitly requested
autonomous merge, release and adoption on 2026-09-08. No per-PR human gate is added;
existing repository protection rules and registry authentication remain binding.

## Evidence behind the design

The previous declarative evolution gate does not execute a source candidate.
At intake, `evolution-fixture.ts` replayed recorded events and `evolution-gate.ts`
did not use its candidate parameter. HAP-52 now adds candidate-bound held-out
evidence for declarative promotion. Reflection alone cannot establish that a source change
fixes a defect. See findings/RE01-candidate-verification.md. Finalized trace files
also cannot provide live observation during a task.

The implementation adds live extension events and an independent daemon. A frozen
executable test must fail with an assertion on the baseline and pass on the
candidate. An independent read-only model review and repository gates follow.
Merge and tests are delivery evidence, not proof of improved real-world behavior.
Later matching observations provide that separate evidence.

## Placement and dependencies

This user-facing capability belongs to the existing evolution extension, not core
or a publishable library. Feature-local types stay in source/types.ts; no public
protocol contract or SDK export is added. Runtime adapters own config, spool,
state, processes, service and lifecycle. Delivery adapters own worker, policy,
verification, GitHub, publication and adoption. Root CLI only dispatches commands
and managed launches. Workers consume public model/config/tool facades and the
existing agent library. No cross-extension imports are introduced.

The default extension catalog declares the conditional external process. Without
source configuration, the bridge records no events and starts no workers. Enabled
operation intentionally consumes model calls within explicit worker/time limits.

## Implemented lifecycle

`queued -> prepared -> verified -> submitted -> merged -> published -> adopted`

Post-adoption observations classify effective or regressed; rejected findings and
exhausted repair attempts terminate separately. Durable state, exclusive leases,
reserved budgets and remote identity reconciliation support restart. Upstream
changes invalidate the baseline; failed CI feeds a bounded repair retry.

- Events are bounded, redacted local task/tool/result/usage summaries. A separate
  process ingests them while foreground work continues. Repeated evidence requires
  at least two distinct runs. Selection includes successful cohort observations.
- Reproducer and repair workers have different file authority, no shell and no
  GitHub/npm credentials. A frozen test cannot be rewritten by the repairer.
- Verification uses offline macOS Seatbelt or Linux bubblewrap, failing closed if
  unavailable. Workers cannot change existing tests, dependencies, CI, migrations
  or source-evolution acceptance authority. Generated changes follow DIP.
- PR merge requires the exact tested head, current base, independent review and
  configured successful CI checks. No admin bypass is used.
- The coordinator reserves a patch version in the PR, verifies merged source,
  packages once, records SHA-512 integrity and reconciles npm before publishing.
- Adoption checks registry/install integrity plus CLI and SDK smoke tests. An
  atomic managed pointer affects new launches; running sessions remain pinned.
  Adopted Catui versions execute subsequent repair workers, closing recursion.
- Matching model/workspace/tool/version cohorts are measured after adoption.
  Regression restores the prior pointer; new-version findings feed later cycles.

## Operating contract and limits

Defaults are O-Pencil/Catui main, 03:00 Asia/Shanghai, one new job and eight worker
invocations per day, each at most 24 turns, 72 tool calls and ten minutes. These
are worker/time limits, not token or monetary caps. Sleeping hosts catch up after
wake. A login service supports macOS and Linux; Windows is not implemented.

Only source-only stable patch releases are accepted. Dependency/schema changes
and verifier rewrites need a separate path. User corrections and tool inefficiency
are heuristics; triage may reject them. Statistical outcomes are observational,
not causal proof or model-weight training. Local logs/checkouts are retained for
audit; long-term retention management is an operational follow-up.

## Acceptance

See closure.md for actual test and deployment status. Five repository gates,
critical harness tests, native containment, actual baseline/candidate execution,
publication retry and managed installation tests are required. Mocked remote
adapter tests are not evidence of a live GitHub/npm deployment.
