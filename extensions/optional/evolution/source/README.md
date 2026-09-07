# Recursive Source Evolution

Source evolution runs separately from interactive tasks. It consumes sanitized
live task/tool/outcome observations, groups repeated failures, reproduces a Catui
defect, repairs production code, and submits a verified PR. Configured CI checks
and an independent reviewer gate automatic merge, npm publication, GitHub release
and managed version adoption. Subsequent comparable usage measures outcomes and
rolls back a regressing managed version. New-version failures feed the next cycle.

## Setup

Requirements: Git, GitHub CLI authenticated for repository push/merge/release,
npm credentials allowing unattended publication, and an existing Catui model.
Generated tests and candidate verification run offline under macOS `sandbox-exec`
or Linux `bubblewrap` (`bwrap`). Missing isolation fails verification, never falls
back to unconstrained execution. Repository protection rules remain in force;
automatic delivery does not use admin bypass or fabricate reviewer approval.

```sh
catui evolve init --model custom-anthropic/MiniMax-M3 --review-model dashscope-coding/qwen3.7-plus
catui evolve install-service
catui evolve status
```

Existing installations configure the independent reviewer with
`catui evolve configure --review-model dashscope-coding/qwen3.7-plus`.
This is Ali Coding Plan, using `https://coding.dashscope.aliyuncs.com/v1` and
the existing provider credentials in the agent configuration. Repair and review
must use different model identities. A missing/unavailable reviewer blocks new
repair acceptance; there is no fallback to the repairing model.

Daily retrospectives evaluate up to 12 completed tasks, including apparently
successful tasks, for observable incompleteness, verification gaps, maintainability,
scope drift and inefficiency. Each issue requires citations from the same run.
An explicit clean audit supplies a denominator; an unaudited task is unknown.
Summaries are truncated, so these audits cannot establish unseen code quality.
The audit consumes one of the daily worker invocations; a repair needs at least
five more (triage, reproduction, hidden tests, repair and final review).

`start` detaches a supervisor and normal configured Catui sessions reconnect to it.
`install-service` also starts the daemon on macOS/Linux user login. A sleeping or
powered-off computer cannot run tasks; one overdue daily batch is reconciled when
it wakes. Run `catui evolve daemon` under another service manager if preferred.

Configuration is private JSON at `<agentDir>/evolution/source/config.json`.
Default policy: `O-Pencil/Catui`, `main`, `catui-agent`, daily at 03:00 Asia/Shanghai,
automatic merge/publication/adoption enabled, one new repair job per local day,
eight worker invocations per day, each bounded to 24 assistant turns, 72 tool calls
and ten minutes. This is a worker/time budget, **not a dollar or token cap**.
Each invocation is durably reserved before launch, including failed calls.

The supervisor observes continuously and delivers only qualified findings in the
daily window. Two distinct runs with repeated failures or inefficiencies are required. A day with no reproducible
Catui defect produces no PR. External service failures and project-specific bugs
are rejected during triage. Existing submitted jobs reconcile independently of
the daily creation window.

## Verification and recursive authority

The reproducer can write only its assigned new test. The repair worker can modify
source and documentation but cannot rewrite existing tests, dependency manifests,
CI, release scripts, or source-evolution control code. It has scoped file tools,
no shell, no product extensions, and no GitHub/npm credentials in its environment.
The independent read-only reviewer checks the test and patch against the finding.

Before repair, the reviewer writes private tests in a separate baseline clone:
a generalization test that must fail with an assertion and a compatibility test
that must already pass. The repairer never receives these files. Both are frozen,
OS-protected against writes, and must pass against the candidate and merged source.
A hidden-test failure rejects the candidate without disclosing test details to the
repairer. This reduces overfitting but does not prove exhaustive correctness.

`catui evolve configure --scope adaptive` also allows changes to exactly
`learning/detectors.ts` and `learning/repair-strategy.ts`. These let usage improve
task detection and repair methods. Audit, statistics, verification, budget,
publication and configuration authority remain protected.

The frozen test must fail on the baseline with an assertion, then pass unchanged
on the candidate. Existing DIP, quality, package boundary, build, type and critical
harness gates also run. Verification executes without network access and cannot
write outside the isolated checkout and verification temporary directory.

The coordinator bumps the patch version before final verification. It publishes
only the exact tested PR head, requires configured successful checks, and matches
the head when merging. If upstream moves, it rebuilds the candidate and repeats
verification; revision attempts are bounded. Required human reviews imposed by
GitHub remain pending until the repository policy is satisfied.

After merge, a separate checkout verifies the merged commit, packages it, and
records its SHA-512 integrity before publication. An existing registry version
must match that artifact exactly. Retries reconcile publication before writing.
No `npm version`/`postversion` push hook is used; version metadata is part of the PR.

The new package is installed in `<root>/versions/<version>/`, smoke-tested, and
selected via an atomic pointer. Normal installed `catui` launches use the managed version;
running sessions remain pinned. Only repair workers use the adopted version;
triage, reproduction, review, hidden-test and audit workers use the bootstrap CLI,
while the supervisor's acceptance policy stays independent of generated patches.
Development source launches and explicit `--agent` launches retain their selected installation.

At least 30 matched completed runs are required by default before classifying
post-adoption behavior. Baseline runs are frozen at job creation; comparisons
match model, workspace, task category and input-size bucket for the same metric.
Multiple tool events in one task count as one run. Four fixed sample windows
(30, 60, 120, 240) use conservative Wilson intervals for failure-rate differences.
See the [NIST interval reference](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm).
The intervals have approximate coverage; this is observational monitoring, not
a randomized experiment. The lower bound must exceed the configured regression
margin before restoring the previous pointer. Improvement requires the upper
bound below zero, no observed per-stratum regression, known usage, and mean-token
and p95-latency ratios no higher than 1.1. Insufficient baseline or ambiguous
results stay inconclusive, including legacy jobs without frozen run samples.
Improvement is recorded as observational evidence, not causal proof. Model weights
are not trained by this feature.

## Operations and recovery

```sh
catui evolve status
catui evolve stop
catui evolve start
catui evolve run
```

`stop` disables new delivery on the next tick; in-flight verification can finish.
The login service remains installed but idle. `run` performs one ingestion and
lifecycle step under the same exclusive lease and respects the daily schedule.

`state.json` records findings, exact commits, PRs, artifact identity, budgets,
errors, retries and measurements. `spool/` holds bounded foreground events;
`logs/` holds private model/verification evidence; `jobs/` and `releases/` hold
isolated checkouts. A single supervisor lease prevents duplicate publishers.
Audit logs and checkouts are retained; monitor disk usage during prolonged operation.
Raw user conversations and trace files are not uploaded; PRs contain a reviewed
reproduction, patch and verification summary. Observation summaries are bounded
and redact common secret/path patterns, but are still private local task data.

Source repair failures exhaust a bounded attempt budget. Transient delivery
failures back off and retry later without discarding PR/release identity.
Changed remote heads and artifact conflicts stop that job. `status` reports the
specific reason; the feature never declares an unverified job successful.

Automatic delivery supports stable patch versions and source improvements.
Dependency/public-package changes, existing test changes, persistence migrations
and acceptance-policy rewrites require a separately designed release path.
