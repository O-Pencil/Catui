# P8 Migration Guide Draft

```yaml
doc: migration-guide
phase: P8
status: signed-off
applies_to: P8 root API narrowing release
```

## Summary

The root import path `@pencil-agent/nano-pencil` will narrow to the stable host
embedding SDK. Extension contracts move to `@pencil-agent/protocol`. Advanced
internals move to explicit subpaths.

This is an intentional major-version API change. Runtime CLI behavior is not the
target of this migration.

## Root SDK

Before:

```ts
import { createAgentSession, AgentSession, SessionManager } from "@pencil-agent/nano-pencil";
```

After:

```ts
import { createAgentSession } from "@pencil-agent/nano-pencil";
import { AgentSession } from "@pencil-agent/nano-pencil/runtime";
import { SessionManager } from "@pencil-agent/nano-pencil/session";
```

## Extension Authors

Before:

```ts
import type { ExtensionAPI, ToolDefinition, RegisteredCommand } from "@pencil-agent/nano-pencil";
```

After:

```ts
import type { ExtensionAPI, ToolContract, ExtensionCommand } from "@pencil-agent/protocol";
```

Host-rich APIs such as `ExtensionCommandContext`, `ExtensionUIContext`,
`MessageRenderer`, and typed event payloads are not automatically protocol
contracts. Use them only from explicit host/UI subpaths after those surfaces are
signed off.

## Tools

Before:

```ts
import { bashTool, createReadTool, truncateTail } from "@pencil-agent/nano-pencil";
```

After:

```ts
import { bashTool, createReadTool, truncateTail } from "@pencil-agent/nano-pencil/tools";
```

Root may retain selected SDK tool factories if maintainers sign off that
headless embedding requires them.

## Session And Compaction

Before:

```ts
import { SessionManager, compact, DEFAULT_COMPACTION_SETTINGS } from "@pencil-agent/nano-pencil";
```

After:

```ts
import { SessionManager } from "@pencil-agent/nano-pencil/session";
import { compact, DEFAULT_COMPACTION_SETTINGS } from "@pencil-agent/nano-pencil/session/compaction";
```

## Config And Models

Before:

```ts
import { AuthStorage, SettingsManager, ModelRegistry } from "@pencil-agent/nano-pencil";
```

After:

```ts
import { AuthStorage, SettingsManager } from "@pencil-agent/nano-pencil/config";
import { ModelRegistry } from "@pencil-agent/nano-pencil/models";
```

## UI And Themes

Before:

```ts
import { CustomEditor, ModelSelectorComponent, getMarkdownTheme } from "@pencil-agent/nano-pencil";
```

After:

```text
No public replacement in the first P8 implementation.
```

UI exports are removed from the package API and remain host internals. A future
`./ui` surface requires a focused UI/theme review.

## CLI

Before:

```ts
import { main } from "@pencil-agent/nano-pencil";
```

After:

```bash
nanopencil
```

`main` is not an SDK contract; the CLI entry is the package bin.

## Compatibility Policy

Migration is a **hard beta break** for 2.0: root exports narrow immediately,
with no root alias window. Migration guide and changelog are mandatory before
publishing the next beta.
