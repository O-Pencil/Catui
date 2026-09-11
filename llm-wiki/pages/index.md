---
id: wiki:index
title: LLM Wiki Index
sources:
  - AGENTS.md
  - llm-wiki/graph.json
  - llm-wiki/search-index.json
generatedFromGraphHash: 6650b6829ae8df62c52068b7522c7f8298fdbf55bbecd0571f17151e7b66e695
generatedAt: 2026-09-10T16:21:57.169Z
---

# LLM Wiki

This wiki is a human-first map of the Catui codebase backed by a complete machine graph.

## Current Shape

- Project: `catui-agent` `1.2.28`
- Graph hash: `6650b6829ae8df62c52068b7522c7f8298fdbf55bbecd0571f17151e7b66e695`
- Source files represented virtually: 744
- P2 modules represented virtually: 42
- P3 contracts: 744/744
- Exported symbols: 4144
- Import edges: 3142

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
