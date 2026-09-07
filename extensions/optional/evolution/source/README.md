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
catui evolve init --model custom-anthropic/MiniMax-M3
catui evolve start
catui evolve status
catui evolve install-service
```

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
daily window. Two distinct failing runs are required. A day with no reproducible
Catui defect produces no PR. External service failures and project-specific bugs
are rejected during triage. Existing submitted jobs reconcile independently of
the daily creation window.

## Verification and recursive authority

The reproducer can write only its assigned new test. The repair worker can modify
source and documentation but cannot rewrite existing tests, dependency manifests,
CI, release scripts, or source-evolution control code. It has scoped file tools,
no shell, no product extensions, and no GitHub/npm credentials in its environment.
The independent read-only reviewer checks the test and patch against the finding.

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
selected via an atomic pointer. Normal `catui` launches use the managed version;
running sessions remain pinned. Evolution workers also use the adopted version,
while the supervisor's acceptance policy stays independent of generated patches.

At least 30 matching tool/outcome observations are required by default before
classifying post-adoption behavior. Model, workspace, tool and source version must
match the cohort. Higher failure rate beyond the configured margin restores the
previous managed pointer (or the original installation on first adoption).
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
Raw user conversations and trace files are not uploaded; PRs contain a reviewed
reproduction, patch and verification summary. Observation summaries are bounded
and redact common secret/path patterns, but are still private local task data.

Source repair failures exhaust a bounded attempt budget. Transient delivery
failures back off and retry later without discarding PR/release identity.
Changed remote heads and artifact conflicts stop that job. `status` reports the
specific reason; the feature never declares an unverified job successful.

The first release supports stable patch versions and source-only improvements.
Dependency/public-package changes, existing test changes, persistence migrations
and acceptance-policy rewrites require a separately designed release path.
