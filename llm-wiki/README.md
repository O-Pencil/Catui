# LLM Wiki

This directory is the project-local LLM Wiki source of truth.

The wiki is not a free-form HTML dump. It is a verifiable projection of the codebase:

- `graph.json` is the machine-readable code and documentation graph.
- `manifest.json` records artifact counts and graph hash provenance.
- `search-index.json` is the LLM-facing lookup table for retrieval.
- `pages/*.md` are curated Markdown pages for humans and LLM orientation.
- `diagnostics.json` records the latest isomorphism verification result.
- `site/**/*.html` is generated from Markdown and can be rebuilt at any time.

## Coverage

The generator creates:

- Eight narrative Markdown pages: index, architecture, modules, files, symbols, dependencies, health, and retrieval.
- One search-index entry per Markdown page.
- One virtual search-index entry per indexed P2 module.
- One virtual search-index entry per indexed source file.
- One virtual search-index entry per exported symbol.
- One HTML page per Markdown page.
- One interactive browser at `site/explorer.html`.

Generated files and test-only entry points are intentionally excluded from the source graph; maintainable TypeScript sources are included.

## Workflow

```bash
npm run wiki:scan
npm run wiki:update
npm run wiki:verify
npm run wiki:build
```

Use `npm run wiki:all` to run the full deterministic update, verify, and render cycle.

## Design Rule

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
