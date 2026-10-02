# README and product naming review

Status: complete; five repository gates passed. See [closure](closure.md).

## Scope and ownership

Refresh both README headers from the supplied RedNote blue risograph template.
Documentation and artwork belong in `docs/` and `assets/readme/`; the optional
simplify extension owns its local API parameter naming. Auth storage owns its
concurrency comment. No runtime behavior, public API, dependencies or prompts change.

## Decision

Replace the outdated upstream design essay with current Catui design principles.
Retain accurate upstream provenance, licenses, historical changelog entries and
research citations. Renaming a dependency or erasing attribution is not branding.
Keep historical architecture evidence available rather than relabeling another
project's examples as original Catui work.

## Acceptance

Visually inspect the generated banner, verify both README paths, run the five
repository gates and inspect the diff for unintended behavioral changes.
