# Harness Foundation Review

```yaml
status: closed
started_at: 2026-08-25
closed_at: 2026-08-25
decision: make harness evidence executable, filesystem writes canonical, runtime tool overrides complete, traces bounded and redacted, and critical tests required
```

## Scope

This review covers the first reliability-first foundation slice:

- replace the built-in self-referential trace fixtures with scripted-model runs through both real agent loops;
- reject workspace writes that traverse symbolic links outside the workspace;
- preserve the complete default tool registry when interactive Bash approval is enabled;
- redact secret-like tool inputs before workspace trace persistence and bound retained run files;
- make critical harness subsystem tests an explicit local and CI gate.

It does not unify Goal, Grub, Team, and Task state machines, introduce a new public
protocol, redesign the TUI, or implement subprocess Agent execution. Those are later
slices after the foundation produces trustworthy evidence.

## Ownership

| Concern | Owner | Reason |
|---|---|---|
| Agent-loop trace scenarios | `core/harness-eval/` | Host-only deterministic verification of both loop implementations |
| Canonical workspace write boundary | `core/tools/` | Shared primitive used by default edit/write tools |
| Default tool composition | `core/runtime/` | Runtime composition, not Bash business logic |
| Trace redaction and retention | `core/runtime/` | Host persistence policy stays outside agent-core protocol |
| Required test orchestration | root scripts and CI | Repository delivery policy |

No contract is promoted to `catui-protocol`: every changed type remains inside one
publish boundary.

## Invariants

1. A built-in harness scenario must execute an actual agent loop and assert an
   observable outcome; copied expected/observed traces cannot pass.
2. A path accepted by the default write guard must not traverse a symbolic link below
   the workspace root.
3. Enabling Bash approval must not remove read, edit, write, or the rest of the base
   tool registry.
4. Clear tool arguments may remain useful for local evaluation, but secret-like values
   must be redacted before the sink sees them.
5. Workspace traces must have a deterministic retention bound.
6. Goal, Grub, Team, checkpoint, trace, and evolution regression tests must not depend
   on a developer remembering optional scripts.

## Acceptance

See [gates.md](./gates.md), [HF01](./findings/HF01-trustworthy-foundation.md), and [closure.md](./closure.md).
