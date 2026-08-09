# SE02 Trust Boundary

severity: blocking

## Finding

Agent-generated artifacts are untrusted data. Mixing them with built-in extension
source, user skills, or workspace files would make precedence and rollback
ambiguous.

## Decision

Persist all generated artifacts under `<agentDir>/evolution/v1/` and require
`evolved:<kind>:<id>` namespacing.

## Verification

Validation rejects path escapes, executable content, unnamespaced IDs, and
unsupported schema versions.

