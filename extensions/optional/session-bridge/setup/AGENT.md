# Codex connection setup

Parent: [session bridge](../AGENT.md).

| Member | Responsibility |
| --- | --- |
| installer.ts | Bundle a private local marketplace and install via bounded Codex CLI calls |
| onboarding.ts | First-use confirmation, retry guidance and setup success messaging |

Loaded on user commands only. Never edits the personal marketplace or Codex TOML.
