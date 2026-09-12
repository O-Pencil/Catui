# Third-Party Notice: humanizer

## Source

The contents of this directory (`SKILL.md`, `LICENSE`) were vendored from the upstream
**humanizer** Agent Skill repository, version 3.0.0, cloned from
https://github.com/blader/humanizer (commit dated 2026-09-06, tag v3.0.0, shallow clone).

## Upstream Project

- **Repository:** https://github.com/blader/humanizer
- **Description:** Agent skill that removes signs of AI-generated writing from text
- **Stars:** ~47k; **License:** MIT (LICENSE file at repo root, declared in SKILL.md frontmatter)

## What Is Vendored vs What Catui Interprets

| Subpath | Vendored? | Used by Catui? |
|---|---|---|
| `SKILL.md` | Yes | Yes — registered as a skill via `resources_discover` |
| `LICENSE` | Yes | Yes — license record for the vendored content |
| `README.md`, `AGENTS.md`, `.claude-plugin/`, `agents/`, `scripts/`, `.github/` | **No** | Not vendored. Upstream `AGENTS.md` is a Claude-Code harness instruction file and is intentionally excluded to avoid DIP/scanner confusion |

> The upstream repo contains no harness scripts and no runtime code — the skill is a single
> Markdown prompt file. Catui therefore has nothing to keep inert.

## Ethical Positioning

The skill is grounded in Wikipedia's public ["Signs of AI writing"](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)
guide (WikiProject AI Cleanup). It improves writing quality: it removes staging, rhythm-by-rule,
inflation, decoration, and chat leftovers, and explicitly forbids inventing facts, names, dates,
quotes, or citations. It is **not** a tool for evading AI-content detectors, and Catui does not
use it as one.

## License

MIT (see `LICENSE`). Redistribution under Catui's MIT license is compatible; attribution to the
upstream author is preserved in this file and in `AGENT.md`.