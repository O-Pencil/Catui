# SP04 — Ship CLI-First and Defer the SDK Surface

## Evidence

The existing interactive CLI already persists the active persona, forks the session branch, configures persona-specific memory, Soul, MCP, and Skill paths, and reloads the runtime. A per-session SDK option would additionally require explicit precedence and concurrency semantics against global persona state.

## Decision

- Reuse `/persona`, `/persona list`, and `/persona use vera`.
- Do not add a Vera-specific command or a new CLI flag in this change.
- Existing print/RPC sessions inherit the persisted active persona through normal resource loading.
- Do not add `personaId` to `CreateAgentSessionOptions` or `catui-protocol` until a real SDK or Workbench consumer needs process-local or concurrent persona selection.

## Reopen conditions

Reopen when a Workbench, server, or SDK consumer needs two personas concurrently or needs a non-persistent per-run persona override.
