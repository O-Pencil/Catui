---
id: wiki:index
title: LLM Wiki Index
sources:
  - AGENTS.md
  - llm-wiki/graph.json
  - llm-wiki/search-index.json
generatedFromGraphHash: 67fdf30e687528e70baefc61cc604eb1b059c261dba1a5780da081c3af5a82bb
generatedAt: 2026-05-26T16:35:12.343Z
---

# LLM Wiki

This wiki is a human-first map of the nanoPencil codebase backed by a complete machine graph.

## Current Shape

- Project: `@pencil-agent/nano-pencil` `1.14.1`
- Graph hash: `67fdf30e687528e70baefc61cc604eb1b059c261dba1a5780da081c3af5a82bb`
- Source files represented virtually: 406
- P2 modules represented virtually: 31
- P3 contracts: 406/406
- Exported symbols: 2836
- Import edges: 1787

## Human Navigation

- [Architecture Projection](./architecture.md)
- [Module Map](./modules.md)
- [Source File Map](./files.md)
- [Exported Symbol Map](./symbols.md)
- [Dependency Map](./dependencies.md)
- [DIP Health](./health.md)
- [LLM Retrieval Guide](./retrieval.md)
- Browser site: `llm-wiki/site/index.html`
- Interactive explorer: `llm-wiki/site/explorer.html`

## Design Contract

The wiki keeps only a small set of narrative Markdown pages in the source layer. Detailed module, file, and symbol pages are virtual entries in `search-index.json` and the interactive explorer. This avoids hundreds of mechanical files while preserving complete addressability.
