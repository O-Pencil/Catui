# Tool Registry Review

```yaml
review_id: tool-registry-review
status: accepted-and-implemented
created_at: 2026-08-07
scope:
  - core/tools/tool-name.ts
  - core/tools/tool-registry.ts
  - core/tools/orchestrator.ts
  - core/runtime/tool-runtime-controller.ts
  - core/extensions-host/loader.ts
  - core/extensions-host/runner.ts
```

## Purpose

Prevent silent tool replacement before a model request while preserving Catui's existing model-facing tool names and extension contracts.

## Decision

- Tool names receive an internal canonical key. Unqualified names use the `functions` namespace; explicitly qualified names retain their namespace.
- `AgentTool.name` remains unchanged, so prompts, tool calls, MCP adapters, active-tool settings, and extension APIs remain compatible.
- Strict collision detection is enabled by default. Same canonical name plus the same description shares the first tool instance; a different description fails registration.
- Batch registration and runtime replacement are transactional. Validation happens against staged state, and a failure leaves the previous runtime registry active.
- Extension loading preserves all cross-extension registrations until the central registry evaluates them. Same-extension conflicts fail at registration because the extension's local `Map` would otherwise erase evidence.

## Boundary Rationale

The implementation stays inside `core/` because registry assembly is a runtime primitive shared by every mode and extension. Naming helpers are not published through `catui-protocol`: there is no external consumer requiring a stable cross-package contract yet, so publishing them would be premature abstraction.

## Finding Set

| Finding | Status | Purpose |
|---------|--------|---------|
| [TR01](./findings/TR01-silent-overwrite-boundaries.md) | closed | Remove the three silent-overwrite boundaries before central validation |

## Deferred Work

- Session-level approval centralization remains separate. It needs a dispatch-integrated design and must not ship as unused orchestrator methods.
- Migrating existing MCP model-facing names from `mcp_server_tool` to an explicit `mcp.server.tool` contract remains separate because it affects prompts, stored active-tool names, and tool-call routing.

## Acceptance

- Intra-batch, same-extension, cross-extension, and builtin/extension conflicts are covered by tests.
- Same-description duplicates resolve to one instance across canonical and legacy lookups.
- Failed replacement retains the prior registry.
- DIP, quality, package-boundary, build, TypeScript, focused registry tests, and the repository test suite pass.
