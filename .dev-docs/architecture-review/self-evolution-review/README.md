# Self Evolution Review

status: active
scope: `extensions/optional/evolution/` controlled harness evolution

## Decision

Self-evolution is product-approved for default loading while its source remains
under `extensions/optional/evolution/`. The extension owns `/refine`,
`evolution_refine`, `evolved_tool`, `evolved_executable_tool`, deterministic
`turn_end` observation, candidate state, immutable revisions, validation,
activation, rollback, active skill resource discovery, and prompt injection. Core
runtime remains a host capability provider only. Default loading is idle-neutral:
without candidates or promoted artifacts, it performs no model calls, creates no
evolution ledger, and injects no prompt content.

## Boundaries

- No business logic in `core/runtime/agent-session.ts`.
- `builtin-extensions.ts` is the only default-load switch. `evolution` is the only
  optional-source extension approved for default loading; browser, simplify, and
  export-html remain explicit opt-in capabilities.
- Generated artifacts live under `<agentDir>/evolution/v1/`.
- Candidates may carry `predictions`: falsifiable metric/direction/target records
  that are copied onto promoted revisions. This is the first decision
  observability slice for later post-hoc attribution and auto-revert policy.
- Post-hoc attribution records compare later gate metrics against revision
  predictions and classify each prediction as `kept`, `falsified`, or
  `inconclusive`. Attribution is stored beside the revision and does not mutate
  the immutable revision manifest.
- Usage records are append-only evidence for promoted tool/workflow/executable
  invocations. They store artifact id, kind, revision id, status, timestamp,
  caller, input hash, and bounded result/error summaries without storing raw
  task input.
- Feedback records are append-only usefulness signals for specific usage records.
  `/refine feedback <usage-id> useful|not-useful [note]` stores the outcome and
  bounded, secret-redacted note without mutating the usage or revision record.
- Conservative auto-rollback may move `current.json` from the current revision to
  its predecessor when post-hoc attribution falsifies at least one prediction. It
  is pointer-only, never deletes revisions, never targets non-current revisions,
  and refuses to act when no predecessor exists. Session revisions may use direct
  falsification; workspace/global revisions require stream-aware evidence, with
  repeated isolated/sequential falsification or an interleaved falsification
  treated as rollback-eligible contamination evidence.
- First slice permits `prompt_note`, `memory`, `skill_manifest`, `subagent_spec`,
  `tool_spec`, `workflow_spec`, `eval_fixture`, and restricted workspace
  `executable_tool` records.
- First slice never generates or activates arbitrary source code, shell commands,
  packages, MCP servers, network endpoints, or permission changes.
- Promoted `tool_spec` artifacts may carry declarative `metadata.inputs`,
  `metadata.steps`, and `metadata.usesExistingTools`. `evolved_tool` validates
  declared inputs and returns a structured plan, but it still does not execute
  generated code or bypass existing tool permissions.
- Promoted `workflow_spec` artifacts must carry structured
  `metadata.phases[].checks` and `metadata.successSignals`. `evolved_tool`
  returns the workflow as declarative phases and evidence criteria; it does not
  execute releases, installs, generated code, or publish actions.
- Promoted `skill_manifest` artifacts are materialized only under private
  evolution resource roots and exposed through `resources_discover` as
  namespaced evolved skills. They do not write to user/project skill directories.
- Promoted workspace `executable_tool` artifacts are invoked only through
  `evolved_executable_tool`, which re-checks an approved content hash and
  no-IO permission manifest before interpreting a small JSON safe-DSL manifest.
  The runtime supports only in-memory template rendering, bounded regex
  extraction, and JSON path extraction. It cannot run shell commands, install
  packages, access the network, read files, or write files.
- Session/workspace declarative artifacts may auto-promote when requested by the
  model-facing tool or structured turn-end proposal.
- Global auto-promotion is bounded to low-risk `prompt_note`, `memory`, and
  declarative `tool_spec` artifacts with explicit applicability and short
  content. Global `tool_spec` artifacts also require explicit non-applicability.
  Broader global artifacts are written as inactive candidates for human review.
- Automatic promotion is gated by deterministic harness eval. Projects may provide
  `.catui/evolution/eval-manifest.json` plus declarative
  `.catui/evolution/eval-fixtures.json`; when absent, the built-in corpus is used.
  Passing gate reports are persisted on revisions; failed gates leave candidates
  inactive with failure evidence.
