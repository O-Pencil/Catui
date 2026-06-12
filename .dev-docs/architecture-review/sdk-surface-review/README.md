# SDK Surface Review

```yaml
review_id: sdk-surface-review
phase: P8
status: review-open
created_at: 2026-06-07
scope:
  - index.ts
  - package.json exports
  - packages/extension-sdk
  - core/extensions-host/types.ts
  - modes/index.ts
  - modes/interactive/components/index.ts
```

## Purpose

P8 reviews whether the root package entry `@pencil-agent/nano-pencil` should remain a broad barrel or narrow to a stable SDK surface.

This review is intentionally **docs-only** for the current sign-off window. P8 implementation would create an intentional public API diff, so it must not be mixed into the current "functionally unchanged" sign-off unless maintainers explicitly choose a major-version API window.

> 📋 **Executable scope (per-symbol matrix + extension-sdk additions + rewire/republish + subpaths + migration guide)**: [`P8-execution-scope.md`](./P8-execution-scope.md) — ready for the 2.0 major window.

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
| Stable extension protocol | `ExtensionAPI`, `ExtensionContext`, tool contracts, lifecycle hooks | `@pencil-agent/extension-sdk` |
| App/runtime internals | `AgentSession`, `SessionManager`, `ResourceLoader`, compaction internals, `SettingsManager` | explicit subpaths only if intentionally supported |
| Tool factories | `createBashTool`, `bashTool`, `codingTools`, read/edit/write factories | likely root or `@pencil-agent/nano-pencil/tools` after consumer review |
| Mode/UI implementation | `InteractiveMode`, `runPrintMode`, interactive components, theme internals | mode/UI subpaths, not root |
| CLI/internal utilities | `main`, shell utilities, clipboard, frontmatter helpers | not root stable SDK |

## Finding Set

| Finding | Status | Purpose |
|---------|--------|---------|
| [SK01](./findings/SK01-root-barrel-taxonomy.md) | reviewed | Classify root exports by stable SDK vs leaked implementation |
| [SK02](./findings/SK02-extension-sdk-ownership.md) | reviewed | Move extension protocol growth to `@pencil-agent/extension-sdk` |
| [SK03](./findings/SK03-migration-strategy.md) | reviewed | Decide major-break vs deprecation strategy |

## Review Verdict

P8 can proceed as review in parallel with sign-off validation, but should not proceed as code in the same branch unless maintainers accept one of these:

```text
Option A: skip P8 for current sign-off
  -> preserve root API
  -> merge functionally unchanged refactor
  -> reopen P8 later as API-breaking work

Option B: implement P8 before 2.0 final
  -> accept intentional public API diff
  -> update sign-off S-1 to record breaking API changes
  -> require migration guide + external consumer smoke
```

Default recommendation for the current branch: **Option A**.

## Non-Goals

- Do not change `index.ts` during this review.
- Do not remove root exports without a migration guide.
- Do not put new protocol types in the host root entry; grow `extension-sdk`.
- Do not treat UI components as stable root SDK unless a consumer contract proves they are required.

## Acceptance If Implemented Later

- Root exports shrink only according to the accepted taxonomy.
- `@pencil-agent/extension-sdk` is the only growing extension protocol package.
- External consumers have migration paths.
- `package.json` exports provide explicit subpaths for any retained non-root public surface.
- `npm run wiki:all` public symbol diff is intentional and documented.
- Gateway/native-host smoke passes against the selected API shape.
