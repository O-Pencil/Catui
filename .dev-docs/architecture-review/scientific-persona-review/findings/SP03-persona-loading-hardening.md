# SP03 — Harden Generic Persona Loading Before Adding Vera

## Evidence

- The bundled asset path currently matches compiled layout but not direct source execution.
- Persona prompt classification checks only `/personas/`, so Windows paths can fall into project context.
- Selecting an unknown ID creates an empty persona directory before the interactive existence check.
- The persona P2 omits a shipped Lilith asset.

## Decision

- Resolve bundled personas from the first valid source-layout or distribution-layout candidate.
- Treat a persona as selectable only when its directory contains `CATUI.md`.
- Validate before writing `persona.json`; never create a directory for an unknown selection.
- Normalize path separators only for prompt classification, without rewriting stored paths.
- Cover source discovery, invalid selection, preservation of customized files, and Windows/POSIX prompt placement with tests.

## Deferred inconsistency

Runtime currently falls back to Vex while the P2 calls Pencil the default, and the legacy rename maps `default` to a missing `catui` persona. Changing those semantics could alter all users' startup identity, so this review records but does not silently resolve that product decision.
