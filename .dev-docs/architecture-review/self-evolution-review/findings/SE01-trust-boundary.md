# SE01 — Generated Artifact Trust Boundary

**Status:** accepted

## Risk

Treating generated artifacts like built-ins or explicit user resources would erase provenance, make precedence ambiguous, and allow unreviewed model output to become executable behavior.

## Decision

The optional evolution extension owns generation and activation. Candidate and quarantine directories are never resource roots. Only promoted revision directories may be consumed, and v1 artifacts remain declarative. Evolved IDs use the `evolved:<kind>:<id>` namespace and cannot silently shadow built-in or explicit resources.

## Mechanical Gate

`resources_discover` returns paths found through active revision manifests only. Tests must prove candidate/quarantine paths and executable artifact declarations are rejected.
