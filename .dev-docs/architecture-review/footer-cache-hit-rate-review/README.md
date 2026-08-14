# Footer Cache Hit Rate Review

```yaml
status: active
scope: modes/interactive/components/footer.ts
trigger: TUI user path change
decision: Show a compact unlabeled cache hit percentage in the existing footer token stats area.
```

## Scope

Add a small unlabeled cache hit-rate indicator to the interactive TUI footer. This is an interface-only change: it reuses assistant message usage already stored in the current session branch and does not change model calls, prompt content, persistence format, public API, or extension contracts.

## Boundary

- Owner: `modes/interactive/components/footer.ts`
- Data source: existing `entry.message.usage.cacheRead` and `entry.message.usage.input`
- Display rule: show only when token stats are enabled and there is a non-zero cache denominator.
- Formula: `cacheRead / (input + cacheRead)`

## Acceptance

- Footer rendering test covers the percentage.
- Existing footer behavior remains width-clamped through `renderFooterLine()` and `truncateToWidth()`.
- Run focused test plus relevant verification commands.
