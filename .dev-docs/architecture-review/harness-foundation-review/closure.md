# Harness Foundation Closure

```yaml
status: closed
closed_at: 2026-08-25
acceptance: behavioral gates passed; repository gates recorded in gates.md
```

## Delivered

- Workspace edit/write confinement now rejects lexical escapes and every existing
  symbolic-link component below the workspace root.
- Interactive Bash approval augments the authoritative default tool registry instead
  of replacing it with a Bash-only registry.
- Product traces are redacted before the sink, pruned to a bounded run-file set, and
  serialize `latest`/retention commits across sessions and processes.
- Eight offline scenarios run both production loops with scripted assistant streams,
  real policies/tools, concrete outcome assertions, and replay validation.
- Trace instrumentation records applied transitions and paused checkpoint identity;
  model-error recovery closes each failed turn, and streamed tools remain paired and
  counted through provider errors and abort replacement.
- The required harness command covers checkpoint, Goal, Grub, Team, evolution, trace,
  and eval behavior in default local tests and CI.

## Deferred

- OS-level filesystem/network isolation and race-free tool write confinement.
- Executing and resolving approval checkpoints inside the built-in eval corpus.
- A verifier-owned unification of Goal, Grub, Team, and task lifecycle state.
- Real subprocess sub-agent execution and evaluator-owned Grub completion.

## Reopen

Reopen this review if a default write path intentionally needs symbolic links, a
required scenario needs provider network access, or trace redaction prevents a
benchmark from expressing semantic arguments without credentials.
