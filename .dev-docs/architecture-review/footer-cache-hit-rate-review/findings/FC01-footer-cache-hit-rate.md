# FC01 Footer Cache Hit Rate

## Finding

The interactive footer already aggregates `cacheRead` and `cacheWrite`, but only renders input, output, cost, and context usage. Users cannot see cache effectiveness without opening `/usage`, and `/usage` reports cache token totals rather than a hit-rate percentage.

## Decision

Render a compact `NN%` token-stat segment in the footer.

## Rationale

The footer is the lowest-friction surface for a fast operational signal. A percentage is easier to scan than raw cache token counts and can be derived from existing usage fields without new runtime coupling.
