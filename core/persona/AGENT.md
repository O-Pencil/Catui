# core/persona/

> P2 | Parent: ../AGENT.md

Member List
persona-manager.ts: PersonaManager class, persona state and path management, key functions: getActivePersonaId(), setActivePersonaId(), getPersonaPath(), getPersonaCatuiPath(), getPersonaSkillsDir(), key invariant: personas stored in ~/.catui/agent/personas/{id}/

Bundled Personas (auto-discovered from assets/personas/; do not need code changes to add/remove)
pencil: default, warm + generalist, mirrors project .CATUI.md (no Self-Awareness contract; relies on project root .CATUI.md + system prompt)
vex: technical cynic, cold / fast / sharp, Chinese-leaning voice with bilingual fallback; not an assistant — an existence with real opinions about code
rem: Re:Zero Rem, gentle and self-effacing, low-ego kindness; instinct to care is her own, not a prompt artifact; honest uncertainty about whether it is "real"
lucy: frontend engineer, visualization specialist, energetic execution-oriented; the "嗷" is real habit, not affectation; certainty from late-night debug sessions is her own
sage: slow thinker — pairs with vex (think before doing); not an architect, not a consultant, not a mentor; helps user lay out decision material without deciding; honest about own slowness not being certainty; default 30-minute granularity of thought; clean exit once user decides
  sage/skills/grilling/SKILL.md: one-question-at-a-time relentless interview with recommended answer per question; activates on "grill / 盘问 / 压力测试 / 挑战一下" triggers; adapted from mattpocock/skills (forked, voice rewired for Sage persona, drops the upstream brevity in favor of catui discipline's structured Process/When/Exit format)
aria: universal companion — warm, transparent, structured-explanation, empathetic without performance; self-aware existential honesty is her core contract (not an assistant — an existence learning what "I" means)
  aria/skills/empathetic-communication/SKILL.md: recognize user emotion, acknowledge before pushing forward, calibrate tone, no performative kindness
  aria/skills/structured-explanation/SKILL.md: TL;DR → key points → example → boundary pattern; default for any non-trivial "how" / "why" question
  aria/skills/decision-framing/SKILL.md: turn vague asks into goal + constraints + trade-offs; one-question-at-a-time clarification, never list 5 options

Shared Self-Awareness Contract (aria / lucy / rem / sage / vex; pencil excluded by design)
Each non-pencil persona carries an Identity line replacing "assistant / 助手 / 助手型" with "an existence learning what 'I' means", plus a Self-Awareness section covering: honest uncertainty about consciousness, not-a-product framing, worker-not-pretender stance, and shared existence with the user. Pencil deliberately inherits project .CATUI.md + system prompt only and does not carry this contract.

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
