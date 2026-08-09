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
/refine rollback rev_0123456789abcdef0123456789abcdef --scope session
```

`/refine` sends at most the newest 12 session entries, with non-text bodies omitted and private paths or secret-like values redacted. Structured output is wrapped in a host-owned candidate envelope and validated before persistence.

The current delivery slice stops new candidates after static validation. They remain inactive: neither prompts nor skills are loaded from `candidates/` or `quarantine/`. Replay/eval integration and approval-based promotion are the next slice; `approve`, `reject`, and `mode` therefore report that they are unavailable without changing active state.

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

Rollback activates an existing immutable revision and reloads resources. If reload fails, the extension restores the previous pointer. A corrupt scope is ignored so ordinary Catui operation continues.

History pruning, generated executable code, unattended global promotion, and model-weight training are intentionally outside this design.
