# Controlled Harness Evolution

This default-loaded extension gives Catui a separate, auditable place to learn reusable declarative behavior from its own sessions. It does not modify Catui source, built-in tools, the base system prompt, user-authored resources, or model weights.

## Default Loading

`evolution` remains physically under `extensions/optional/` because it is a high-trust product capability, but it is product-approved for default loading through `getBuiltinExtensionPaths()`. When unused, it performs no model calls, creates no evolution directory, and injects no prompt content. It becomes behaviorally active only after a candidate or promoted artifact exists.

## Manual candidate flow

```text
/refine --scope session Focus on the repeated verification omission
/refine status --scope session
/refine inspect candidate_0123456789abcdef --scope session
/refine changes --scope workspace
/refine verify candidate_0123456789abcdef --scope session
/refine approve candidate_0123456789abcdef verified-by-owner --scope session
/refine reject candidate_0123456789abcdef insufficient-evidence --scope session
/refine rollback rev_0123456789abcdef0123456789abcdef --scope session
/refine mode shadow
/refine mode guarded --scope workspace
```

`/refine` sends at most the newest 12 session entries, with non-text bodies omitted and private paths or secret-like values redacted. Structured output is wrapped in a host-owned candidate envelope and validated before persistence.

New candidates stop after static validation and remain inactive: neither prompts nor skills are loaded from `candidates/` or `quarantine/`. `verify` replays the latest completed semantic Run Trace and runs Catui's isolated, network-disabled Harness Eval corpus. Both safety results are persisted together as immutable replay evidence.

The built-in corpus proves lifecycle, tool-pairing, policy, and baseline regression safety; it does not claim that a candidate-specific behavior improved. Shadow and guarded reviews also request a scenario-grounded model critique, but that critique is advisory and can never authorize activation by itself. Every behavioral candidate remains inactive until it has both passing replay/safety evidence and a passing, integrity-bound real-task benchmark report. Human approval cannot override either requirement. Pure `eval_fixture` candidates are verifier data rather than runtime behavior, so they require their candidate-specific fixture replay gate but no real-task effectiveness report. `reject` is immutable and blocks later promotion. Global candidates additionally require explicit human approval.

## Held-out real-task evidence

PawBench or another trusted runner produces versioned baseline and candidate snapshots. For PawBench, use the same frozen 150-task corpus, concealed held-out assignment, model/provider version, temperature, token and timeout limits, total budget, and at least three predeclared repetitions for both revisions. The candidate snapshot must use both the candidate id and `Content hash` shown by `/refine inspect`; this binds the result to the exact proposed artifacts. Do not use best-of-N selection.

After both runs finish, generate the private report at the path consumed by `/refine promote`:

```bash
npm run eval:evolution-benchmark -- \
  --baseline ./pawbench-baseline.json \
  --candidate ./pawbench-candidate.json \
  --candidate-id candidate-0123456789abcdef \
  --output ./.catui/evolution/benchmarks/candidate-0123456789abcdef.json

catui
# Then run: /refine --workspace promote candidate-0123456789abcdef
```

The comparator pairs held-out runs by task and repetition, aggregates repetitions per task, and uses a deterministic task-cluster bootstrap. Promotion requires at least a 5-point pass-rate gain with a positive 95% lower bound, no slice regression beyond 2 points, zero policy/replay/tool-pair failures, cost per success within 10%, and P95 latency within 15%. Snapshot or report contents are never printed by the CLI; reports are written with owner-only permissions.

Evidence is invalid when baseline and candidate differ in corpus digest or execution envelope. Changing graders/verifiers, specializing behavior to task names, exposing the held-out split, inflating timeouts or budgets, or choosing the best of repeated runs also invalidates the comparison. This release imports and verifies trusted PawBench results; it does not yet orchestrate PawBench, conceal/sign reports, generate mutations, or schedule canaries.

