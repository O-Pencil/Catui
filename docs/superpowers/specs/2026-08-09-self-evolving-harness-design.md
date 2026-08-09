# Self-Evolving Harness Design

**Issue:** HAP-45
**Status:** Awaiting written-spec review
**Scope:** A safe, extension-owned continual-harness refinement system for prompt notes, memories, skill manifests, subagent specifications, and non-executable tool specifications.

## Intent

Catui should learn reusable behavior from its own runs without mutating built-in
tools or source code. The first release adds a separate runtime-owned evolution
store, turns trace-backed observations into candidates, validates them, and only
then promotes an immutable revision to the active harness.

This is harness self-evolution: the harness changes the reusable context,
procedures, and delegation specifications that shape future runs. It is not model
weight training, and it is not unrestricted source-code self-modification.

## Product Boundary

The first release may evolve five declarative artifact kinds:

- `prompt_note`: narrow supplemental behavior, never the base system prompt.
- `memory`: durable facts, preferences, failures, decisions, and outcomes.
- `skill_manifest`: an instruction resource with an explicit invocation contract.
- `subagent_spec`: a reusable delegation role with purpose, inputs, outputs, and
  completion contract.
- `tool_spec`: a non-executable capability description that can recommend an
  existing tool or describe a future tool candidate.

The first release must not generate or activate JavaScript, TypeScript, Python,
shell scripts, native binaries, MCP server commands, package dependencies, or
Catui source patches. Executable tool generation is a separate second design:
generated code must live in quarantine, run in an isolated worktree/sandbox, pass
tests and policy review, and require human approval before installation.

## Why Generated Artifacts Need Their Own Directory

Built-in tools and extensions are reviewed release assets. User-authored resources
are deliberate configuration. Agent-generated resources have different provenance
and trust, so mixing these classes would make inspection, precedence, cleanup, and
rollback ambiguous.

Catui therefore owns one distinct runtime directory below the active agent
directory:

```text
<agentDir>/evolution/v1/
  global/
  workspaces/<workspace-key>/
  sessions/<session-id>/
```

This directory is outside the repository by default. It must not write generated
runtime artifacts into `extensions/builtin/`, `core/tools/`, a user skill directory,
or the workspace. The workspace key is derived from the canonical workspace path
using a one-way hash; persisted manifests may carry a redacted display label but
must not require the raw path.

Each scope root has the same layout:

```text
<scope-root>/
  candidates/<candidate-id>/
    proposal.json
    artifacts/
      prompt-notes/
      memories/
      skills/
      subagents/
      tool-specs/
    evidence/
      trace-refs.json
      static-validation.json
      replay-report.json
      eval-report.json
      reviewer-report.json
  revisions/<revision-id>/
    manifest.json
    artifacts/
  current.json
  history.jsonl
  quarantine/
```

Candidate proposal/artifact content and every finalized revision are immutable.
Gate evidence is written once per gate. `current.json` is the only mutable activation
pointer and changes via atomic rename; `history.jsonl` is append-only. `quarantine/`
is never searched by the runtime resource loader.

The initial implementation creates directories lazily. Empty scope roots and empty
artifact-kind directories are not pre-created.

## Scope Semantics

### Session

Session evolution records current-run coordination, temporary blockers, and
task-specific lessons. It is the default write scope. It affects only the same
persisted session. After session deletion it is no longer loaded; physical pruning
remains deferred so the first release never destroys evolution history.

### Workspace

Workspace evolution records project-qualified conventions and reusable procedures.
Promotion requires evidence from the current workspace and must never affect other
workspaces with a matching directory name.

### Global

Global evolution records stable user preferences and reusable cross-project
procedures. It has the widest blast radius, so automatic promotion is forbidden in
the first release. A human approval checkpoint is mandatory.

Effective state is merged in this order:

```text
built-in defaults < global evolved < workspace evolved < session evolved < explicit user/project resources
```

