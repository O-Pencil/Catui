# Self-Evolution Architecture Review

```yaml
review_id: self-evolution-review
issue: HAP-45
scope: extensions/optional/evolution and runtime data below agentDir/evolution/v1
status: implementation
created_at: 2026-08-09
owner: optional evolution extension
```

## Decision

Catui's continual harness refinement is an opt-in extension, not core runtime business logic. The extension may create and activate only declarative `prompt_note`, `memory`, `skill_manifest`, `subagent_spec`, and non-executable `tool_spec` artifacts in v1.

Generated data has distinct provenance and trust. It lives only below `<agentDir>/evolution/v1`, never under built-in extension/tool directories, explicit user resource directories, or the current workspace. Candidates are inactive and immutable. A complete immutable revision becomes active only through an atomic `current.json` pointer update after validation.

## Dependency Direction

```text
ExtensionAPI
  -> evolution command/hooks
     -> pure schema + workflow
     -> evolution filesystem store

core runtime <- unchanged
mem-core/soul-core private stores <- never written
```

The entry point alone consumes `core/extensions-host/types.ts`. Extension-local modules use Node primitives and local types. No evolution type enters `catui-protocol` until a published or external consumer exists.

## Acceptance

- No candidate or quarantine path is injectable or returned from resource discovery.
- No v1 schema represents executable code, commands, package installation, network endpoints, MCP servers, or permission elevation.
- Promotion rejects stale baselines and atomically swaps only a complete, hash-verified revision.
- Global promotion always requires explicit human approval.
- Reload failure restores the previous pointer.
- Disabled/manual mode causes no automatic LLM calls.
- Evolution failure cannot break a normal Catui session.

## Findings

| Finding | Decision | Status |
|---|---|---|
| [SE01](./findings/SE01-trust-boundary.md) | Extension-owned declarative trust boundary | accepted |
| [SE02](./findings/SE02-persistence-and-concurrency.md) | Immutable revisions plus optimistic atomic pointer | accepted |

## Deferred Boundary

Executable artifacts, unattended global promotion, cross-device synchronization, destructive pruning, and model-weight training require separate reviews.
