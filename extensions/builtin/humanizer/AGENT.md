# AGENT.md

> P2 | humanizer extension module map

## Purpose

Bundles the upstream `blader/humanizer` writing-quality skill (v3.0.0, MIT) as a Catui
default-loaded extension. The skill is registered via `resources_discover` so the core skill
loader picks up `SKILL.md` and exposes it through the `skill` tool.

## Members

| File | Role |
|---|---|
| `index.ts` | Catui-authored wrapper. Registers `resources_discover` (returns this directory's SKILL.md as a skill path) and `before_agent_start` (appends a short bootstrap note about the bundled skill). |
| `SKILL.md` | Vendored skill entry point. Frontmatter `name: humanizer` matches this directory per `core/skills.ts#validateName`. 25 AI-writing patterns across five sections, with before/after examples and explicit "do not invent facts" rules. |
| `LICENSE` | Vendored upstream MIT license. |
| `README.md` | Catui user-facing notes. |
| `THIRD_PARTY_NOTICE.md` | Source, version, license, vendored-vs-used table. |

## Registration

Registered in `builtin-extensions.ts`:

- `BUNDLED_HUMANIZER_EXTENSION` constant
- `{ id: "humanizer", category: "default", defaultEnabled: true, riskLevel: "passive", ..., resourceDiscovery: true }` entry
- `getBuiltinExtensionPaths()` append block

## Design decisions

- **Token-light**: the ~8KB skill body is loaded only via the `skill` tool (on demand).
  The `before_agent_start` bootstrap note is ~6 lines, so default enablement costs a few
  hundred tokens per session, not the full skill.
- **Ethics-clean**: the skill improves writing quality (grounded in Wikipedia's public
  "Signs of AI writing" page); it does not teach detection evasion. Vendored content keeps
  its inline rules against inventing facts and sources.
- **No scripts vendored**: upstream has no harness scripts; only `SKILL.md` and `LICENSE`
  are vendored. Upstream `AGENTS.md` (a Claude Code instruction file) is intentionally not
  vendored to avoid DIP confusion.

## Compatibility

`validateName` requires `frontmatter.name === parentDirName` — both are `humanizer`, so the
skill loads with no diagnostics.