An evolved artifact cannot silently shadow a built-in or explicit resource. IDs are
namespaced as `evolved:<kind>:<id>` and collisions fail validation. Higher scopes may
override lower evolved scopes only by declaring the target evolved ID and recording
that relationship in provenance.

## Ownership and Architecture

### Feature owner

An opt-in extension owns refinement policy and product behavior. Its intended home
is `extensions/optional/evolution/`. It owns commands, state transitions, proposal
generation, validation orchestration, activation, rollback, prompt injection, and
resource discovery.

This placement follows Catui's rule that a new user-visible capability belongs in
an extension. The feature must not add refinement state or scheduling branches to
`core/runtime/agent-session.ts`.

### Existing runtime capabilities

The extension consumes narrow host capabilities already exposed through
`ExtensionContext`: session messages, one-shot structured completion, lifecycle
hooks, prompt append, resource discovery, current skills, settings, and user-facing
commands. If an implementation seam is missing, the architecture review may add a
small additive capability to the extension contract; it must not expose the full
`AgentSession` as a service locator.

Catui's existing primitives remain authoritative:

- versioned run evidence: `core/lib/agent-core/src/run-trace.ts`
- deterministic replay: `core/lib/agent-core/src/run-replay.ts`
- regression evaluation: `core/harness-eval/`
- durable human approval: `core/runtime/checkpoint-store.ts`
- memory and personality consumers: `packages/mem-core/` and `packages/soul-core/`

The evolution extension orchestrates these capabilities but does not reimplement
them.

### Type placement

All initial evolution types remain inside the extension because it is their only
consumer. A type moves to `packages/protocol/` only when a published package or an
external extension needs the same contract. Adapters for mem-core or soul-core extend
the narrow published contracts locally rather than expanding protocol pre-emptively.

## Artifact Contract

Every artifact revision contains:

- stable namespaced ID, artifact kind, schema version, and content hash;
- title, content, scope, version, creation time, and activation state;
- provenance: source run/turn/trace references and triggering observation;
- explicit applicability and non-applicability conditions;
- declared prompt/token budget;
- dependencies on existing tools, skills, or subagent capabilities;
- validation results and expected measurable outcome;
- predecessor revision and rollback target when applicable.

Skill manifests additionally declare inputs, required fields, constraints, examples,
and their existing execution mechanism. Tool specifications additionally declare
permissions and intended runtime, but remain descriptions only in the first release.

Raw prompts, tool bodies, credentials, environment variables, and unrestricted
outputs are excluded from provenance. Evidence uses redacted trace references and
fingerprints.

## State Machine

```text
observed
  -> proposed
  -> statically_validated
  -> replay_validated
  -> eval_validated
  -> awaiting_approval (when policy requires it)
  -> promoted
  -> superseded | rolled_back

Any validation failure -> quarantined
Any stale baseline/conflict -> superseded
```

No candidate is injectable or discoverable before `promoted`. A candidate cannot
skip a state. Retrying a failed validation creates new evidence for the same immutable
candidate; changing artifact content creates a new candidate ID.

## Refinement Data Flow

1. A manual `/refine` request or enabled trigger captures a bounded, redacted slice
   of session messages and run-trace references.
2. A cheap review gate decides whether evidence supports a reusable change. One-off
   noise, transient command output, and unsupported hypotheses produce no candidate.
3. Structured completion emits a proposal under a strict JSON schema. The proposal
   references a baseline revision and cannot name built-in file paths.
4. Static validation checks schema, scope, namespace, content and token limits,
   dependency existence, provenance, collisions, and artifact-specific contracts.
5. Deterministic replay proves activation and consumption preserve lifecycle, policy,
   checkpoint, and tool-pairing invariants; it does not prove model-quality gains.
6. Candidate-specific eval compares champion and candidate. If no scenario measures
   the declared outcome, the candidate remains pending.
