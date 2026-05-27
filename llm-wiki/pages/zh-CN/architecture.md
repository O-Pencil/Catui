---
id: wiki:architecture-zh
title: 架构投影
sources:
  - AGENTS.md
  - llm-wiki/graph.json
generatedFromGraphHash: 67fdf30e687528e70baefc61cc604eb1b059c261dba1a5780da081c3af5a82bb
generatedAt: 2026-05-26T16:35:12.349Z
---

# 架构投影

本页面是人类叙事视图。使用 `graph.json` 进行精确的节点/边遍历，使用 `explorer.html` 进行交互式查找。

## 源文件分布

| 区域 | 源文件数 |
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

## 运行时形态

- 入口点位于顶层和 `modes/` 下。
- 核心代理行为位于 `core/` 下。
- 内置和可选行为位于 `extensions/` 下。
- 捆绑包位于 `packages/` 下。
- 脚本是维护/运行时工具，不是产品运行时。

## 最常引用的包

| 包 | 导入文件数 |
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
