# packages/soul-core/

> P2 | Parent: ../AGENT.md

Member List
manager.ts: SoulManager class, unified Soul management API, composes all Soul modules (store, evolution, injection)
types.ts: PersonalityVector, CognitiveStyle, ValueSystem, EmotionalState, ExpertiseArea, core data types for Soul engine, foundation layer
evolution.ts: SoulEvolutionEngine and PatternInsight, personality evolution logic, implements learning algorithms for soul growth
index.ts: soul-core barrel exports, entry point for package, exports SoulStore, SoulManager, getSoulConfig, all types
config.ts: getDefaultConfig, getSoulConfig, validateSoulConfig, configuration layer with defaults and validation
store.ts: SoulStore class, persistent storage backed by NanoMem, bridges Soul and memory system
diagnostics.ts: Thin diagnostic bus shell, mirrors root utils/diagnostics.ts for silent issue-event routing plus explicit dev/debug console output
injection.ts: generatePersonalityDirective, generateValueGuidance, generateCognitiveStyleHint, prompt injection for system messages

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md