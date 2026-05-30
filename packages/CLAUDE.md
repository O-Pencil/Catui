# packages/ -- Bundled Published Packages

> P2 | Parent: ../CLAUDE.md

---

## Overview

The `packages/` directory contains only package-shaped integration surfaces that
remain outside `core/lib/` after the phase-one skeleton move.

Moved to `core/lib/`:

- `@pencil-agent/ai` -> `core/lib/ai`
- `@pencil-agent/agent-core` -> `core/lib/agent-core`
- `@pencil-agent/tui` -> `core/lib/tui`

Still under `packages/`:

- `mem-core`
- `soul-core`

---

## Member List

`mem-core/`: Persistent memory package and NanoMem extension adapter.

`soul-core/`: Personality manager package used by Soul integration.

---

## Boundary Rule

Keep package-shaped cognitive integrations here. Keep private internal libraries
under `core/lib/`.
