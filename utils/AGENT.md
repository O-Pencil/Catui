# utils

> P2 | Cross-cutting helpers that do not belong to a single subsystem

## Responsibility

Small, dependency-light helpers with no subsystem of their own. Nothing here
owns state or a lifecycle; each file is a pure helper, or — for
`startup-profiler.ts` and `warning-guard.ts` — a narrowly-scoped installable
called once from `main.ts`.

Two things belong here: helpers with callers in more than one layer
(`diagnostics.ts`, `frontmatter.ts`, `mime.ts`, `photon.ts`), and boot-sequence
instrumentation that `main.ts` needs but no subsystem owns
(`startup-profiler.ts`, `warning-guard.ts`).

**Known tension, not yet resolved:** `changelog.ts` and `git.ts` each have
exactly one caller (`modes/interactive/controllers/info-command-handlers.ts`
and `core/package-manager.ts` respectively). By a strict "must span two layers"
rule they would sit next to those callers instead. They are here because the
functions are generic and already unit-shaped, not because a caller map demands
it. If you touch either file, the first question is whether it should move.

## Member List

- `changelog.ts`: parseChangelog(), compareVersions(), ChangelogEntry — parses CHANGELOG.md into ordered entries for the version display and release tooling
- `diagnostics.ts`: reportDiagnostic(), subscribeDiagnostics(), isDevRuntime(), DiagnosticEvent — the diagnostic event bus every layer reports to instead of writing to stderr
- `frontmatter.ts`: parseFrontmatter(), stripFrontmatter() — YAML frontmatter for AGENT.md and persona files; depends on `yaml`
- `git.ts`: parseGitUrl(), isGitSource(), getGitCloneUrl(), GitSource — normalises the several git URL spellings MCP and extension sources arrive in
- `mime.ts`: detectSupportedImageMimeTypeFromFile(), isImageMimeType() — single point where an image attachment is accepted or rejected by the model layer
- `photon.ts`: resizeImageWithPhoton(), loadPhoton(), PhotonImageType — lazy-loads the optional native photon-node binding and returns null when absent, so resizing degrades instead of crashing
- `startup-profiler.ts`: profileCheckpoint(), getCheckpoints(), getProfileReport(), exportProfile() — named boot checkpoints behind the startup benchmark and /doctor timing output; called once from main.ts
- `warning-guard.ts`: installWarningGuard() — mirrors Node process warnings onto the diagnostics bus so deprecations surface in /diagnostics; called once from main.ts

## Invariants

- **No cross-imports into `utils/`.** A helper that needs `core/` state is not a
  utility; it belongs in the subsystem that owns that state. The one deliberate
  exception is `warning-guard.ts` → `diagnostics.ts`, which is a sibling import
  inside this directory.
- **`photon.ts` and `mime.ts` fail soft.** Both are optional-capability helpers
  and must return null rather than throw when the underlying native module or
  file type is unavailable.
- **No default-config reads.** Nothing here reads `settings.json` or environment
  configuration to decide behaviour; that belongs in `core/platform/config/`,
  which passes the decision in.
