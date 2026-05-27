---
id: wiki:index-zh
title: LLM Wiki 索引
sources:
  - AGENTS.md
  - llm-wiki/graph.json
  - llm-wiki/search-index.json
generatedFromGraphHash: 67fdf30e687528e70baefc61cc604eb1b059c261dba1a5780da081c3af5a82bb
generatedAt: 2026-05-26T16:35:12.343Z
---

# LLM Wiki

本 Wiki 是 nanoPencil 代码库的人类优先地图，由完整的机器图提供支持。

## 当前状态

- 项目：`@pencil-agent/nano-pencil` `1.14.1`
- 图哈希：`67fdf30e687528e70baefc61cc604eb1b059c261dba1a5780da081c3af5a82bb`
- 虚拟表示的源文件：406
- 虚拟表示的 P2 模块：31
- P3 契约：406/406
- 导出符号：2836
- 导入边：1787

## 人类导航

- [架构投影](./architecture.md)
- [模块地图](./modules.md)
- [源文件地图](./files.md)
- [导出符号地图](./symbols.md)
- [依赖地图](./dependencies.md)
- [DIP 健康](./health.md)
- [LLM 检索指南](./retrieval.md)
- 浏览器站点：`llm-wiki/site/index.html`
- 交互式浏览器：`llm-wiki/site/explorer.html`

## 设计契约

Wiki 仅在源层保留少量叙事 Markdown 页面。详细的模块、文件和符号页面是 `search-index.json` 和交互式浏览器中的虚拟条目。这避免了数百个机械文件，同时保留了完整的可寻址性。