- Harness eval supports AgentStream-style stream manifests: `isolated`,
  `sequential`, and `interleaved` streams. Isolated stream cases get independent
  workspaces, while sequential/interleaved streams share a deterministic stream
  workspace so evolution can be evaluated under task-flow contamination pressure.
- Evolution gate reports preserve stream summaries (`id`, `mode`, pass/fail, and
  metrics), so promoted revisions and failed candidates retain evidence about
  which task-flow setting validated or rejected the change.
- The model-facing refine tool can propose workspace `eval_fixture` artifacts from
  validated local run trace JSONL files. `tracePath: "latest"` resolves to the
  newest `.jsonl` file under workspace `.catui/traces/`. These fixtures are
  inactive until promoted, then participate in future automatic promotion gates.
- The refine tool can also sweep recent workspace `.catui/traces/*.jsonl` files
  into multiple inactive `eval_fixture` candidates in one call. Sweep output is
  deduplicated by fixture content, clustered into distilled trace evidence, and
  never auto-promoted by the sweep itself. Each candidate cites the cluster/root
  cause slice for its trace.
- Duplicate `eval_fixture` content is rejected per scope across proposed/promoted
  candidates and revisions so repeated traces do not accumulate indefinitely.
- Active `eval_fixture` participation is bounded by pointer: the newest three
  promoted fixture artifacts remain active for future gates, older fixture ids are
  archived without deleting immutable revision records.
- Structured `turn_end` `catui_evolution` output may also propose workspace
  `eval_fixture` candidates from `tracePath: "latest"`. Requested auto-promotion
  is allowed only after the current harness gate passes and the candidate fixture
  itself replays without divergence.
- Default-loaded idle sessions register `/refine` and evolution tools but do not
  write runtime state or call a model until a user/model action creates a
  candidate or an active promoted artifact exists.

## Acceptance

- Candidate writes are inactive until promotion.
- Promotion writes an immutable revision and atomically updates `current.json`.
- Promotion preserves candidate predictions on the immutable revision so later
  outcome attribution can verify or falsify the edit contract.
- Attribution records preserve later gate evidence and expose a revision-level
  summary for inspection without changing active pointers.
- Rollback only moves `current.json` to an existing revision.
- Auto-rollback has the same pointer-only semantics and is limited to the active
  revision with a predecessor. Workspace/global auto-rollback requires
  stream-aware falsification evidence.
- Invalid active revisions are quarantined into an auditable ledger record and
  removed from active prompt/tool consumption.
- Prompt injection includes only active `prompt_note` and `memory` artifacts.
- `evolved_tool` lists/invokes only promoted declarative `tool_spec` records,
  and `workflow_spec` records, validates declared inputs, returns structured
  non-executable plans/workflows, and never executes generated code.
- Active `skill_manifest` records produce existing `SKILL.md` resource roots on
  `resources_discover` reload/startup paths without creating evolution state for
  idle sessions.
- Invoking promoted `tool_spec`, `workflow_spec`, or `executable_tool` artifacts
  records scoped usage evidence. Status and changes views show usage totals and
  revision-level success/error records for later usefulness review.
- `/refine feedback` records human usefulness feedback for a usage id. Status and
  changes views show useful/not-useful feedback counts and revision-level notes.
- `/refine review` aggregates usage and feedback per evolved asset and emits a
  conservative keep/watch/review/no-usage recommendation, including active
  assets that have never been invoked. It is advisory only and never changes
  active pointers.
- `evolved_executable_tool` lists/invokes only promoted workspace
  `executable_tool` records, verifies approved content hashes and no-IO
  permission manifests, and runs only supported no-IO JSON safe-DSL transform
  steps.
- Bounded global `tool_spec` artifacts can be promoted automatically only after
  validation and deterministic gate success, then become reusable through
  `evolved_tool`.
- Tests cover storage confinement, executable-content rejection, promotion,
  rollback, model-created artifacts, structured turn-end proposals, eval-gated
  promotion, project eval corpora, trace-derived and turn-end eval fixtures,
  bounded trace sweeps with distilled evidence, stream eval scenarios,
  stream-aware gate evidence and rollback thresholds, prediction manifest
  persistence, post-hoc prediction attribution, conservative auto-rollback,
  executable tool validation/runtime, safe DSL transforms, evolved skill resource
  discovery, workflow spec reuse, usage ledger recording, usefulness feedback and
  review summaries, global auto-promotion bounds, fixture dedupe, fixture active
  retention, scoped status/changes UX, and extension
  registration/default-load/injection.
