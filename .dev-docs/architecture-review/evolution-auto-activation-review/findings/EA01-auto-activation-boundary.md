# EA01 - Auto Activation Boundary

## Finding

The previous flow created valid candidates but required a separate `promote` command before active artifacts influenced future turns. That keeps the evolution loop inspectable, but it prevents the default self-evolution feature from improving the next turn unless a human remembers the activation command.

## Decision

Make activation automatic for extension-owned proposal paths, while preserving the same store validation and promotion records.

## Guardrails

- Do not auto-activate unsafe global artifacts.
- Do not activate executable tools without a passing gate report.
- Do not activate divergent eval fixtures.
- Keep `promote`, `reject`, and `rollback` for recovery and legacy candidates.
