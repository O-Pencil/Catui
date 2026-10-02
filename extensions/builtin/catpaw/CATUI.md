# Catui Integration Notes

This file is Catui-specific and is not part of the vendored upstream `catpaw` bundle.
The skill body (`SKILL.md`) and `reference/*.md` load normally through Catui's skill
system and need no adaptation.

## What Catui does not run

The vendored bundle carries two directories that belong to the Claude Code / Cursor /
Codex harness. Catui implements neither, so both stay inert:

- `scripts/` — harness hooks, live iteration, and browser screenshot capture. Catui
  does not execute them automatically and installs no hook.
- `agents/*.toml` — sub-agent definitions for those harnesses. Catui does not consume
  them.

They are kept verbatim so the bundle stays intact for cross-harness reuse.

## What to do instead

When a step in the skill body or a `reference/*.md` file names a command under
`scripts/`, do not run it through `bash` on your own initiative. Surface it to the user
with the exact command and let them decide.
