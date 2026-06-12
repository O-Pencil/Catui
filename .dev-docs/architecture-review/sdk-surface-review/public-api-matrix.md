# P8 Public API Matrix

```yaml
doc: public-api-matrix
phase: P8
status: signed-off
source: ../../../index.ts
scope: root export destination before breaking implementation
```

## Rule

This matrix decides the **destination** for each current root export group before
rewriting `@pencil-agent/nano-pencil` root exports.

Destinations:

- `root`: stable host embedding SDK.
- `protocol`: public extension/package contract in `@pencil-agent/protocol`.
- `subpath`: intentionally supported but not root-stable API.
- `ui-subpath`: TUI/theme/editor surface, only if maintainers accept it as public.
- `remove`: leaked implementation detail; use CLI/bin or internal import instead.
- `defer`: needs consumer evidence or a focused review before public exposure.

No source code should change until this matrix is signed off.

## Bucket A: Keep Root

Root should stay small and boring: enough to embed nanoPencil as an SDK or run a
headless agent, not enough to depend on internals.

| Current exports | Destination | Decision |
|-----------------|-------------|----------|
| `VERSION`, `getAgentDir` | `root` | Stable SDK metadata/config-root helper. |
| `createAgentSession`, `CreateAgentSessionOptions`, `CreateAgentSessionResult`, `PromptTemplate` | `root` | Primary host embedding factory. |
| `SDKLogger`, `silentLogger`, `defaultLogger` | `root` | SDK embedding support. |
| `PencilAgent`, `quickAgent`, `PencilAgentOptions` | `root` | Stable high-level SDK facade. |
| `createBashTool`, `createCodingTools`, `createReadTool`, `createEditTool`, `createWriteTool`, `createFindTool`, `createGrepTool`, `createLsTool`, `createReadOnlyTools`, `readOnlyTools` | `root` for now | Headless SDK consumers often need tool factories. Re-evaluate after external consumer review; duplicate via `./tools` is acceptable. |

## Bucket B: Protocol

Only contracts that cross the publish boundary belong in `@pencil-agent/protocol`.
The current protocol slices are documented in [`protocol-inventory.md`](./protocol-inventory.md).

| Current exports | Destination | Decision |
|-----------------|-------------|----------|
| `ExtensionAPI`, `ExtensionContext`, `ExtensionFactory` | `protocol` minimal versions | Protocol owns the small structural contract; host keeps rich overloads/actions. |
| `ToolDefinition`, `AgentToolResult`, `AgentToolUpdateCallback` | split | Protocol owns `ToolContract`, `ToolResult`, `ToolUpdateCallback`; host `ToolDefinition` remains richer renderer-aware type. |
| `RegisteredCommand`, `ExtensionFlag`, hook event names | `protocol` slices landed | Commands, flags, and hook names have protocol owners; host re-exports/extends for compatibility. |
| `ExtensionCommandContext`, `ExtensionContextActions`, `ExtensionCommandContextActions` | `host-only` / subpath only if needed | They expose host session controls and should not become general protocol. |
| `ExtensionUIContext`, widgets/dialogs/renderers, `KeybindingsManager`, `AppAction` | `defer` / `ui-subpath` review | Too much TUI/host surface to freeze in protocol root. |
| Typed event payloads (`*Event`, `*Result`) | `defer` | Hook names are public; payloads need a separate minimal payload review. |

## Bucket C: Subpaths

These APIs may remain public, but not through the root barrel. Subpaths make
volatility explicit and map imports to architecture owners.

| Current exports | Proposed subpath | Decision |
|-----------------|------------------|----------|
| `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent`, `SessionStats`, `ModelCycleResult`, `parseSkillBlock`, `ParsedSkillBlock`, `PromptOptions` | `@pencil-agent/nano-pencil/runtime` | Advanced runtime embedding. Remove from root. |
| `createEventBus`, `EventBus`, `EventBusController`, `convertToLlm` | `@pencil-agent/nano-pencil/runtime` | Runtime utility surface; not root. |
| `SessionManager`, session entry types, session migration/context helpers | `@pencil-agent/nano-pencil/session` | Session persistence surface. Remove from root. |
| `compact`, compaction helpers/settings/types | `@pencil-agent/nano-pencil/session/compaction` | Advanced session internals. Remove from root. |
| `AuthStorage`, auth backends/types, `SettingsManager`, settings types, `DefaultResourceLoader`, `ResourceLoader`, `DefaultPackageManager`, package/resource types | `@pencil-agent/nano-pencil/config` | Platform/config surface. Remove from root. |
| `ModelRegistry` | `@pencil-agent/nano-pencil/models` | Model registry surface. Remove from root. |
| `bashTool`, `editTool`, `readTool`, `writeTool`, `findTool`, `grepTool`, `lsTool`, tool option/input/detail types, truncation helpers | `@pencil-agent/nano-pencil/tools` | Tool implementation surface. Keep root factories only if SDK embedding requires them. |
| `loadSkills`, `loadSkillsFromDir`, `formatSkillsForPrompt`, skill types | `@pencil-agent/nano-pencil/skills` | Skill loading surface. Remove from root. |
| Extension host runtime values (`createExtensionRuntime`, `discoverAndLoadExtensions`, `ExtensionRunner`, wrappers, type guards) | `remove` in first P8 implementation | Host runtime integration is not extension author protocol. Reopen only with an embedding consumer. |
| `InteractiveMode`, `runPrintMode`, `runRpcMode`, mode options | `remove` | Programmatic mode-running is not public API in the first P8 implementation. |

## Bucket D: UI Surface

UI can be public, but it should be explicitly public as UI. It should not remain
in root by accident.

| Current exports | Destination | Decision |
|-----------------|-------------|----------|
| Interactive components (`*Component`, selectors, `CustomEditor`, key hints, `renderDiff`, visual truncation helpers) | `remove` | UI changes frequently; no `./ui` surface in first P8 implementation. |
| Theme utilities (`getMarkdownTheme`, `getSelectListTheme`, `getSettingsListTheme`, `highlightCode`, `initTheme`, `Theme`, `ThemeColor`) | `remove` | Theme/UI surface needs a focused review before publication. |
| `ReadonlyFooterDataProvider` | `remove` | UI host detail. |

## Bucket E: Remove From Public Surface

| Current exports | Destination | Decision |
|-----------------|-------------|----------|
| `main` | `remove` | CLI entry is the `nanopencil` bin. |
| `copyToClipboard` | `remove` or `./utils` only if consumer proves need | Mode utility, not stable SDK. |
| `parseFrontmatter`, `stripFrontmatter` | `remove` or `./utils` only if consumer proves need | Generic utility leaked through root. |
| `getShellConfig` | `remove` or `./config` after review | Platform shell helper, not root SDK. |

## Sign-off Questions

Before implementing the breaking root change, maintainers must answer:

1. Tool factories remain in root; concrete tools and tool details move to `./tools`.
2. Programmatic mode-running is not public API in first P8 implementation.
3. No `./ui` public surface in first P8 implementation.
4. Root and protocol are stable; `./tools` is relatively stable; `./runtime`, `./session`,
   `./session/compaction`, `./config`, `./models`, and `./skills` are advanced subpaths.
5. Because 2.0 is still beta, P8 ships as a hard break without a deprecation alias window.
