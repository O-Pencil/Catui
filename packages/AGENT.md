# packages/ -- Bundled Published Packages

> P2 | Parent: ../AGENT.md

---

## Overview

The `packages/` directory now contains only bundled packages that remain outside
the internal `core/lib/` library layer after the phase-one skeleton move.

`@pencil-agent/ai`, `@pencil-agent/agent-core`, and `@pencil-agent/tui` were moved
to `core/lib/{ai,agent-core,tui}` and remain private workspace libraries.

---

## Member List

### mem-core/

Persistent memory package used by the built-in memory extension and runtime
integration.

Key files:

`src/index.ts`: Package entry point.

`src/extension.ts`: Extension adapter loaded as the NanoMem built-in package.

`src/engine*.ts`, `src/store*.ts`, `src/types*.ts`: Memory engine, storage, and
type surfaces.

### soul-core/

AI personality package used by `core/soul-integration.ts` and the built-in Soul
extension.

Key files:

`src/index.ts`: Package entry point.

`src/manager.ts`: Soul manager implementation.

`src/config.ts`, `src/store.ts`, `src/types.ts`: Configuration, persistence, and
type surfaces.

---

## Boundary Rule

`packages/` packages are still package-shaped integration surfaces. Internal
non-published libraries belong under `core/lib/`.
