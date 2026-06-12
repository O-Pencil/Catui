# @pencil-agent/protocol

Stable protocol contracts for NanoPencil extensions — the single, versioned surface a
third-party extension (or the bundled `mem-core` / `soul-core` packages) depends on,
instead of reaching into the host package `@pencil-agent/nano-pencil`.

It is NanoPencil's analogue of Continue's `continue-sdk`: the **only "increment, don't
break" growth surface** for the protocol, so future protocol additions never force a host
major bump (see `.dev-docs/architecture-review/evolution/dev-conventions.md`).

## Protocol modules (P3 scope)

| Module | Contract | Status |
|--------|----------|--------|
| `tools` | tool runtime/permission seam (S1) | ✅ landed |
| `commands` | slash-command registration + argument-completion contract | ✅ landed |
| `themes` | theme contract | ⏳ P3.1 (extract from host) |
| `hooks` | lifecycle event vocabulary | ⏳ P3.1 |
| `permissions` | third-party permission model | ⏳ P3.1 |
| `lifecycle` | `ExtensionAPI` / `ExtensionContext` / `ExtensionFactory` + `SessionManagerContract` (S3) | ✅ minimal landed |

## Explicitly NOT here (EVOLUTION-RESERVED)

`agent-profile`, `host-adapter` (ACP re-export), `tool-runtime` (MCP re-export),
`a2a-bridge`, memory/soul providers — deferred to the evolution roadmap; this round only
reserves the S1/S2/S3 seam shapes. See `evolution/PARP.md §6`.
