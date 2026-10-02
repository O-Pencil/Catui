# typesafe/ — Default decision guidance and TypeSafe skill

> P2 | Parent: ../AGENT.md

## Member List

index.ts: typesafeExtension, DECISION_GUIDANCE — passive resource discovery and bounded per-turn guidance; no tools, timers, network calls, or writes.
skills/typesafe-ai/SKILL.md: Unmodified MIT upstream skill from typesafe-ai/skills, revision 65a39f393687675ce170e6094757de20370365b9.
skills/agent-decision-loop/SKILL.md: Catui companion for provider-independent decision, tool selection, and result evaluation.
LICENSE: Upstream MIT license retained with the vendored skill.

Source: https://github.com/typesafe-ai/skills/tree/65a39f393687675ce170e6094757de20370365b9

Default enabled across modes and headless SDK prompts. The CLI supplies built-ins
as explicit paths; `--no-extensions` only disables directory discovery.
Full skills are loaded on demand. The bootstrap is bounded to 1,600 characters.
Installing this skill does not call TypeSafe or provide runtime validation beyond
Catui's existing tool policies. TypeSafe API usage requires separate credentials.
