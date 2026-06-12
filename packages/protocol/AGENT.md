# packages/protocol/

> P2 | Parent: ../AGENT.md

Public protocol package for NanoPencil extensions and first-party published
integrations. This package owns only contracts that cross a publish boundary.
Host-only rich runtime, UI, and session-control types remain in `core/`.

## Member List

`src/index.ts`: Public barrel for `@pencil-agent/protocol`; re-exports protocol
domains.

`src/tools.ts`: Tool runtime, permission, result, update callback, and
registration contracts.

`src/lifecycle.ts`: Minimal extension lifecycle API, context, UI affordances,
session-manager contract, hook handler, factory, and extension flag contracts.

`src/commands.ts`: Slash command registration, command handler, and argument
completion contracts.

`src/hooks.ts`: Public lifecycle hook-name vocabulary and generic hook handler
contract; rich event payloads remain host-owned.

## Boundary Rule

Add a type here only when a published package or third-party extension needs it.
If a type is only shared inside the host, keep it in the owning host module. If a
consumer needs a richer shape, extend the protocol contract locally rather than
writing host-specific requirements back into protocol.

[COVENANT]: Keep this member list aligned with `src/` and
`.dev-docs/architecture-review/sdk-surface-review/protocol-inventory.md`.
