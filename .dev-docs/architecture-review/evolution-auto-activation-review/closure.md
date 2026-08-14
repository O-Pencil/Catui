# Evolution Auto Activation Closure

```yaml
status: complete
implemented: true
```

## Implemented

- `/refine` command candidates now attempt automatic activation immediately after creation.
- `turn_end` reusable lessons now promote to active session memory after validation.
- Structured `catui_evolution` proposals no longer require an `autoPromote` field to activate.
- Eval fixtures still require current-gate and candidate-fixture gate evidence.
- Executable tool activation still requires a passing gate report.
- Global activation remains bounded by `canAutoPromoteGlobalEvolution()`.

## Deferred

- User-configurable activation policy.
- TUI surface for activation provenance.

## Reopen If

- Automatic activation bypasses executable or eval fixture gates.
- Global artifacts activate outside the bounded policy.
- Users need per-project policy controls before this can remain default-on.
