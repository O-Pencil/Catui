# LLM Wiki

This directory is the project-local LLM Wiki source of truth.

本目录是项目本地的 LLM Wiki 中文版本。

## 双语结构 / Bilingual Structure

Wiki 页面按语言组织在 `pages/` 目录下：

Wiki pages are organized by language under `pages/`:

- `pages/en/` — English (original)
- `pages/zh-CN/` — Chinese (中文)

每个语言目录包含相同的 8 个叙事页面：

Each language directory contains the same 8 narrative pages:

| 页面 / Page | 说明 / Description |
| --- | --- |
| `index.md` | Wiki 索引 / Wiki index |
| `architecture.md` | 架构投影 / Architecture projection |
| `modules.md` | 模块地图 / Module map |
| `files.md` | 源文件地图 / Source file map |
| `symbols.md` | 导出符号地图 / Exported symbol map |
| `dependencies.md` | 依赖地图 / Dependency map |
| `health.md` | DIP 健康 / DIP health |
| `retrieval.md` | LLM 检索指南 / LLM retrieval guide |

## 其他产物 / Other Artifacts

The wiki is not a free-form HTML dump. It is a verifiable projection of the codebase:

- `graph.json` is the machine-readable code and documentation graph.
- `manifest.json` records artifact counts and graph hash provenance.
- `search-index.json` is the LLM-facing lookup table for retrieval.
- `diagnostics.json` records the latest isomorphism verification result.
- `site/**/*.html` is generated from Markdown and can be rebuilt at any time.

## 覆盖范围 / Coverage

The generator creates:

- Eight narrative Markdown pages per language: index, architecture, modules, files, symbols, dependencies, health, and retrieval.
- One search-index entry per Markdown page.
- One virtual search-index entry per indexed P2 module.
- One virtual search-index entry per indexed source file.
- One virtual search-index entry per exported symbol.
- One HTML page per Markdown page.
- One interactive browser at `site/explorer.html`.

Generated files and test-only entry points are intentionally excluded from the source graph; maintainable TypeScript sources are included.

## 工作流 / Workflow

```bash
npm run wiki:scan
npm run wiki:update
npm run wiki:verify
npm run wiki:build
```

Use `npm run wiki:all` to run the full deterministic update, verify, and render cycle.

## 设计规则 / Design Rules

Markdown and JSON are the source layer. HTML is only a rendered artifact.

Every wiki page should declare frontmatter with a stable `id`, a `sources` list, and a `generatedFromGraphHash` value. Verification checks those references against the current graph so wiki pages drift visibly when code or P1/P2/P3 documents change.

The wiki intentionally does not materialize hundreds of module/file Markdown pages. Those details are virtual entries in `search-index.json` and are browsable through `site/explorer.html`. This keeps the repository readable while preserving complete code addressability.

`npm run wiki:verify` fails when:

- `graph.json` is stale.
- Any page references missing sources.
- Any page has a stale graph hash.
- `search-index.json` is stale.
- Any P2 module lacks a virtual search entry.
- Any indexed source file lacks a virtual search entry.
- Any exported symbol lacks a virtual search entry.
- `manifest.json` disagrees with graph or page counts.
