# P8 Protocol Inventory

```yaml
doc: protocol-inventory
phase: P8
status: active
owner: sdk-surface-review
source_of_truth:
  - ../../evolution/dev-conventions.md#3b-类型协议放置约规日常开发铁律
  - ../../../packages/protocol/src/
```

## Rule

`@pencil-agent/protocol` owns only contracts that cross a publish boundary:

- third-party extensions
- `packages/mem-core`
- `packages/soul-core`
- future published package integrations

Host-only rich types stay in `core/extensions-host/types.ts`. The host may re-export
or `extends` protocol contracts to preserve compatibility, but protocol must not
absorb host internals just because they appear in the old root barrel.

## Current Slices

| Slice | Protocol owner | Host owner | Status | Why |
|-------|----------------|------------|--------|-----|
| Tool runtime seam | `packages/protocol/src/tools.ts` | `ToolDefinition` extends `ToolRuntimeDescriptor` | landed | Tool runtime/permission fields are public extension declarations |
| Minimal tool contract | `packages/protocol/src/tools.ts` | host still owns richer renderer/tool-result adapters | landed | Published packages can register tools without host imports |
| Minimal lifecycle contract | `packages/protocol/src/lifecycle.ts` | host still owns typed events/actions/model/UI/session controls | landed | `mem-core` and external extensions need a small `ExtensionAPI`/`ExtensionContext` |
| Extension flag | `packages/protocol/src/flags.ts` | host re-exports `ExtensionFlag` | landed | CLI/config declaration is portable extension metadata |
| Command contract | `packages/protocol/src/commands.ts` | host `RegisteredCommand` extends it with rich command context | landed | Slash command registration crosses extension/package boundaries |
| Hook event-name vocabulary | `packages/protocol/src/hooks.ts` | host keeps rich event payloads and typed `on(...)` overloads | landed | Extensions need stable hook names, but payloads still expose host internals |
| Flag contract | `packages/protocol/src/flags.ts` | host `registerFlag/getFlag` use protocol options/value types | landed | Extension-declared CLI/config flags cross the extension boundary |

## Candidate Buckets

| Candidate | Destination | Decision |
|-----------|-------------|----------|
| `ExtensionAPI` full host overload set | `host-only` for now | Full event typing includes host-specific event payloads and actions; protocol keeps minimal `on/registerCommand/registerTool` shape. |
| Per-event hook payload types | `defer` | Names are public and landed in `hooks.ts`; payloads need a separate review to avoid freezing host internals. |
| Tool call/result event payloads | `defer` | They reference agent-core/ai/TUI/content details; should be split into minimal protocol payloads before promotion. |
| `ExtensionCommandContext` | `host-only` | It exposes session controls (`fork`, `switchSession`, `navigateTree`, `reload`) and settings; external protocol should not make those mandatory. |
| `ExtensionUIContext` | `defer` / possible `ui` subpath | It depends on TUI components, themes, keybindings, overlays, and editor contracts; too broad for protocol root. |
| `MessageRenderer` / render options | `defer` | Renderer contracts may become a UI protocol, but they currently depend on host theme and TUI component types. |
| `ProviderConfig` / model provider configs | `host-only` until consumer proves otherwise | Provider configuration is host/runtime policy, not an extension protocol by default. |
| `KeybindingsManager` / `AppAction` | `ui-subpath` or host-only | Custom editors may need them, but they are TUI-host coupling, not general extension protocol. |
| `ExecOptions` / `ExecResult` | `host-only` | Platform exec primitive; only promote if a published package needs it. |
| Standalone `permissions.ts` | `defer` / no current consumer | Tool permission declarations already live in `tools.ts`; plan/team/sub-agent permissions are internal feature policy, not public protocol. |

## Slice Procedure

For each candidate:

1. Prove a cross-publish consumer exists or is being introduced.
2. Add the minimal contract to `packages/protocol/src/<domain>.ts`.
3. Export it from `packages/protocol/src/index.ts`.
4. Rewire host types to re-export or extend the protocol contract.
5. Keep root `@pencil-agent/nano-pencil` exports unchanged until the explicit major-window root narrowing step.

## Current Next Slice Recommendation

The next low-risk candidates are:

- `themes.ts`: only if a third-party extension contract needs theme tokens without depending on host TUI internals.
- `shortcuts.ts`: only if we can express key ids without depending on `@pencil-agent/tui` internals.

Avoid next:

- full `ExtensionAPI`
- `ExtensionUIContext`
- message renderer contracts
- standalone `permissions.ts` without a real cross-publish consumer

These are broad host surfaces and should wait for a focused review or a proven external consumer.
