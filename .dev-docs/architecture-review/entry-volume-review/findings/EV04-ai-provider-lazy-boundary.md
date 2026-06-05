# EV04: AI Provider Lazy Loading Must Preserve Provider Semantics

```yaml
id: EV04
status: selected-runtime-first
severity: high
scope:
  - core/lib/ai/src/models.generated.ts
  - core/lib/ai/src/models.ts
  - core/lib/ai/src/providers/*
  - core/model-registry.ts
classification: provider loading
decision: Q6
```

## Problem

F07 identifies provider/model metadata as a major size and startup cost. But provider loading is behavior-sensitive:

- model availability must remain correct
- API-key and OAuth fallback must remain correct
- custom provider registrations must remain correct
- token usage reporting must remain correct
- provider-specific error messages must remain recognizable

Lazy loading the wrong layer can create subtle regressions.

## Verdict — SELECTED

Separate three concerns before implementation:

```text
model metadata catalog
provider runtime implementation
configured provider selection
```

P6 may pursue lazy loading only after defining which layer is lazy.

Recommended direction:

- keep a small provider index eagerly available
- load provider-specific model metadata/runtime on demand
- preserve `ModelRegistry` behavior as the compatibility surface

Do not create a broad provider service that changes model selection semantics.

## Resolution Slice — Runtime First

Provider lazy loading is split into two separate slices:

1. **Runtime lazy resolver**: lazy-load provider implementation modules from `stream()/complete()` by `model.api`, while keeping the public `stream()` return shape synchronous.
2. **Metadata chunking**: split `models.generated.ts` by provider through `scripts/generate-models.ts`, while preserving `getModel()`, `getModels()`, and `getProviders()` compatibility.

The first implementation slice should be runtime lazy only. `getModel()` / `getModels()` / `ModelRegistry` must remain synchronous in P6.

Detailed matrix: [provider-lazy-matrix.md](../provider-lazy-matrix.md)

## Boundary Rules

- `ModelRegistry` remains the compatibility surface for modes/runtime.
- `getModel()`, `getModels()`, and `getProviders()` remain synchronous in P6.
- `stream()` must continue returning an event stream synchronously; async import must be bridged internally.
- Lazy loading must not change token usage accounting or request payloads.
- Custom providers and extension-registered providers must keep their registration path.
- Missing provider modules must produce actionable errors, not silent disappearance.
- Provider tests/smoke require a capable machine and provider matrix.

## Acceptance

- Existing configured providers still appear where they appeared before.
- No provider is considered unavailable solely because its module has not yet been imported.
- OAuth/env/auth/custom-provider fallback remains equivalent.
- Token usage and errors remain equivalent for smoke providers.