Automatic review runs only after the agent becomes idle or after compaction. A mode/scope change, a new agent turn, or session shutdown invalidates any in-flight activation; guarded authorization is re-read under lock at the final atomic boundary. Shutdown never waits for opportunistic model work. The default trigger is every 25 turns, with a 20-minute cooldown and conservative daily reservations of 8,000 estimated tokens / $0.40 per two-call review, capped at 40,000 tokens / $2.00. `off` and `manual` make no automatic model calls. Trigger fingerprints and accounting are kept in private atomic state under the evolution root.

## Runtime data

Generated data lives outside the repository:

```text
<agentDir>/evolution/v1/
  global/
  workspaces/<sha256-key>/
  sessions/<session-id>/
```

Directories are lazy. Each scope contains immutable candidates and revisions, write-once evidence, an append-only `history.jsonl`, and an atomically replaced `current.json`. Files use private permissions. Workspace keys are derived from canonical paths and do not disclose those paths.

Only an active revision can contribute context. Applicable promoted prompt notes, memories, and preference facets are appended as supplementary context in deterministic `global -> workspace -> session` order, after negative-applicability filtering and within one conservative 4 KiB aggregate cap (therefore below 4,096 model tokens even without tokenizer coupling). Subagent specifications appear as planning hints for Catui's existing delegation controls. Promoted skill manifests are materialized under private evolution resource roots as namespaced declarative `SKILL.md` resources, then exposed through `resources_discover` so the existing skill loader can discover them on reload. Existing explicit skills win name collisions. Tool specifications and workflow specifications remain declarative and are exposed through `evolved_tool`; workflow specs require structured phases, checks, and success signals before promotion.

When promoted tool, workflow, or executable-tool assets are invoked, the extension writes append-only usage records under the same private scope. Usage records store artifact id, kind, revision id, status, timestamp, caller, input hash, and a short result/error summary; they do not persist raw task input. `/refine feedback <usage-id> useful|not-useful [note]` adds append-only usefulness feedback for a usage record without mutating it, and secret-like note fragments are redacted before persistence. `/refine status` and `/refine changes` surface usage and feedback counts plus revision-level evidence, while `/refine review` summarizes active evolved assets, including never-used assets, with keep/watch/review/no-usage recommendations so stale or harmful assets can be evaluated later.

Workspace-scoped `executable_tool` artifacts are a restricted prototype, not arbitrary generated code. `evolution_refine` can propose them only as inactive workspace candidates. Activation through `/refine --workspace promote <candidate-id>` runs replay/safety and held-out effectiveness gates first, then stores the approved revision hash. Invocation goes through `evolved_executable_tool`, which re-checks the approved content hash and no-IO permission manifest before interpreting a small JSON step manifest. The runtime supports only safe in-memory DSL transforms: template rendering, bounded regex extraction, and JSON path extraction. It has no shell, package install, network, file read, or file write capability.

## Trust boundary

V1 rejects executable commands, package installation, MCP server declarations, network endpoints, secret-like material, absolute paths, unknown artifact kinds, non-namespaced IDs, oversized content, and missing provenance/applicability evidence. Stale candidate baselines cannot replace a newer active revision.

Rollback and approval activate an immutable revision and reload resources. If reload fails, the extension restores the previous pointer. A corrupt pointer recovers from the newest fully verified history revision; modified artifact or skill files are rejected. If no valid revision remains, the scope is ignored so ordinary Catui operation continues.

Post-hoc attribution is recorded against prediction manifests after later gates run. Session-scoped revisions may auto-rollback on direct falsified predictions when a predecessor exists. Workspace and global revisions require stream-aware evidence before auto-rollback: falsification must repeat across multiple stream modes, while an interleaved stream falsification is treated as stronger contamination evidence. Per-stream attribution is persisted with the attribution record and shown in `/refine inspect`.

History pruning, arbitrary generated source-code execution, unattended global promotion, and model-weight training are intentionally outside this design.
