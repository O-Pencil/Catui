---
id: wiki:retrieval-zh
title: LLM 检索指南
sources:
  - llm-wiki/graph.json
  - llm-wiki/search-index.json
generatedFromGraphHash: 67fdf30e687528e70baefc61cc604eb1b059c261dba1a5780da081c3af5a82bb
generatedAt: 2026-05-26T16:35:12.353Z
---

# LLM 检索指南

按以下顺序使用 Wiki：

1. 搜索 `llm-wiki/search-index.json` 查找页面、模块、文件或符号条目。
2. 阅读匹配的叙事 Markdown 页面进行定位。
3. 使用虚拟条目源列表跳转到 P1、P2、P3 或源文件。
4. 使用 `llm-wiki/graph.json` 获取精确依赖。
5. 使用 `llm-wiki/site/explorer.html` 进行人类浏览。

## 完整性契约

- 仅精选叙事 Markdown 页面被物化。
- 每个已索引模块都有一个虚拟模块条目。
- 每个已索引源文件都有一个虚拟文件条目。
- 每个导出符号都有一个虚拟符号条目。
- 当图、搜索索引、虚拟覆盖、清单或页面哈希偏离时，`npm run wiki:verify` 会失败。

## 当前范围

- 叙事 Markdown 页面：8
- 虚拟表示的源文件：406
- 虚拟表示的模块：31
- 虚拟表示的导出符号：2836
