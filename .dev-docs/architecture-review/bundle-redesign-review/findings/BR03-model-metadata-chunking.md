# BR03: Model Metadata Chunking Needs Metrics Before Generator Work

```yaml
id: BR03
status: reviewed-metrics-gated
severity: structural
classification: provider metadata
scope:
  - core/lib/ai/src/models.generated.ts
  - core/lib/ai/scripts/generate-models.ts
  - core/lib/ai/src/models.ts
  - core/model-registry.ts
```

## Problem

`models.generated.ts` is large and churn-heavy. P6 already moved provider runtime imports to lazy loading, but metadata remains eager and monolithic.

The original P7 proposal says "split into 11 provider files." That may be right, but it should not be done until we know whether the monolith materially affects:

- host tarball size
- cold-start path
- model registry sync APIs
- provider smoke stability

Current evidence:

- `core/lib/ai/src/models.generated.ts`: 14,505 lines, about 360K source.
- `core/lib/ai/dist/models.generated.js`: about 492K built JS.
- gzip estimate:
  - source: about 23K
  - built JS: about 26K
- provider count: 25 metadata provider keys.
- `core/lib/ai/src/models.ts` imports `MODELS` eagerly and builds an in-memory `Map` at module load.
- `ModelRegistry.loadBuiltInModels()` consumes `getProviders()` and `getModels(provider)` synchronously.
- OAuth/provider code and tests call `getModel()`/`getModels()` synchronously in many places.

This means BR03 is **not primarily a tarball-size win**. The published compressed-size delta is likely small. The real possible wins are:

- cold-start parse/compile cost if the model catalog is imported on startup.
- reducing generator churn by provider.
- keeping future provider metadata updates localized.

Those benefits are real only if startup metrics show `@pencil-agent/ai/models` on a hot path where parse cost matters.

## Deletion Test

If we delete the generated monolith without a compatibility wrapper, model lookup complexity concentrates in every caller. If we hide provider chunking behind `getModel/getModels/getProviders`, callers should not care.

## Verdict

Do not split because the file is 14k lines. Split only if metrics show startup/parse cost or generator churn is worth the added catalog complexity.

If BR03 proceeds, it must be generator-backed and behavior-neutral:

```text
models.generated.ts            # compatibility index / aggregate export
models.generated/<provider>.ts # generated provider chunks
models.ts                      # keeps sync getModel/getModels/getProviders
```

The split must preserve the current synchronous API. Async catalog loading is rejected for this phase.

## Boundary Rules

- Preserve synchronous `getModel()`, `getModels()`, and `getProviders()` unless a separate public API review accepts async.
- Do not change model IDs, default provider/model selection, OAuth/env fallback, or token usage.
- Do not hand-edit generated model files.
- Do not split provider runtime and model metadata concepts: EV04 already handled runtime lazy loading; BR03 is metadata only.
- Do not make `ModelRegistry` construction async.
- Do not change `KnownProvider` / `KnownApi` public typing as a side effect of chunking.
- Do not claim install-size reduction unless `npm publish --dry-run` before/after data proves it.

## Design Options

| Option | Benefit | Cost/Risk | Verdict |
|--------|---------|-----------|---------|
| Keep monolith | lowest behavior risk; simplest generator; current API stable | large generated file, provider churn touches one file, eager parse remains | acceptable default |
| Generated provider chunks + sync aggregate index | localizes generated churn; can preserve current API/types | still imports all chunks if aggregate imports all providers; size gain small | acceptable if metrics justify |
| Lazy async provider chunk import | could avoid parsing unused provider metadata | breaks sync `getModel/getModels`; wide public/runtime churn | reject now |
| JSON metadata loaded at runtime | data/code separation; potential parse control | loses TypeScript `satisfies Model<>` checks unless extra validation added; runtime file IO/path issues | reject for P7 |
| Hand-maintained per-provider files | readable locally | violates generated-source invariant and creates drift risk | reject |

## Measurement Gate

Before implementation, capture on a capable machine:

```text
M1: cold `nanopencil -v` or equivalent startup timing before/after.
M2: import timing for `@pencil-agent/ai/models` and `@pencil-agent/ai/stream`.
M3: `npm publish --dry-run --tag beta` package file sizes before/after.
M4: generated file churn: number of files touched by one provider metadata update.
```

Proceed only if M1/M2 show meaningful startup/import cost or maintainers explicitly value generator churn reduction enough to accept added generated files.

## Implementation Shape If Accepted

Generator output should be deterministic:

```text
core/lib/ai/src/models.generated/
  amazon-bedrock.ts
  anthropic.ts
  ...
  zai.ts
core/lib/ai/src/models.generated.ts
  imports provider constants
  exports MODELS aggregate with same type shape as today
```

This intentionally does **not** reduce eager metadata import cost by itself if the aggregate imports every provider chunk. It is a low-risk first step for churn isolation and compatibility.

Only a later, separate review may introduce a lazy catalog facade. That review would need to redesign the public sync API or add new async APIs without changing existing ones.

## Acceptance

- generated output is deterministic.
- model catalog public behavior is unchanged.
- provider smoke matrix passes for at least configured representative providers.
- size/startup measurement justifies the added generator complexity.
- `getModel()`, `getModels()`, `getProviders()`, `calculateCost()`, `modelsAreEqual()`, and `supportsXhigh()` keep their signatures.
- `ModelRegistry` custom model merge/override behavior is unchanged.
- OAuth model modification paths still see the same built-in models.
- Type declarations for `@pencil-agent/ai/models` remain compatible.
