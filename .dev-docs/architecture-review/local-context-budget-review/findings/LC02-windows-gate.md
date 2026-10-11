# LC02 — Windows paths must match portable baseline keys

Pre-push exposed 44 purported new oversized files. Their paths used backslashes,
while the unchanged structural baseline uses forward slashes. `toRepoPath()` in
`scripts/verify-structure.ts` removed a leading separator but did not normalize
internal separators, unlike verify-dip. Test-workspace exemptions failed for the
same reason.

Reviewed decision before implementation: normalize repository-relative paths to
forward slashes at their existing owner. Preserve size thresholds, exemptions,
baseline contents and hook behavior. This is a local build-gate repair necessary
for delivery on native Windows, not a structural debt exemption.

Acceptance: isolated repository fixtures prove existing debt and exempt test files
pass, while a new oversized production file still exits 1. Rerun the pre-push gates.
