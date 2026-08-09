# Controlled Harness Evolution

This optional extension gives Catui a separate, auditable place to learn reusable declarative behavior from its own sessions. It does not modify Catui source, built-in tools, the base system prompt, user-authored resources, or model weights.

## Enable

From a source checkout:

```bash
catui --extension extensions/optional/evolution
```

The extension is opt-in. When enabled but unused, it performs no model calls and creates no evolution directory.

## Manual candidate flow

```text
/refine --scope session Focus on the repeated verification omission
/refine status --scope session
/refine inspect candidate_0123456789abcdef --scope session
/refine verify candidate_0123456789abcdef --scope session
/refine approve candidate_0123456789abcdef verified-by-owner --scope session
/refine reject candidate_0123456789abcdef insufficient-evidence --scope session
/refine rollback rev_0123456789abcdef0123456789abcdef --scope session
```

`/refine` sends at most the newest 12 session entries, with non-text bodies omitted and private paths or secret-like values redacted. Structured output is wrapped in a host-owned candidate envelope and validated before persistence.

New candidates stop after static validation and remain inactive: neither prompts nor skills are loaded from `candidates/` or `quarantine/`. `verify` replays the latest completed semantic Run Trace and runs Catui's isolated, network-disabled Harness Eval corpus. Both reports are persisted as immutable candidate evidence.

The built-in corpus proves lifecycle, tool-pairing, policy, and baseline regression safety; it does not claim that a candidate-specific behavior improved. Therefore automated activation remains fail-closed until a candidate-specific evaluator proves improvement. A user may explicitly `approve` the missing-effectiveness override after safety verification; that one-time human decision is stored as immutable reviewer evidence before atomic promotion. `reject` is also immutable and blocks later promotion. Global candidates always require explicit human approval.

## Runtime data

Generated data lives outside the repository:

```text
<agentDir>/evolution/v1/
  global/
  workspaces/<sha256-key>/
  sessions/<session-id>/
```

Directories are lazy. Each scope contains immutable candidates and revisions, write-once evidence, an append-only `history.jsonl`, and an atomically replaced `current.json`. Files use private permissions. Workspace keys are derived from canonical paths and do not disclose those paths.

Only an active revision can contribute context. Promoted prompt notes and memories are appended as supplementary context in deterministic `global -> workspace -> session` order. Promoted skill manifests are materialized as namespaced declarative `SKILL.md` resources. Existing explicit skills win name collisions. Tool specifications are never registered as tools.

## Trust boundary

V1 rejects executable commands, package installation, MCP server declarations, network endpoints, secret-like material, absolute paths, unknown artifact kinds, non-namespaced IDs, oversized content, and missing provenance/applicability evidence. Stale candidate baselines cannot replace a newer active revision.

Rollback and approval activate an immutable revision and reload resources. If reload fails, the extension restores the previous pointer. A corrupt scope is ignored so ordinary Catui operation continues.

History pruning, generated executable code, unattended global promotion, and model-weight training are intentionally outside this design.
