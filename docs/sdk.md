---
name: sdk
description: Use when the user asks how to embed Catui programmatically (createAgentSession).
surface: TODO  # user entry points: /command, --flag, config key, file location
owner: core/runtime/sdk.ts  # DIP P2 anchor — read its AGENT.md member list to find code
status: draft
---

# SDK Integration

> TODO: one line — what this feature does for the user.

## When to use
TODO: the user intents that should pull this doc (mirrors the frontmatter `description`).

## Usage
TODO: commands / flags / config keys / file locations, with one minimal example.

## Behavior & defaults
Default Catui sessions load the built-in extension registry from `getBuiltinExtensionPaths()`. `evolution` is included by default but idle-neutral until candidates or promoted artifacts exist.

## Loading the `evolution` extension

CLI and SDK default sessions share `getBuiltinExtensionPaths()`, so `evolution` is part of the default Catui product surface. SDK embedders that build a custom extension list can still point `additionalExtensionPaths` at an absolute path to the bundled extension entry.

The `@catui/agent/extensions` subpath exposes the evolution extension factories and types **without** leaking internal filesystem paths. Two usage patterns:

### Pattern A: embed tools directly (no path lookup)

Useful when you build a custom agent harness and want `evolution_refine` / `evolved_tool` as `ToolDefinition`s in your own runtime:

```ts
import {
  createEvolutionRefineTool,
  createEvolvedTool,
  EvolutionAutoObserver,
  buildEvolutionPromptAppend,
} from "@catui/agent/extensions";
```

Each factory returns a `ToolDefinition` compatible with `customTools` on `createAgentSession`, so you can mix evolution into any host agent:

```ts
await createAgentSession({
  customTools: [createEvolutionRefineTool(), createEvolvedTool()],
});
```

### Pattern B: load the full extension via path in a custom extension list

`evolutionExtension` is the default-exported `ExtensionFactory`. To get the full `/refine` slash command + `turn_end` observer + `before_agent_start` prompt append behavior, point `additionalExtensionPaths` at the bundled entry:

```ts
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const evolutionEntry = require.resolve("@catui/agent/dist/extensions/optional/evolution/index.js");

await createAgentSession({
  additionalExtensionPaths: [path.dirname(evolutionEntry)],
});
```

Pattern B is for embedders that override default extension loading but still want evolution. Pattern A is for embedders that want individual tools without the slash command and observer.

> **Future**: a `CreateAgentSessionOptions.extensionFactories?: ExtensionFactory[]` field is the cleanest way to inject `evolutionExtension` directly without resolving filesystem paths. Tracking in `extensions-host`; do not couple to it until that lands.

## Trust model

- Default loading is idle-neutral: unused evolution registers commands/tools but performs no model calls, creates no evolution ledger, and injects no prompt content.
- Arbitrary generated source execution remains rejected. The only executable slice is workspace-scoped `executable_tool`, invoked through a no-IO JSON template interpreter after approved content-hash and permission-manifest checks.
- Session-scoped artifacts can auto-promote after the eval gate passes. The structured proposal path lets the model self-sign at `turn_end`; gate evidence is the only safety net on that route. Document this before turning it on for end users.
- Global auto-promotion requires `applicability` + `nonApplicability`, no metadata, and content under 800 chars (`canAutoPromoteGlobalEvolution`).
- Auto-rollback triggers only for the **current** revision with a predecessor. Workspace/global scopes require stream-aware falsification evidence; interleaved falsification counts as stronger contamination evidence.

## Code map → DIP
- Owner: `core/runtime/sdk.ts` — read its DIP **P2 member list** (the nearest `AGENT.md`) to locate files.
- Extension factories: `extensions/optional/evolution/*` — read its P2 (`AGENT.md`) for the member list and P3 file headers for contracts.
- Public surface: `extensions.ts` (root) re-exports the factories and types.
- Then follow **P3** file headers (WHO / FROM / TO / HERE) to navigate. Do **not** duplicate code paths here.

## Related
[[extensions]] [[packages]]
