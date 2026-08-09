# SE04 Consumption

severity: high

## Finding

Only active revisions may affect future runs. Inactive candidates must never
enter the prompt or resource discovery.

## Decision

Active `prompt_note` and `memory` artifacts are consumed through prompt
injection. Active `tool_spec` artifacts are consumed through `evolved_tool`,
which validates declared inputs and returns structured non-executable plans.
`skill_manifest` and `subagent_spec` remain inspectable planning records only.

## Verification

Tests assert inactive candidates are invisible, active prompt/memory artifacts
are appended through `before_agent_start`, and active `tool_spec` artifacts are
available only through `evolved_tool` without generated-code execution.
