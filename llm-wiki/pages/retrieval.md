---
id: wiki:retrieval
title: LLM Retrieval Guide
sources:
  - llm-wiki/graph.json
  - llm-wiki/search-index.json
generatedFromGraphHash: 6650b6829ae8df62c52068b7522c7f8298fdbf55bbecd0571f17151e7b66e695
generatedAt: 2026-09-10T16:21:57.179Z
---

# LLM Retrieval Guide

Use the wiki in this order:

1. Search `llm-wiki/search-index.json` for page, module, file, or symbol entries.
2. Read the matching narrative Markdown page for orientation.
3. Use the virtual entry source list to jump to P1, P2, P3, or source files.
4. Use `llm-wiki/graph.json` for exact dependencies.
5. Use `llm-wiki/site/explorer.html` for human browsing.

## Completeness Contract

- Only curated narrative Markdown pages are materialized.
- Every indexed module has a virtual module entry.
- Every indexed source file has a virtual file entry.
- Every exported symbol has a virtual symbol entry.
- `npm run wiki:verify` fails when graph, search index, virtual coverage, manifest, or page hashes drift.

## Current Scope

- Narrative Markdown pages: 8
- Source files represented virtually: 744
- Modules represented virtually: 42
- Exported symbols represented virtually: 4144
