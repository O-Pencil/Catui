# AI Package Layer Review

```yaml
review_id: ai-package-layer-review
parent: ../README.md
phase: P6
status: subpaths-implemented-validation-pending
created_at: 2026-06-04
scope:
  - core/lib/ai
  - core/lib/agent-core
  - core/lib/tui
  - packages/mem-core
  - packages/soul-core
  - packages/extension-sdk
related:
  - ../package-surface-matrix.md
  - ../provider-lazy-matrix.md
```

## Purpose

EV05 selected additive `@pencil-agent/ai/*` subpaths, but subpaths should not simply mirror today's file layout. A subpath becomes a long-lived dependency boundary. This review decides what the AI package should own before the package surface is made more explicit.

## External Calibration

This review used primary/public project material as calibration, not as a source of truth for nanoPencil:

- `pi-book` describes pi-mono as an architecture-decision book, with separate topics for unified LLM vendors, agent loop, product runtime, built-in vs external capabilities, tools, and terminal/browser/RPC entrypoints: https://github.com/ZhangHanDong/pi-book
- `pi-mono` exposes package-level separation: `pi-ai` for unified multi-provider LLM API, `pi-agent-core` for agent runtime, `pi-coding-agent` for CLI, `pi-tui` for terminal UI, and `pi-web-ui` for web components: https://github.com/earendil-works/pi
- `pi-rs` advertises multi-provider LLM support, tool system, session management, skills, TUI, context compaction, and extension system as separate feature domains: https://github.com/jshachm/pi-rs
- Hermes Agent separates model choice, CLI/messaging gateway, tools/toolsets, skills, memory, MCP, cron, terminal backends, and security in its public docs/repo structure: https://github.com/NousResearch/hermes-agent
- OpenClaw was considered as a category reference for personal-agent gateway scope, but not used as a primary package-structure authority because current search results surface multiple unofficial/secondary sites and the code source is ambiguous.

Calibration outcome:

```text
LLM provider abstraction belongs in an AI package.
Agent loop/runtime/session/tool execution belongs outside the AI package.
TUI/web/messaging entrypoints belong outside the AI package.
Memory/personality systems belong outside the AI package, connected through explicit host callbacks.
```

## Current nanoPencil Package Shape

```text
@pencil-agent/ai
  core/lib/ai/src
  42 source files
  26k lines total
  major cost centers:
    models.generated.ts       14,505 lines
    provider runtime files     ~6,800 lines
    OAuth provider files       ~2,300 lines
```

Current natural groups:

| Group | Files | Current role |
|-------|-------|--------------|
| contracts | `types.ts` | LLM boundary data contracts: messages, content, model, usage, tools, stream event types |
| catalog | `models.ts`, `models.generated.ts` | Built-in model metadata and catalog helpers |
| runtime facade | `stream.ts` | Unified `stream/complete` facade with retry and lazy provider resolution |
| provider registry | `api-registry.ts`, `providers/register-builtins.ts` | Provider registration and lazy built-in runtime loading |
| provider runtimes | `providers/*` | Direct API implementations for Anthropic/OpenAI/Google/Bedrock/etc. |
| OAuth | `utils/oauth/*` | Login/discovery/refresh primitives for OAuth-backed providers |
| schema/events/utils | `utils/typebox-helpers.ts`, `utils/validation.ts`, `utils/event-stream*`, `utils/overflow.ts`, `utils/json-parse.ts`, `utils/sanitize-unicode.ts` | Shared LLM-facing helpers |
| package support | `env-api-keys.ts`, `debug-logger.ts`, `config-path.ts`, `cli.ts` | Env/API-key lookup, provider debug logs, package CLI |

## Ownership Decision

### Belongs In `@pencil-agent/ai`

