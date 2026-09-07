# Recursive Source Evolution Review

status: implementing; autonomous merge and release authorized by product owner
owner: extensions/optional/evolution/
parent: ../self-evolution-review/README.md

## Product intent

Observe Catui during real work in a separate process, turn repeated usage evidence
into verified source improvements, submit qualified pull requests in a daily
batch, adopt approved upstream changes, and measure subsequent outcomes.
Repository protection rules remain authoritative. The product owner explicitly
requested autonomous PR acceptance, publication and adoption on 2026-09-08.
The independent executable verifier plus configured CI checks authorize automatic
merge; no human approval is added by this feature. Required upstream reviews and
registry authentication are respected rather than bypassed.

This proposal extends the earlier declarative evolution scope. It does not claim
that source evolution, a daemon, a schedule, or automatic updates already exist.
Source evolution activation is independent of default declarative evolution.

## Current evidence

- `evolution-auto.ts` observes assistant text at `turn_end`; it is not an
  independent process evaluating the primary agent while it runs.
- `core/runtime/agent-session.ts` records into an in-memory trace sink and persists
  the snapshot during prompt finalization. A completed-run file watcher alone
  cannot satisfy live observation or reliably capture process crashes.
- `evolution-fixture.ts:evalFixtureContent()` clones recorded events into observed
  events. This checks a historical record, not a changed implementation.
- `evolution-gate.ts:runEvolutionGate()` does not use its candidate parameter.
  Existing health gates cannot establish candidate-versus-baseline improvement.
- `scripts/dev-loop/` provides verification and read-only GitHub check ingestion;
  its explicit boundary forbids commits, pushes, and PR mutation.
- The repository remote is `https://github.com/O-Pencil/Catui.git`.
- Existing trace redaction is useful but is not a complete publication policy for
  arbitrary user task data. Public reproductions need a separate export boundary.

## Lifecycle and process model

1. A lightweight extension bridge sends bounded, sanitized execution events to a
   local durable spool. Include run/turn/event identity, build identity, model and
   policy configuration, tool outcomes, timing, usage, cancellation, and observed
   user corrections when available. Do not collect hidden model reasoning.
2. One account-local supervisor owns observation across registered workspaces.
   Multiple Catui sessions connect to this process; they do not each start a daily
   publisher. The foreground never waits for an observer model response.
3. A sidecar consumes events with persistent cursors, deduplication and bounded
   buffering. Overflow or missing sequence numbers produce explicit evidence
   gaps. Incomplete runs remain distinguishable from completed runs.
4. Cheap detectors identify repeated failures, redundant operations, stalls,
   correction loops, and avoidable cost. A budgeted model analyzes selected
   windows and emits hypotheses with evidence references and uncertainty.
5. Triage distinguishes Catui defects from user-project defects, provider/network
   failures, configuration issues, and unsupported hypotheses. Only actionable
   Catui findings enter source repair. Preserve successful runs as controls.
6. A repair worker uses an isolated Catui checkout pinned to an upstream commit,
   reproduces the defect, and makes a focused patch under repository instructions.
7. A separate verifier executes baseline and candidate with a frozen acceptance
   contract. The candidate cannot rewrite its own scoring criteria.
8. A daily durable batch publishes qualified PRs, grouped by root cause. A batch
   may contain several focused PRs; no qualifying improvement means no PR.
9. A reconciler tracks remote PR identity, current head checks, review requests,
   rejection, actual merge commit, and published artifact provenance.
10. A managed updater stages a verified version containing the merged change,
    smoke-tests it, and switches new sessions when idle. Existing sessions stay
    pinned. Subsequent usage validates or falsifies the expected improvement.

Suggested states:

`observed -> triaged -> reproduced -> patched -> verified -> queued -> submitted
-> merged -> available -> staged -> adopted -> measuring -> effective`

Alternate terminal/retry states: `insufficient_evidence`, `rejected`, `failed`,
`superseded`, `regressed`, `rolled_back`. Transitions are append-only events;
retries must not duplicate branches, PRs, installs, or accounting.

## Ownership and placement

- Feature orchestration stays under `extensions/optional/evolution/`, using focused
  subdirectories such as `observer/`, `repair/`, `delivery/`, and `adoption/` with
  P2 maps when implemented. Do not create another competing evolution extension.
- Core supplies only demonstrated reusable event/process/runtime capabilities via
  narrow host contracts. No GitHub or self-improvement business logic in session.
- Keep state and evidence types local to their owning feature. Promote contracts
  into `catui-protocol` only for an actual cross-publish consumer.
