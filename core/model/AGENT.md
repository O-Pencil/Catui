# core/model/

> P2 | Parent: ../AGENT.md

Member List
switcher.ts: ModelCycleResult interface, ModelSwitcher class, model selection and cycling logic, handles API key resolution per provider, key methods: cycleModel(), setModel()
index.ts: Model management barrel exports, re-exports ModelSwitcher and ModelCycleResult
custom-providers.ts: Custom protocol provider IDs, NO_AUTH_API_KEY, configuration persistence/probing and compatible model bootstrap; preserves saved compatibility settings
discovery.ts: discoverModels(), discoverOpenAIModels(), inspectOpenAIModels(), normalizeOpenAIBaseUrl(), discovery result types; remote model lists, HTTP diagnostics and explicit deployment limits
discovery.test.ts: Tests for discoverModels(), discoverOpenAIModels(), getDiscoveryProtocol()
known-models.ts: KNOWN_MODEL_METADATA, lookupKnownModel(), UNKNOWN_MODEL_DEFAULTS, KnownModelMetadata, known model metadata for discovery fallback
known-models.generated.ts: Auto-generated known model metadata lookup table from models.generated.ts
discovery-cache.ts: DiscoveryCache, read/write/clear cached discovery results with TTL expiration
discovery-cache.test.ts: Tests for DiscoveryCache read/write/clear

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
