# Vera Scientific Persona Review

```yaml
status: implemented-and-verified
owner: core/persona + extensions/builtin/catail
scope: bundled Vera persona, generic persona hardening, CLI activation, CATAIL research-to-publication route
trigger: CLI user path, prompt identity routing, and default-discovered Skill behavior change
```

## Intent

Add Vera as Catui's dedicated scientific persona while preserving Catui's default coding-agent behavior. Vera supplies scientific identity and judgment; CATAIL remains the single owner of scientific methods, durable research artifacts, and the route from an idea through submission readiness.

## Placement decision

| Concern | Owner | Decision |
|---|---|---|
| Scientific identity, tone, and presence | `assets/personas/vera/CATUI.md` | Add one bundled persona asset; do not duplicate CATAIL under persona skills. |
| Persona discovery and selection validity | `core/persona/persona-manager.ts` | Keep generic and research-agnostic; reject unknown/empty personas and resolve source/dist assets. |
| Identity prompt priority | `core/prompt/system-prompt.ts` | Classify persona paths portably on POSIX and Windows. |
| Interactive switching | `modes/interactive/interactive-mode.ts` | Reuse `/persona use vera`; surface validation failures without adding a new command. |
| Scientific activation and methods | `extensions/builtin/catail/` | Vera authorizes CATAIL for scientific intent; other personas still require explicit activation. |
| SDK and Workbench | deferred | No public API, protocol, or UI surface in this change. |

## Non-goals

- No scientific runtime controller, background scheduler, autonomous experiment daemon, or network service.
- No `/vera`, `/scientist`, or `/catail` command.
- No `personaId` SDK option or public protocol type.
- No automatic external submission; an accountable human owns the final action.
- No change to the current default persona in this review.

## Findings

- [SP01 — Separate persona identity from research method ownership](findings/SP01-persona-skill-ownership.md)
- [SP02 — Use an explicit activation matrix](findings/SP02-catail-activation-matrix.md)
- [SP03 — Harden generic persona loading before adding Vera](findings/SP03-persona-loading-hardening.md)
- [SP04 — Ship CLI-first and defer the SDK surface](findings/SP04-cli-first-sdk-deferral.md)

## Acceptance

- Vera is discoverable and switchable through the existing Persona CLI flow in source and production builds.
- Persona identity appears exactly once in the high-priority identity section on POSIX and Windows paths.
- Unknown or empty Persona IDs do not mutate active state or create directories.
- Vera scientific requests may activate CATAIL; Vera coding requests remain normal coding work.
- Non-Vera personas still require `/skill:catail` or an explicit request to use CATAIL.
- CATAIL describes itself as a research-to-publication Skill and includes venue, submission, and rebuttal playbooks.
- CCF ranking, calls for papers, deadlines, and formatting constraints are verified from current primary sources rather than embedded as static facts.
- Focused tests and all repository gates pass; the published package contains Vera and the new CATAIL assets.