- GitHub writes belong to the new delivery adapter; keep `scripts/dev-loop/`
  agent-agnostic and read-only. Its command interface can supply verification.
- Do not import Goal, Grub, Team, or IdleThink implementations across extensions.
  Reuse host execution capabilities instead of coupling their state machines.
- A persistent supervisor must run independently of a TUI session. OS startup
  integration is a separate platform adapter; the existing in-session `/loop`
  timer cannot guarantee daily delivery after Catui exits.

## Evidence and verification contract

Each finding links sanitized evidence, source build, environment/model/policy,
root-cause hypothesis, reproduction, expected metric change and limitations.
Evidence IDs survive source trace rotation. Deduplicate by failure semantics,
not only by text similarity; raw frequency must include an exposure denominator.

For deterministic defects, require baseline failure and candidate success on the
same reproduction, plus existing regression gates. For behavioral optimizations,
execute comparable trials with fixed model/configuration, independent outcomes,
cost and latency measurements, sample counts, and an explicit inconclusive state.
Do not relabel a replay match or a model's self-assessment as improvement.

Required repository gates remain DIP, quality, package boundary, build and type
check, plus affected behavior tests, applicable UX smoke and public API review.
Record exact tested commit IDs. Rebase or repair invalidates previous acceptance.
Retain a stable regression corpus separately from mined candidate examples.

PR content includes problem, sanitized reproduction, patch rationale, baseline and
candidate results, scope, compatibility, and remaining uncertainty. Private user
code, full conversations, credentials and raw traces are not public attachments.
If a publishable reproduction cannot be produced, retain the finding locally.

## Daily delivery and recursive control

- Proposed schedule: 03:00 Asia/Shanghai; configurable, not installed yet.
- Persist local-date batch IDs, lease ownership and a monotonic cursor. Restart
  or wake performs one overdue batch reconciliation, not repeated catch-up PRs.
- Bound model tokens/cost, wall time, repair attempts, concurrent workers, spool
  storage and PR count. Exact operating budgets must be configured before launch.
- Mark observer/repair/eval runs with origin and parent lineage. They consume the
  same bounded evolution budget and cannot recursively spawn observer workers.
  Their failures may become evidence in a later scheduled cycle.
- Review rejection and requested changes become durable feedback. Do not propose
  the same rejected patch again without materially new evidence.
- Merge acceptance is distinct from effectiveness. The repair model cannot
  authorize its own proposal. A separate reviewer and executable verifier gate
  the delivery adapter, which can merge and publish under configured authority.

## Version adoption and rollback

The proposed default channel is an official published version proven to contain
the merged change. PR approval alone, PR closure, and an arbitrary newer package
version are insufficient. A merged PR waiting for release stays `merged`.
An optional merged-commit channel requires its own explicit deployment contract.

Use managed version directories and record source commit, artifact identity,
previous version and smoke-test results. Switch only the managed launcher target;
do not overwrite arbitrary system installations or running process code. Failed
staging leaves the current installation active. Schema migrations require a
compatible reader or tested backup/restore before automatic rollback is enabled.

Post-adoption measurement uses matching task categories and configurations.
Count effectiveness only with sufficient observations; never infer it from merge.
Regression can restore a compatible previous installation and queue a follow-up
repair finding. Do not automatically revert upstream main.

## Delivery slices and acceptance

1. **Observe:** independent process, live spool, restart recovery, cursors, bounded
   load, multi-session singleton and shutdown behavior. Foreground overhead measured.
2. **Verify:** one real usage defect becomes a reproduction that fails on baseline
   and passes on a candidate; unchanged/broken candidates cannot earn improvement.
3. **Deliver:** restart-safe daily batching, real isolated repair, repository gates,
   PR dedupe and review reconciliation against an explicitly configured repository.
4. **Adopt:** merged-to-release provenance, staged install, idle activation, smoke
   failure recovery and migration-compatible rollback.
5. **Close the loop:** later usage links adopted version to measured outcomes;
   regressions feed the next cycle under the same budget and lineage controls.

Full-loop acceptance requires all five slices. A reflection log, queued patch,
mock GitHub response, or approved PR alone is not completion.

## Open deployment choices

- Local maintainer pilot versus a configurable feature for all installations.
- Daily schedule, model selection and hard token/cost limits.
- Official-release adoption versus a managed merged-commit build channel.
- Registered observation workspaces and publication identity/credentials.

No daemon, schedule, GitHub mutation, or installation has been activated by this review.
