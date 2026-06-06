# BR03: Model Metadata Chunking Needs Metrics Before Generator Work

```yaml
id: BR03
status: selected-after-measurement
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

## Deletion Test

If we delete the generated monolith without a compatibility wrapper, model lookup complexity concentrates in every caller. If we hide provider chunking behind `getModel/getModels/getProviders`, callers should not care.

## Verdict

Selected only after BR01 and measurement. Generator-backed implementation only.

## Boundary Rules

- Preserve synchronous `getModel()`, `getModels()`, and `getProviders()` unless a separate public API review accepts async.
- Do not change model IDs, default provider/model selection, OAuth/env fallback, or token usage.
- Do not hand-edit generated model files.

## Acceptance

- generated output is deterministic.
- model catalog public behavior is unchanged.
- provider smoke matrix passes for at least configured representative providers.
- size/startup measurement justifies the added generator complexity.

