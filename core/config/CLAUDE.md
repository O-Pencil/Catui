# core/config/

> P2 | Parent: ../CLAUDE.md

Member List
resolve-config-value.ts: resolveConfigValue() implementation, resolves config values (shell command, env var, literal), caches shell results, key invariant: shell commands are cached per process lifetime
settings-manager.ts: SettingsManager class, two-tier settings (global + project-local), merge logic, key types: CompactionSettings, BranchSummarySettings, RetrySettings
resource-loader.ts: DefaultResourceLoader, ResourceLoader interface, ResourceDiagnostic type, discovers and loads extensions/skills/themes from multiple sources, key invariant: resources are loaded in precedence order (global < project < persona)
auth-storage.ts: AuthStorage class, credential storage for API keys and OAuth tokens, key types: ApiKeyCredential, OAuthCredential, uses proper-lockfile for atomic writes

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent CLAUDE.md