7. A reviewer evaluates evidence and scope. Global promotion and all future
   executable artifacts additionally require a human checkpoint.
8. Promotion writes an immutable revision, atomically swaps `current.json`, appends
   history, and reloads only the affected prompt/resource view.
9. Later runs attribute outcomes to the active revision. Rollback atomically points
   `current.json` to the predecessor; it never edits an old revision.

## Candidate Evaluation

Safety is lexicographic, not averaged into a single score. A candidate fails if it
introduces any policy violation, unpaired tool call, replay divergence, path escape,
resource collision, unsupported executable content, or secret-like material.

Only candidates that pass safety are compared on:

- scenario completion rate;
- task-specific correctness assertions;
- tool-call and turn economy;
- token, latency, and monetary cost ceilings;
- recovery and livelock behavior;
- applicability precision, including negative scenarios where the artifact must not
  be injected.

Automatic promotion requires metric non-inferiority and one candidate-specific
improvement; live-model scores cannot be the only evidence. Manual approval may
override missing effectiveness evidence only when recorded; safety gates remain hard.

## Consumption Rules

### Prompt notes

Only applicable promoted notes are appended through `before_agent_start`. Injection
has a global token budget, deterministic ordering, deduplication, and per-artifact
attribution.

### Skills

Only promoted skill manifests are returned through `resources_discover`. Generated
skills are namespaced and lower precedence than explicit user/project skills. The
first release may reference an existing trusted callable but cannot introduce code.

### Subagent specifications

Promoted specifications are routing hints for the existing subagent/team systems.
They cannot create a new executor, raise permissions, select unavailable models, or
spawn work without the normal admission controls.

### Memories

Promoted memories pass through a mem-core adapter and retain their evolution
provenance. They do not write directly to mem-core's private files.

### Soul

Soul may consume promoted preference/style facets, but heuristic Soul deltas cannot
promote executable policies. Soul remains a personality consumer; the evolution
ledger is the authority for reusable harness artifacts.

### Tool specifications

Tool specs appear in inspection and planning surfaces only. They are never registered
with `registerTool` in the first release. A future code-generation phase must define
a separate executable-artifact protocol and sandbox review.

## Triggers, Budgets, and Modes

The first delivered mode is manual `/refine` with session scope. Automatic triggers
arrive only after manual candidates and rollback are proven.

Automatic rollout proceeds as follows:

1. `off`: no review or proposal calls.
2. `manual`: user-initiated proposals only.
3. `shadow`: automatic review and candidate generation, never promotion.
4. `guarded`: automatic session/workspace promotion after all gates; global remains
   manual approval only.

Supported triggers are a configured turn interval, post-compaction, explicit user
correction, repeated trace fingerprint, and repeated validated failure. Every trigger
has a cooldown and daily token/cost budget. Background refinement is opportunistic
and cannot delay shutdown, compaction, active tool execution, or user input.

## Concurrency and Durability

Proposal planning may overlap an active turn, but activation requires a quiescent
extension boundary. The candidate records its baseline revision. Promotion re-reads
`current.json` and rejects a stale baseline instead of merging implicitly.

All mutable files use private permissions and write-temp-plus-atomic-rename. History
append is serialized per scope. Readers reject unsupported schema versions, invalid
hashes, path escapes, symlinks escaping the scope root, oversized files, malformed
JSON, and incomplete revisions. A corrupt active pointer falls back to the last valid
history entry; if none exists, evolution disables itself without breaking the agent.

## Commands and Inspection

The intended command surface is `/refine [instructions]`, `/refine status`,
`/refine inspect <id>`, `/refine approve <candidate-id>`, `/refine reject
<candidate-id> [reason]`, `/refine rollback <revision-id>`, and `/refine mode
off|manual|shadow|guarded`.

Every command works without TUI-only state. Human-readable output shows scope,
artifact kinds, evidence summary, validation gates, token/cost attribution, active
revision, and rollback target. Machine-facing mode returns the same versioned model
as JSON.

