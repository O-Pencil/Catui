# core/telemetry/

> P2 | Parent: ../CLAUDE.md

Member List
types.ts: TelemetryDiagnostic event shape (mirrors SAL onDiagnostic), DiagnosticHandler callback type, InsforgeHttpResult, PostJsonOptions — foundational telemetry types
credentials.ts: InsforgeCredentialsBase interface + loadInsforgeCredentials<T>() — generic credential loader reading ~/.memory-experiments/credentials.json (workspace fallback first, then home), accepts both `{credentials:[{id:"insforge",...}]}` and flat top-level formats, normalizes camelCase aliases to snake_case canonical fields, preserves extra sink-specific keys
insforge-base.ts: InsforgeHttpClient class + parsePostgrestErrorCode/safeHost helpers — generic PostgREST HTTP transport (POST/PATCH), TLS allowSelfSigned support, 5s timeout, diagnostic emission with source-scoped fingerprints; no event routing, no batching (those live elsewhere)
batching-dispatcher.ts: BatchingDispatcher<T> class — generic event-buffering with debounced flush timer, reentrancy protection, close-time drain; reusable across any telemetry sink
index.ts: Barrel — the only entry point external callers should import from

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent CLAUDE.md
