# packages/ -- Bundled Published Packages

> P2 | Parent: ../AGENT.md

---

## Overview

The `packages/` directory now contains only bundled packages that remain outside
the internal `core/lib/` library layer after the phase-one skeleton move.

`@catui/ai`, `@catui/agent-core`, and `@catui/tui` were moved
to `core/lib/{ai,agent-core,tui}` and remain private workspace libraries.

---

## Member List

### protocol/

Stable public protocol package (`catui-protocol`) for extensions and first-party published
integrations.

Key files:

`src/index.ts`: Package entry point.

`src/tools.ts`: Tool runtime, permission, tool result, and tool registration
contracts.

`src/lifecycle.ts`: Minimal extension lifecycle, context, API, and
session-manager contracts.

`src/commands.ts`: Slash command registration and argument-completion contracts.

`src/hooks.ts`: Hook event-name vocabulary.

`src/flags.ts`: Extension-declared CLI/config flag contracts.

### mem-core/

Persistent memory package (`catui-mem`) used by the built-in memory extension and runtime
integration.

Key files:

`src/index.ts`: Package entry point.

`src/extension.ts`: Extension adapter loaded as the NanoMem built-in package.

`src/engine*.ts`, `src/store*.ts`, `src/types*.ts`: Memory engine, storage, and
type surfaces.

### soul-core/

Suspended standalone AI personality package (`catui-soul`), retained for possible
reactivation. It is not a root workspace, application dependency, or build target.
The application uses persona; existing user Soul data is left untouched.

Key files:

`src/index.ts`: Package entry point.

`src/manager.ts`: Soul manager implementation.

`src/config.ts`, `src/store.ts`, `src/types.ts`: Configuration, persistence, and
type surfaces.

---

## Boundary Rule

`packages/` packages are still package-shaped integration surfaces. Internal
non-published libraries belong under `core/lib/`.