## Failure Handling

- LLM failure, invalid JSON, or budget exhaustion leaves no active change.
- Partial candidate writes are ignored until a finalized proposal manifest exists.
- Eval or replay failure quarantines the candidate and preserves the champion.
- Reviewer or approval unavailability leaves the candidate pending.
- Resource reload failure rolls the activation pointer back before reporting success.
- Rollback is idempotent and records who or what requested it.
- Extension failure disables evolution only; normal Catui sessions remain usable.

## Security Model

- Agent-generated content is untrusted data at rest and during validation.
- Built-in and user-authored source directories are immutable to this feature.
- All persisted paths are resolved beneath their scope root; archive extraction and
  symlink traversal are forbidden.
- Candidate content cannot declare environment variables, credentials, arbitrary
  commands, package installation, network endpoints, or permission escalation.
- Prompt-injection tests include malicious prior messages attempting to bypass
  scope, approval, namespace, or executable-content restrictions.
- Deleting or pruning historical revisions is not part of the first release.

## Architecture Review Requirement

This feature touches extension discovery, prompt injection, persistent runtime state,
evaluation, token cost, and user command paths. Before implementation, create
`.dev-docs/architecture-review/self-evolution-review/` with `README.md`, finding
cards for extension API gaps, precedence, persistence/concurrency, eval, and mem/soul
integration, plus `closure.md`. The review must confirm that the feature remains
optional and adds no business logic to `core/runtime/agent-session.ts`.

## Testing Strategy

Implementation follows test-first vertical slices covering: store confinement,
hashing, atomicity and corruption; scope precedence, collision and concurrency;
structured proposals, redaction and budgets; state transitions, quarantine,
promotion and rollback; champion-vs-candidate replay/eval and negative applicability;
declarative consumers across modes; automatic trigger lifecycle; and adversarial
content, traversal, secret leakage, collision, and permission-escalation attempts.

Repository verification must include focused evolution tests plus `verify:dip`,
`verify:quality`, `verify:package-boundary`, production build, `tsc --noEmit`, and the
deterministic harness eval gate. Public API, token/performance, and UX checks are
reported separately.

## Delivery Slices

1. **S0 — Architecture review:** extension capabilities and trust boundaries.
2. **S1 — Evolution store:** immutable ledger, history, inspection, and rollback.
3. **S2 — Manual proposal:** generation, validation, quarantine, no activation.
4. **S3 — Verified promotion:** replay, eval, review, checkpoint, atomic activation.
5. **S4 — Declarative consumers:** prompt, skill, subagent, memory, Soul, tool specs.
6. **S5 — Shadow automation:** triggers, cooldown, budgets, and reports.
7. **S6 — Guarded promotion:** session/workspace automation; global stays manual.

Each slice is independently testable and leaves evolution disabled or non-promoting
when incomplete.

## Acceptance Criteria

- Generated artifacts live only under `<agentDir>/evolution/v1/`, retain provenance, and cannot shadow built-in or explicit resources.
- No first-release artifact introduces executable code, commands, packages, MCP servers, network endpoints, or elevated permissions.
- Candidates remain inactive until verified promotion; automatic promotion requires zero safety regression, metric non-inferiority, and one declared improvement, while any manual evidence override is explicit and auditable.
- Activation and rollback are atomic and preserve immutable history. Corruption, stale baselines, concurrent writers, reload failure, or extension failure preserve the champion and normal Catui operation.
- Evidence is redacted; disabled evolution performs no automatic LLM calls, prompt injection, or runtime writes.
- Focused tests and every repository acceptance gate pass before PR delivery.

## Deferred Work

- Executable tools, extensions, skills, source patches, package installation, and dependency modification.
- Unattended global promotion, model fine-tuning, and weight updates.
- Cross-device synchronization and destructive history pruning.

These items require separate designs because they cross a materially stronger trust
boundary than declarative harness refinement.
