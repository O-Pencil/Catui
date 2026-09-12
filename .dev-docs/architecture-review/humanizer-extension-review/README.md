# Humanizer Extension Review

```yaml
review_id: humanizer-extension-review
parent_finding: none (new default-enabled extension)
scope: extensions/builtin/humanizer/ + builtin-extensions.ts registration + extensions/AGENT.md P2
status: closed
created_at: 2026-09-12
closed_at: 2026-09-12
outcome: landed - extension registered default-enabled, all gates green
```

> **CLOSED 2026-09-12.** Extension landed: `extensions/builtin/humanizer/` (SKILL.md vendored
> v3.0.0 + Catui wrapper + P2/notice docs), registered in `builtin-extensions.ts` as
> `{ id: "humanizer", category: "default", defaultEnabled: true, riskLevel: "passive",
> resourceDiscovery: true }`. HU-01 resolved. Gates: verify:dip ✅ / verify:quality ✅ /
> verify:package-boundary ✅ / build ✅ / tsc --noEmit ✅ / test/humanizer-extension.test.ts 4/4 ✅.

## Purpose

Bundle the upstream `blader/humanizer` Agent Skill (v3.0.0, MIT) as a default-enabled Catui
extension. Goal: when Catui writes documentation / prose / PR descriptions, the model can
invoke the `humanizer` skill to remove AI-writing tells (not-X-but-Y, one-line closers,
forced triads, AI-word lists, chat residue) without changing the meaning or inventing facts.

## Decision

| Question | Decision | Rationale |
|---|---|---|
| Category | `default` (default-enabled) | User asked for默认启用; the extension is passive (skill-only, no side effects) |
| Risk level | `passive` | No UI, no timers, no workspace writes, no external processes; only `resources_discover` + `before_agent_start` bootstrap note (catpaw precedent) |
| Placement | `extensions/builtin/humanizer/` | feature-workflow §2b: user-facing capability → `extensions/`; vendored skill bundle → catpaw pattern |
| Token strategy | `resources_discover` only; bootstrap note ≤ 10 lines | Skill body is loaded via the `skill` tool on demand, mirroring catpaw. No prompt inflation at startup |
| Compatibility | SKILL.md frontmatter `name: humanizer` matches dir name | Satisfies `core/skills.ts#validateName` |
| Test contract | `resource-discovery` test, catail-style | Verify metadata + discovery + bootstrap note; no new runtime surface |

## Gates (from §2b MUST / MUST-NOT)

- ✅ MUST: extension consumes core via `ExtensionAPI` only; no host-internal imports
- ✅ MUST: P3 header on `index.ts`; P2 registration in `extensions/AGENT.md`; P1 table in root `AGENTS.md`
- ✅ MUST: GB-2 declaration — default-enabled extension = user-visible change, declared in this review
- ✅ MUST-NOT: no `core/` business code, no cross-extension deps, no vendored upstream scripts
  (upstream has no scripts; only `SKILL.md` + `LICENSE` are vendored)
- ✅ MUST-NOT: do not vendor upstream `AGENTS.md` (it is a Claude-Code harness instruction file;
  vendoring it would confuse DIP scanning and inject foreign agent instructions)

## Current Finding Set

| Finding | Status | Purpose |
|---------|--------|---------|
| [HU-01](./findings/HU01-default-enabled-token-and-ethics.md) | ✅ landed | Default-enablement must not inflate prompt tokens or be mistaken for "evade AI detectors" |

## Closeout

Filled in after implementation + gates (verify:dip / verify:quality / verify:package-boundary /
build / tsc --noEmit).