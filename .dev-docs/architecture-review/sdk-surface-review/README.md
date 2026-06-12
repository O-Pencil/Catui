# SDK Surface Review

```yaml
review_id: sdk-surface-review
phase: P8
status: root-narrowing-accepted
created_at: 2026-06-07
scope:
  - index.ts
  - package.json exports
  - packages/protocol
  - core/extensions-host/types.ts
  - modes/index.ts
  - modes/interactive/components/index.ts
```

## Purpose

P8 reviews whether the root package entry `@pencil-agent/nano-pencil` should remain a broad barrel or narrow to a stable SDK surface. It now also owns the non-breaking precursor: generating the stable public protocol contract in `@pencil-agent/protocol`.

Root narrowing remains a major-window API decision. Protocol slicing is allowed before that because host re-exports / extends the protocol contracts and preserves existing root behavior.

> 📋 **Executable scope**: [`P8-execution-scope.md`](./P8-execution-scope.md).
> Current protocol slice inventory: [`protocol-inventory.md`](./protocol-inventory.md).
> Root export destination matrix: [`public-api-matrix.md`](./public-api-matrix.md).
> Migration guide: [`migration-guide.md`](./migration-guide.md).

## Current Problem

The root `index.ts` exports too many categories through one path:

```text
@pencil-agent/nano-pencil
  -> host embedding SDK
  -> extension protocol types
  -> runtime internals
  -> tools and session internals
  -> interactive modes
  -> TUI components
  -> theme utilities
  -> CLI main
  -> platform/config helpers
```

That makes the root entry both:

- a public SDK for external consumers.
- a compatibility barrel for internal implementation details.

P2/P6 already removed internal root-barrel cycles and added AI subpaths. P8 is the remaining public API decision.

## Surface Taxonomy

| Category | Examples Today | Recommended Future Owner |
|----------|----------------|--------------------------|
| Stable host embedding SDK | `createAgentSession`, `PencilAgent`, `quickAgent`, logger types, session options | root `@pencil-agent/nano-pencil` |
| Stable extension / agent protocol | `ExtensionAPI`, `ExtensionContext`, tool contracts, lifecycle hooks, command contracts | `@pencil-agent/protocol` |
| App/runtime internals | `AgentSession`, `SessionManager`, `ResourceLoader`, compaction internals, `SettingsManager` | explicit subpaths only if intentionally supported |
| Tool factories | `createBashTool`, `bashTool`, `codingTools`, read/edit/write factories | likely root or `@pencil-agent/nano-pencil/tools` after consumer review |
| Mode/UI implementation | `InteractiveMode`, `runPrintMode`, interactive components, theme internals | mode/UI subpaths, not root |
| CLI/internal utilities | `main`, shell utilities, clipboard, frontmatter helpers | not root stable SDK |

## Finding Set

| Finding | Status | Purpose |
|---------|--------|---------|
| [SK01](./findings/SK01-root-barrel-taxonomy.md) | reviewed | Classify root exports by stable SDK vs leaked implementation |
| [SK02](./findings/SK02-extension-sdk-ownership.md) | reviewed | Move extension protocol growth to `@pencil-agent/protocol` |
| [SK03](./findings/SK03-migration-strategy.md) | reviewed | Decide major-break vs deprecation strategy |
| [public-api-matrix](./public-api-matrix.md) | signed-off | Per-export destination before root narrowing |
| [migration-guide](./migration-guide.md) | signed-off | External migration wording before implementation |

## Review Verdict

P8 proceeds in two gates:

```text
Gate 1: protocol slicing
  -> non-breaking
  -> move only cross-publish contracts into @pencil-agent/protocol
  -> host keeps rich types and re-exports/extends protocol contracts

Gate 2: root narrowing
  -> accept intentional public API diff
  -> update sign-off S-1 to record breaking API changes
  -> require migration guide + external consumer smoke
```

Current decision: Gate 2 is accepted for the 2.0 beta major window. Root narrowing ships as a
hard beta break, with migration documentation and explicit subpaths for retained advanced APIs.

## Non-Goals

- Do not remove root exports without keeping the migration guide aligned.
- Do not put new protocol types in the host root entry; grow `@pencil-agent/protocol`.
- Do not treat UI components as stable root SDK unless a consumer contract proves they are required.

## Acceptance If Implemented Later

- Root exports shrink only according to the accepted taxonomy.
- `@pencil-agent/protocol` is the only growing public protocol package.
- External consumers have migration paths.
- `package.json` exports provide explicit subpaths for any retained non-root public surface.
- `npm run wiki:all` public symbol diff is intentional and documented.
- Gateway/native-host smoke passes against the selected API shape.
