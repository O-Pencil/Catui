# SE03 Promotion Gates

severity: high

## Finding

Trace replay and deterministic eval exist, but a full champion-vs-candidate eval
adapter is larger than the first safe vertical slice.

## Decision

Manual promotion is allowed only after static validation in this slice. Automatic
promotion and replay/eval-gated promotion remain deferred.

## Verification

Candidate creation records validation evidence; `promote` refuses quarantined or
rejected candidates.

