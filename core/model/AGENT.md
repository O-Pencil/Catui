# core/model/

> P2 | Parent: ../AGENT.md

Member List
switcher.ts: ModelCycleResult interface, ModelSwitcher class, model selection and cycling logic, handles API key resolution per provider, key methods: cycleModel(), setModel()
index.ts: Model management barrel exports, re-exports ModelSwitcher and ModelCycleResult
custom-providers.ts: CUSTOM_ANTHROPIC_PROVIDER, CUSTOM_OPENAI_PROVIDER, registerCustomProvider(), custom model provider registration
discovery.ts: discoverModels(), discoverOpenAIModels(), getDiscoveryProtocol(), DiscoveredModel, DiscoveryResult, remote model discovery engine
discovery.test.ts: Tests for discoverModels(), discoverOpenAIModels(), getDiscoveryProtocol()
known-models.ts: KNOWN_MODEL_METADATA, lookupKnownModel(), UNKNOWN_MODEL_DEFAULTS, KnownModelMetadata, known model metadata for discovery fallback
known-models.generated.ts: Auto-generated known model metadata lookup table from models.generated.ts

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md