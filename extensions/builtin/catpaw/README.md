# catpaw (vendored)

Default-loaded Catui extension that bundles the upstream **catpaw** UI/UX design craft skill
(version 4.0.4). The skill body and references are exposed through Catui's normal skill system; the
bundled scripts and agent configs are vendored for completeness but are not executed by Catui.

## Activation

This extension is registered in `builtin-extensions.ts` as a default-enabled, passive extension
(no UI, no timers, no workspace writes, no external processes). It contributes one skill
(`catpaw`) to the available skills list.

## Loading the skill

- From the TUI: invoke the `skill` tool with `name: "catpaw"`.
- From the agent system prompt: the skill appears under `<available_skills>` once Catui's core skill
  pipeline discovers it through `resources_discover`.

## Path resolution inside the skill

When `SKILL.md` references a script like
```text
node .agents/skills/catpaw/scripts/context.mjs
```
the path is the **upstream convention** — it targets the harness-agnostic install location used by
Claude Code, Cursor, Codex, and Qoder. Under Catui, the equivalent path is
`<skill base dir>/scripts/context.mjs`, where `<skill base dir>` is the absolute path Catui exposes
when loading the skill (also visible in the `<location>` element of the `<skill>` tag in the
`<available_skills>` system prompt block).

Catui does **not** auto-execute these scripts. If a workflow described in the skill needs one of
the upstream scripts to run, surface the command to the user and let them decide whether to invoke
it manually. See `THIRD_PARTY_NOTICE.md` for the full list of files that are vendored but not
consumed by Catui.

## Source and license

See `THIRD_PARTY_NOTICE.md`.