| Capability | Why |
|------------|-----|
| LLM message/content/tool/result contracts | These are the wire-level and model-facing contracts shared by agent-core, runtime, modes, tools, and tests |
| Model catalog metadata | It answers "which model exists and what is its API/provider/cost/context behavior"; this is LLM catalog knowledge |
| Unified stream/complete facade | It is the stable LLM invocation boundary used by runtime and extensions |
| Provider registry and provider runtime loading | Extensions/custom providers need a provider registration seam independent from AgentSession |
| Direct provider implementations | They are low-level LLM adapters, not agent runtime logic |
| OAuth provider primitives | Login/refresh protocols are provider-auth capabilities; storage/UI remains outside |
| LLM payload validation and TypeBox helpers | They define tool schema and tool-call validation at the LLM boundary |
| Event stream contracts/classes | Agent-core consumes stream events, but the event shape is produced by LLM providers |
| Context overflow detection | It interprets provider/model error messages and belongs near provider semantics |

### Does Not Belong In `@pencil-agent/ai`

| Capability | Owner | Reason |
|------------|-------|--------|
| Agent loop, tool orchestration, tool-result budgeting | `@pencil-agent/agent-core` | It is policy over messages/tools, not provider transport |
| AgentSession, model switching state, compaction orchestration | `core/runtime` and `core/session` | Session lifecycle and persistence are app runtime concerns |
| TUI components, selectors, overlays, editor/input | `@pencil-agent/tui` and `modes/interactive` | UI should depend on AI contracts, not live inside AI |
| Long-term memory extraction/retrieval | `@pencil-agent/mem-core` | Memory is a domain system using host LLM callbacks |
| Soul/personality evolution and prompt injection | `@pencil-agent/soul-core` | Personality state is higher-level behavior over prompts/memory |
| Extension host APIs and UI adapters | `core/extensions-host` / `@pencil-agent/extension-sdk` | Extension protocol must not couple to provider internals |
| Auth storage/settings files | `core/platform/config` | Persistence and user config paths are app/platform policy |
| Prompt assembly/system prompt resources | `core/runtime` / `core/prompt` | Prompt policy is product/runtime-specific |

## Layer Model

Selected stable layers:

```text
@pencil-agent/ai/types
  pure contracts, no provider runtime, no catalog

@pencil-agent/ai/schema
  TypeBox re-exports/helpers and tool validation

@pencil-agent/ai/events
  EventStream and stream structural contracts

@pencil-agent/ai/models
  model catalog and cost/support helpers

@pencil-agent/ai/registry
  provider registration seam and built-in lazy resolver registration

@pencil-agent/ai/stream
  stream/complete facade and env API-key lookup

@pencil-agent/ai/oauth
  OAuth provider discovery/login/refresh primitives

@pencil-agent/ai/providers/*
  direct provider runtimes for advanced users/tests/provider-specific integrations

@pencil-agent/ai
  legacy compatibility barrel; not the preferred internal import path after migration
```

Dependency direction:

```text
types
  <- events
  <- schema
  <- models
  <- registry
  <- providers/*
  <- stream
  <- oauth

agent-core/runtime/modes/extensions
  depend on ai subpaths
  never reverse-import from ai
```

Allowed internal dependencies:

- `models` may depend on `types`.
- `providers/*` may depend on `types`, `events`, `models`, `schema/utils`, env API-key lookup, and provider-shared helpers.
- `stream` may depend on `types`, `events`, `registry`, `overflow`, and built-in provider loader registration.
- `oauth` may depend on `types` and, for GitHub Copilot model enumeration, `models`.

Risky dependencies to avoid:

- `types` importing anything heavy.
- `events` importing provider runtime or model catalog.
- `models` importing provider runtime.
- `oauth` importing provider stream runtime.
- `ai` importing agent-core, runtime, TUI, mem-core, soul-core, extension host, or config storage.

## Subpath Recommendation

Implement additive subpaths in this order:

