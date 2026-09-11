---
id: wiki:architecture
title: Architecture Projection
sources:
  - AGENTS.md
  - llm-wiki/graph.json
generatedFromGraphHash: 6650b6829ae8df62c52068b7522c7f8298fdbf55bbecd0571f17151e7b66e695
generatedAt: 2026-09-10T16:21:57.175Z
---

# Architecture Projection

This page is the human narrative view. Use `graph.json` for exact node/edge traversal and `explorer.html` for interactive lookup.

## Source Distribution

| Area | Source Files |
| --- | ---: |
| `core` | 254 |
| `extensions` | 214 |
| `modes` | 97 |
| `learning` | 66 |
| `packages` | 55 |
| `scripts` | 25 |
| `cli` | 10 |
| `utils` | 8 |
| `builtin-extensions.ts` | 1 |
| `catui-defaults.ts` | 1 |
| `cli.ts` | 1 |
| `config.ts` | 1 |
| `extensions.ts` | 1 |
| `index.ts` | 1 |
| `main.ts` | 1 |
| `migrations.ts` | 1 |
| `models.ts` | 1 |
| `public-config.ts` | 1 |
| `runtime.ts` | 1 |
| `session-compaction.ts` | 1 |
| `session.ts` | 1 |
| `skills.ts` | 1 |
| `tools.ts` | 1 |

## Runtime Shape

- Entry points live at the top level and under `modes/`.
- Core agent behavior lives under `core/`.
- Built-in and optional behaviors live under `extensions/`.
- Bundled packages live under `packages/`.
- Scripts are maintenance/runtime tooling, not product runtime.

## Most Referenced Packages

| Package | Importing Files |
| --- | ---: |
| `node:path` | 159 |
| `node:fs` | 110 |
| `@catui/agent-core` | 99 |
| `@catui/tui` | 99 |
| `@catui/ai/types` | 71 |
| `node:fs/promises` | 54 |
| `@sinclair/typebox` | 48 |
| `node:os` | 41 |
| `node:crypto` | 40 |
| `fs` | 34 |
| `path` | 32 |
| `node:url` | 31 |
| `node:child_process` | 25 |
| `child_process` | 16 |
| `chalk` | 13 |
| `@catui/ai/events` | 11 |
| `@catui/ai/models` | 10 |
| `node:util` | 9 |
| `os` | 9 |
| `@catui/ai/oauth` | 8 |
| `@catui/ai/stream` | 8 |
| `node:http` | 8 |
| `node:process` | 8 |
| `proper-lockfile` | 8 |
| `@catui/ai/schema` | 6 |
| `node:module` | 6 |
| `readline` | 6 |
| `@catui/ai/overflow` | 5 |
| `fs/promises` | 5 |
| `openai` | 5 |
