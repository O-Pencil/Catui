---
id: wiki:retrieval
title: LLM Retrieval Guide
sources:
  - llm-wiki/graph.json
  - llm-wiki/search-index.json
generatedFromGraphHash: 67fdf30e687528e70baefc61cc604eb1b059c261dba1a5780da081c3af5a82bb
generatedAt: 2026-05-26T16:35:12.353Z
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
- Source files represented virtually: 406
- Modules represented virtually: 31
- Exported symbols represented virtually: 2836
