# Closure

- PR #1 merged to `main` at `2ca30f64137b74c2c59ef6a61e03a9449c398069` before this work.
- Both READMEs now share the generated blue risograph header based on the supplied
  Figma template. Artwork and the exact generation prompt are checked into assets.
- Replaced the obsolete upstream design essay with current Catui principles and
  an explicit provenance note; registered the guide and artwork in the root map.
- Renamed the simplify extension's local API parameter and corrected the auth
  concurrency comment. Existing P2/P3 responsibilities remain accurate.
- Historical architecture evidence, source citations, changelog entries, external
  integration detection and dependency names remain intentionally unchanged.

Validation: DIP, quality, static package boundary, full build and `tsc --noEmit`
passed. README asset references and `git diff --check` passed. Generated artwork
was visually inspected. No API, runtime behavior, prompt or LLM-call changes;
no new behavioral tests are warranted for a local parameter rename and comment.

Reopen if a current user-facing path still identifies Catui as another product,
or if a future template revision needs a different header composition.
