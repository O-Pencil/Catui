# Third-Party Notice: catpaw

## Source

The contents of this directory (`SKILL.md`, `reference/`, `scripts/`, `agents/`) were vendored from the
upstream **catpaw** skill package, version 4.0.4, obtained via `npx catpaw install` on 2026-08-09.

## Upstream Project

- **Package name:** catpaw
- **Installation:** `npx catpaw install`
- **Default install path on the original author's machine:** `~/.agents/skills/catpaw/`
- **Detected target harnesses (by the upstream installer):** Claude Code, Codex CLI, Cursor, Qoder

The upstream installer writes the skill into the universal `~/.agents/skills/` directory so it can be
picked up by any harness that follows the Agent Skills spec.

## License

License terms were not embedded in the upstream bundle (no `LICENSE` file shipped with the installed
skill, and the SKILL.md frontmatter does not declare a license). The vendoring decision was made under
the assumption that the upstream maintainer intends the skill to be freely usable and redistributable.
Before any commercial redistribution, verify the license with the upstream author.

## What Is Vendored vs What Catui Interprets

| Subpath | Vendored? | Used by Catui? |
|---|---|---|
| `SKILL.md` | Yes | Yes — registered as a skill via `resources_discover` |
| `reference/*.md` | Yes | Yes — included as skill reference content (loaded by the core skill loader when the skill is invoked) |
| `scripts/*.mjs`, `scripts/*.js`, `scripts/lib/`, `scripts/live/`, `scripts/detector/` | Yes (verbatim) | **No.** These are Claude Code / Cursor / Codex harness scripts (hooks, live browser iteration, design-system detectors). Catui has no equivalent hook API and does not execute them. |
| `agents/*.toml`, `agents/openai.yaml` | Yes (verbatim) | **No.** These describe Claude Code sub-agent configurations. Catui's SubAgent / Team system has its own model. |
| `scripts/command-metadata.json` | Yes | No |

## Catui Adapter

- This extension's `index.ts` is the only Catui-authored file in this directory.
- It registers `resources_discover` so the bundled `SKILL.md` is loaded by Catui's core skill system.
- It appends a short bootstrap note via `before_agent_start` so the agent knows the skill is bundled and
  knows that scripts and agents are not executed.
- No part of the upstream script bodies has been modified.

## Updating

To refresh from upstream:

```sh
npx catpaw install --target ~/.agents/skills/catpaw
rsync -a --delete ~/.agents/skills/catpaw/ extensions/builtin/catpaw/
```

After a refresh, re-verify that `SKILL.md` frontmatter still satisfies Catui's
`core/skills.ts#validateName` rule (frontmatter `name` must equal the parent directory name).