| Order | Subpath | Backing source | Rationale |
|-------|---------|----------------|-----------|
| 1 | `@pencil-agent/ai/types` | `dist/types.js` | Widest usage, lowest behavior risk |
| 2 | `@pencil-agent/ai/events` | `dist/utils/event-stream.js` + type export for `event-stream-types` | Needed by agent-core without provider cost |
| 3 | `@pencil-agent/ai/schema` | `dist/utils/typebox-helpers.js`, `dist/utils/validation.js`, TypeBox re-exports | Tool schemas and validation, no provider runtime |
| 4 | `@pencil-agent/ai/models` | `dist/models.js` | Keeps model catalog explicit; still carries metadata cost |
| 5 | `@pencil-agent/ai/stream` | `dist/stream.js` | Unified invocation path; now provider-runtime lazy |
| 6 | `@pencil-agent/ai/oauth` | `dist/utils/oauth/index.js` | Login/discovery path, intentionally separate from provider stream runtime |
| 7 | `@pencil-agent/ai/registry` | `dist/api-registry.js`, optionally `dist/providers/register-builtins.js` | Extension/custom provider seam |
| 8 | `@pencil-agent/ai/providers/*` | `dist/providers/*.js` | Advanced direct-provider access; not for ordinary runtime imports |

Do not expose `debug-logger`, `config-path`, or `env-api-keys` as independent public subpaths in the first pass. Keep `getEnvApiKey` reachable through `stream`/root until a concrete external need appears.

## Internal Migration Order

1. Type-only imports:
   - `Model`, `Message`, `AssistantMessage`, `ImageContent`, `TextContent`, `Usage`, `Transport`, `OAuthProviderInterface`
   - move to `@pencil-agent/ai/types` or `@pencil-agent/ai/oauth` as appropriate.
2. Event/schema imports:
   - `EventStream`, `AssistantMessageEventStream`, `Type`, `StringEnum`, `validateToolCall`.
3. Model helpers:
   - `getModel`, `getModels`, `getProviders`, `modelsAreEqual`, `supportsXhigh`.
4. Stream helpers:
   - `complete`, `completeSimple`, `stream`, `streamSimple`, `getEnvApiKey`.
5. OAuth helpers:
   - `getOAuthProviders`, `registerOAuthProvider`, login/refresh helpers.
6. Provider-specific direct imports:
   - only tests/docs/provider-level integrations should use provider subpaths.

## Findings

| ID | Finding | Severity | Decision |
|----|---------|----------|----------|
| AI-L01 | `@pencil-agent/ai` currently mixes pure contracts, metadata catalog, provider runtimes, OAuth, and helpers through one root barrel | High | Add subpaths; keep root as legacy |
| AI-L02 | `types.ts` is correctly central and should remain the lowest layer | High | Make `types` the first subpath and forbid heavy imports into it |
| AI-L03 | `models.generated.ts` is the dominant metadata cost but belongs to catalog, not provider runtime | High | Keep in `models`; handle chunking in EV04 metadata slice |
| AI-L04 | OAuth belongs in AI, but OAuth storage/UI belongs outside AI | Medium | Expose `oauth` subpath; keep `AuthStorage` in platform config |
| AI-L05 | Provider runtime files are large and some exceed the 800-line guideline | Medium | Accept temporarily; provider-specific split can happen after package subpaths |
| AI-L06 | `debug-logger.ts` has TUI-named log methods but no TUI dependency | Low | Keep internal; rename only if a future cleanup touches it |

## Acceptance For Subpath Implementation

- Root `@pencil-agent/ai` remains compatible.
- New subpaths resolve from built `dist` and declarations.
- `types/events/schema` subpaths do not import provider runtimes or `models.generated.ts`.
- Internal root imports decrease in small commits by capability group.
- No code outside AI imports undocumented `@pencil-agent/ai/dist/*` paths.
- Build and `verify:quality` pass on a capable machine.

## Implementation Result

Additive subpath exports have been implemented for:

```text
@pencil-agent/ai/types
@pencil-agent/ai/schema
@pencil-agent/ai/events
@pencil-agent/ai/models
@pencil-agent/ai/registry
@pencil-agent/ai/stream
@pencil-agent/ai/oauth
@pencil-agent/ai/providers/*
```

Root `@pencil-agent/ai` remains legacy-compatible.

## Next Step

Validate build output on a capable machine, then start internal import migration by capability group. The first migration slice should be type-only imports.
