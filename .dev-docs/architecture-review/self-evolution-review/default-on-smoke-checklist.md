# Self-Evolution Default-On Smoke Checklist

status: accepted-default-on-policy

## Decision

`extensions/optional/evolution/` is product-approved for default loading while
remaining physically under optional source. The default-on policy is accepted
because loading the extension is idle-neutral until candidates or promoted
artifacts exist: no model calls, no prompt injection, and no evolution ledger
writes occur on unused startup.

## Required Smoke

- Startup neutrality: launching Catui with default extensions creates no
  `<agentDir>/evolution/` directory, performs no model calls, and injects no
  evolution prompt content before any artifact is promoted.
- Default load: `getBuiltinExtensionPaths()` includes
  `extensions/optional/evolution`; startup registers `/refine`,
  `evolution_refine`, `evolved_tool`, and `evolved_executable_tool`.
- Scope views: `/refine --session status`, `/refine --workspace status`, and
  `/refine --global status` show current revision, active artifact count,
  candidate counts, quarantine count, and eval fixture retention.
- Changes view: `/refine --workspace changes` explains the active revision,
  predecessor, rationale, expected outcome, and added/changed/removed artifacts.
- Trace distillation: `sweep_workspace_traces` turns recent `.catui/traces/*.jsonl`
  files into inactive eval fixture candidates with cluster summaries and per-trace
  evidence slices.
- Stream rollback: workspace/global auto-rollback does not trigger on a single
  isolated falsification, does trigger on repeated stream falsification, and treats
  interleaved falsification as contamination-strength evidence.
- Executable prototype: `create_executable_tool` creates only inactive workspace
  candidates; `/refine --workspace promote <candidate>` runs a gate first; invoked
  tools re-check approved content hash and no-IO permissions.
- Trust boundary: candidate validation rejects shell commands, package installs,
  network endpoints, server configuration, credentials, global executable tools,
  and executable tools with write/network/install permissions.
- Failure behavior: failed gates leave candidates inactive with evidence; tampered
  active revisions are quarantined and normal Catui operation continues.
- Verification: `verify:dip`, `verify:quality`, `verify:package-boundary`,
  `build`, `tsc --noEmit`, `verify:package-boundary:dist`, focused evolution
  tests, and `test:harness-eval` pass in the same checkout.

## Reopen Conditions

- Any smoke item becomes flaky or manual-only.
- Default loading starts performing model calls, prompt injection, or ledger writes
  before user/model evolution activity exists.
- The executable runtime expands beyond no-IO manifest interpretation.
