# AGENT.md

> P2 | catpaw extension module map

## Purpose

Bundles the upstream `catpaw` UI/UX design craft skill as a Catui default-loaded extension.
The skill is registered via `resources_discover` so the core skill loader picks up
`SKILL.md` (with its `reference/` references) and exposes it through the `skill` tool.

## Members

| File | Role |
|---|---|
| `index.ts` | Catui-authored wrapper. Registers `resources_discover` (returns this directory as a skill path) and `before_agent_start` (appends a short bootstrap note about the bundled skill). |
| `SKILL.md` | Vendored skill entry point. Frontmatter `name: catpaw` matches this directory per `core/skills.ts#validateName`. |
| `reference/*.md` | Vendored reference content. 36 markdown files covering commands (craft, shape, init, document, extract, critique, audit, polish, bolder, quieter, distill, harden, onboard, animate, colorize, typeset, layout, delight, overdrive, clarify, adapt, optimize, visualize), the craft floor, new-work playbook, and platform-specific native guidance. |
| `scripts/` | Vendored Claude Code / Cursor / Codex harness scripts. **Not executed by Catui.** |
| `agents/` | Vendored Claude Code sub-agent configs. **Not consumed by Catui.** |
| `README.md` | Catui user-facing notes. |
| `THIRD_PARTY_NOTICE.md` | Source, version, license caveat, vendored-vs-used table. |

## Registration

Registered in `builtin-extensions.ts`:

- `BUNDLED_CATPAW_EXTENSION` constant
- `{ id: "catpaw", category: "default", defaultEnabled: true, riskLevel: "passive", ..., resourceDiscovery: true }` entry
- `getBuiltinExtensionPaths()` append block (after skill-tool, before the final `return paths`)

## Compatibility

- Catui scans the directory with `core/skills.ts#loadSkillsFromDirInternal`, which recursively
  finds `SKILL.md` files. The top-level `SKILL.md` here matches.
- `validateName` requires `frontmatter.name === parentDirName` — both are `catpaw`, so the skill
  loads with no diagnostics.
- Scripts and `agents/` are inert under Catui; the bootstrap note explicitly tells the agent not to
  execute them via `bash`.

## Known limitations

- The upstream skill body hardcodes paths like `node .agents/skills/catpaw/scripts/context.mjs`.
  Catui does not rewrite SKILL.md. The README documents how to interpret these paths under Catui.
- If the upstream frontmatter `name` ever changes to a different value than `catpaw`, the
  skill will load with a `warning` diagnostic from `validateName` and still register. A follow-up
  fix should rename either the directory or the frontmatter.