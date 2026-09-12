# HU-01: Default-enabled humanizer must stay token-light and ethics-clean

```yaml
finding_id: HU-01
status: landed
review: humanizer-extension-review
severity: must-address
```

## Observation

The upstream `blader/humanizer` SKILL.md is ~8KB of markdown. If the extension injected the
full skill body into the agent system prompt at startup (a common "default-enabled" mistake),
every session would pay the token cost even when the user never writes prose. Additionally,
"humanizer" tools in the wild are often pitched as "evade AI detectors", which does not match
Catui's honesty-first values.

## Risk

1. **Token inflation**: default-enabled extension that eagerly injects content silently raises
   per-session cost for all users — violates feature-workflow §3 token/perf neutrality.
2. **Positioning risk**: if the bootstrap note does not state what the skill is *for*
   (writing quality, not detection evasion), the model may misuse it or the user may
   misunderstand it.

## Decision

1. Register via `resources_discover` only (on-demand skill loading via the `skill` tool),
   exactly like catpaw. The `before_agent_start` bootstrap note must be ≤ 10 lines and must
   state: (a) the skill removes AI-writing tells from prose; (b) it never invents facts or
   sources; (c) load it via the `skill` tool when editing user-facing prose.
2. Vendored `SKILL.md` keeps the upstream "Do not make anything up" / "Never invent a source"
   rules — they are part of the content and are not rewritten.
3. README/THIRD_PARTY_NOTICE explicitly state the skill is about writing quality, grounded in
   Wikipedia's public "Signs of AI writing" guide, not about bypassing detectors.

## Acceptance

- [x] `before_agent_start` returns ≤ 10 lines (6 lines, 398 chars — test enforces < 1,200)
- [x] skill loads via `resources_discover` only; startup prompt does not contain the skill body (test asserts bootstrap excludes `### 1. Not X but Y`)
- [x] README + notice clarify ethics positioning (writing quality, not detection evasion)
- [x] registry metadata: `riskLevel: "passive"`, `resourceDiscovery: true`, no timers/writes/process (test asserts)

## Resolution (2026-09-12)

All four acceptance items implemented and locked by `test/humanizer-extension.test.ts`
(4 tests). Bootstrap prompt kept at ~400 chars. SKILL.md is loaded on demand via
`resources_discover` only; vendored content retains upstream fact-integrity rules.