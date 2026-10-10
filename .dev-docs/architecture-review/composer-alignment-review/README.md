# Composer alignment review

Status: reviewed before implementation.

## Scope and ownership

Remove the composer's external left gutter so its box aligns with the full-width
message background. Retain the internal arrow, configurable padding, cursor,
wrapping and autocomplete behavior. Pet-side width allocation is outside scope.
The browser preview must use the same outer-box geometry.

This is mode-specific rendering: feature-workflow §2b decision 4 selects the
existing `modes/interactive/components/custom-editor.ts` owner. No new types,
extensions, protocol changes or dependencies are needed.

## Decision and acceptance

Reserve five columns for the framed input prefix and suffix instead of six.
Draw both horizontal edges from column zero through width minus one. Shift
autocomplete indentation with the input prefix. Keep the existing narrow fallback.
Verify exact first/last box columns alongside message backgrounds at 10–120
columns, cursor/wrapping/CJK and autocomplete behavior, then all five repository
gates and PR self-check. Preview changes are local artifacts outside the package.
