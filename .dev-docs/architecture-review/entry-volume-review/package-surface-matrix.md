# EV05 Package Surface Matrix

```yaml
review_id: entry-volume-review
finding: EV05
classification: package surface
status: subpaths-validated-internal-migration-started
created_at: 2026-06-04
decision: Q3
```

## Scope

EV05 reviews whether P6 may change package exports, root barrels, package `files`, or public import paths while reducing entry/startup cost.

This review is triggered by EV04: provider runtime lazy loading now exists behind `core/lib/ai/src/stream.ts`, but `@pencil-agent/ai/index.ts` still re-exports provider runtime modules for public compatibility.

## Current Surface

```text
root package @pencil-agent/nano-pencil
  package.json exports:
    "." -> dist/index.js

workspace package @pencil-agent/ai
  package.json:
    main  -> dist/index.js
    types -> dist/index.d.ts
    no explicit exports map

core/lib/ai/src/index.ts
  re-exports:
    api-registry
    env-api-keys
    models
    stream
    provider runtime modules
    register-builtins
    types
    event-stream/json/oauth/overflow/typebox/validation utilities
```

## Evidence

Static search shows broad internal use of `@pencil-agent/ai` root imports across runtime, modes, tests, CLI helpers, session compaction, MCP, and bundled extensions.

Most internal call sites need one of these stable groups:

- `types`: `Model`, `Message`, `AssistantMessage`, `ImageContent`, `Usage`, `Transport`
- `models`: `getModel`, `getModels`, `getProviders`, `modelsAreEqual`, `supportsXhigh`
- `stream`: `complete`, `completeSimple`, `stream`, `streamSimple`
- `oauth`: `getOAuthProviders`, `registerOAuthProvider`, OAuth types
- `schema/util`: `Type`, `StringEnum`, `validateToolCall`, `EventStream`, `isContextOverflow`

Provider runtime functions such as `streamAnthropic` are documented in `core/lib/ai/README.md` as public root imports, but repository tests mostly import provider modules directly through `../src/providers/*`.

## Decision Matrix

| Option | Public compatibility | Startup/import benefit | Implementation risk | EV05 verdict |
|--------|----------------------|------------------------|---------------------|--------------|
| A. Remove provider exports from `@pencil-agent/ai` root now | Breaking | High for root imports | High | Reject for P6 |
| B. Keep root as-is and stop here | Safe | EV04 benefits only direct `stream.ts` path; root barrel remains eager | Low | Acceptable but incomplete |
| C. Add explicit subpath exports, keep root legacy, migrate internal imports gradually | Compatible | High for internal nanoPencil paths once migrated | Medium | Selected |
| D. Add subpaths and immediately narrow root | Breaking unless major/P8 | High | High | Defer to P8 |
| E. Split package `files` or move provider assets now | Packaging risk | Possible size benefit | High | Defer until package snapshot review |

## Q3 Resolution

P6 should not narrow `@pencil-agent/ai` root exports.

Selected path:

```text
1. Keep @pencil-agent/ai root barrel as legacy-compatible.
2. Add explicit subpath exports in a dedicated implementation slice.
3. Migrate nanoPencil internal imports from root to subpaths by capability group.
4. Leave external deprecation/removal for P8 or a breaking-change release.
```

Candidate subpath groups:

```text
@pencil-agent/ai/models
@pencil-agent/ai/stream
@pencil-agent/ai/types
@pencil-agent/ai/schema
@pencil-agent/ai/oauth
@pencil-agent/ai/events
@pencil-agent/ai/registry
@pencil-agent/ai/env
@pencil-agent/ai/overflow
@pencil-agent/ai/json
@pencil-agent/ai/providers/anthropic
@pencil-agent/ai/providers/openai-completions
@pencil-agent/ai/providers/openai-responses
@pencil-agent/ai/providers/openai-codex-responses
@pencil-agent/ai/providers/google
@pencil-agent/ai/providers/google-gemini-cli
@pencil-agent/ai/providers/google-vertex
@pencil-agent/ai/providers/amazon-bedrock
@pencil-agent/ai/providers/azure-openai-responses
```

The provider subpaths preserve direct provider access without forcing every root import to load provider runtime modules after internal migration.

## Implementation Guardrails

- Do not remove or rename root exports in P6.
- Do not change root package `@pencil-agent/nano-pencil` exports in the same slice as `@pencil-agent/ai` subpaths.
- Do not change package `files` until a package content snapshot exists.
- Internal import migration must be grouped by capability, not scattered opportunistically.
- Type-only imports should move to `@pencil-agent/ai/types` first because they are the widest and least behavior-sensitive.
- Runtime imports (`completeSimple`, `getModel`, `getOAuthProviders`) should move after subpath build output is verified.
- Provider runtime direct imports should use provider subpaths only in tests/docs or explicit provider-level integrations.

## Acceptance For Future Code Slice

Before code:

- Root public API snapshot is recorded.
- Current package `files` / dist contents snapshot is recorded.
- Subpath export map is reviewed as additive only.

After code:

- `npm run build` passes on capable machine.
- `npm run verify:quality` passes.
- Internal root imports are reduced without changing runtime behavior.
- `@pencil-agent/ai` root import still works for documented examples.
- New subpath imports resolve from built `dist` and generated declarations.

## Residual Risks

- Keeping root legacy means external consumers still pay root-barrel eager cost if they import `@pencil-agent/ai`.
- Adding subpath exports may affect Node package resolution for consumers that rely on undocumented deep imports.
- Internal import migration can be noisy; it should be split into small commits by capability group.
- Metadata cost from `models.generated.ts` remains EV04 metadata-slice work, not EV05 package-surface work.

## Implementation Result

Additive `@pencil-agent/ai/*` subpaths have been added while preserving the root entry. Maintainer confirmed build/quality validation passed. Internal import migration started with type-only imports and is continuing by capability group. Type-only, models, OAuth, registry, events, and schema slices have passed maintainer build/quality validation; the current code slice adds `env`, `overflow`, and `json` helper subpaths and moves the remaining internal runtime helper imports off the root barrel.
