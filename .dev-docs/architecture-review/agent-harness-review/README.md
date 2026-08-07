# Agent harness reliability review

```yaml
status: implementing
issue: HAP-45
decision: unified policy pipeline plus progress and checkpoint runtime primitives
```

## Scope

This review covers three load-bearing improvements: tool policy composition,
progress-aware livelock detection, and durable pause/resume checkpoints. It excludes
provider protocol changes, UI redesign, and a new persistence database.

## Boundary decision

The agent execution contract belongs to `core/lib/agent-core`; runtime composition
belongs to `core/runtime`; extension adaptation belongs to `core/extensions-host`.
Published protocol changes are additive only when third-party extensions require the
contract. Plan-mode product state stays in the plan extension.

## Acceptance

- [ ] One ordered policy outcome model is consumed by both loops.
- [ ] Plan-mode duplicated predicates are removed or reduced to a single owner.
- [ ] Repetition can terminate before the coarse turn cap without false progress loss.
- [ ] Paused approvals can be resumed once across a fresh runtime instance.
- [ ] Compatibility and all repository gates are green.

See `findings/AH01-runtime-contract.md` for the load-bearing decision and `closure.md`
for final evidence.

