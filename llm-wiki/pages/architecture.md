---
id: wiki:architecture
title: Architecture Projection
sources:
  - AGENTS.md
  - llm-wiki/graph.json
generatedFromGraphHash: 67fdf30e687528e70baefc61cc604eb1b059c261dba1a5780da081c3af5a82bb
generatedAt: 2026-05-26T16:35:12.349Z
---

# Architecture Projection

This page is the human narrative view. Use `graph.json` for exact node/edge traversal and `explorer.html` for interactive lookup.

## Source Distribution

| Area | Source Files |
| --- | ---: |
| `packages` | 126 |
| `extensions` | 102 |
| `core` | 93 |
| `modes` | 58 |
| `scripts` | 8 |
| `utils` | 7 |
| `cli` | 5 |
| `builtin-extensions.ts` | 1 |
| `cli.ts` | 1 |
| `config.ts` | 1 |
| `index.ts` | 1 |
| `main.ts` | 1 |
| `migrations.ts` | 1 |
| `nanopencil-defaults.ts` | 1 |

## Runtime Shape

- Entry points live at the top level and under `modes/`.
- Core agent behavior lives under `core/`.
- Built-in and optional behaviors live under `extensions/`.
- Bundled packages live under `packages/`.
- Scripts are maintenance/runtime tooling, not product runtime.

## Most Referenced Packages

| Package | Importing Files |
| --- | ---: |
| `node:path` | 72 |
| `@pencil-agent/tui` | 60 |
| `@pencil-agent/ai` | 50 |
| `node:fs` | 50 |
| `@pencil-agent/agent-core` | 43 |
| `fs` | 30 |
| `path` | 28 |
| `node:os` | 26 |
| `@sinclair/typebox` | 25 |
| `node:fs/promises` | 22 |
| `node:url` | 17 |
| `node:crypto` | 15 |
| `child_process` | 14 |
| `node:child_process` | 14 |
| `chalk` | 9 |
| `os` | 8 |
| `node:http` | 6 |
| `fs/promises` | 5 |
| `node:module` | 5 |
| `node:util` | 5 |
| `readline` | 5 |
| `@google/genai` | 4 |
| `node:events` | 4 |
| `openai` | 4 |
| `openai/resources/responses/responses.js` | 4 |
| `url` | 4 |
| `proper-lockfile` | 3 |
| `strip-ansi` | 3 |
| `vitest/config` | 3 |
| `yaml` | 3 |
