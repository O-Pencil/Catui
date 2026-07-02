# extensions/builtin/token-save/

> P2 | Parent: ../AGENT.md

Member List
paths.ts: projectKeyForPath() (realpath → sha1[0:12]), dataDirForKey(), resolveTokenSavePaths() — runtime data lives under ~/.catui/token-save/projects/<key>/, never inside the project tree
index.ts: tokenSaveExtension async entry — resolves dataDir once, runs one-shot migrateLegacyTokenSave() (now also rewrites rawRecoveryPath fields in the migrated history.jsonl so agent footer links don't hit ENOENT), registers /tokensave command, hooks tool_call / tool_result events
no-output-builtins.ts: NO_OUTPUT_BUILTINS set + isNoOutputBuiltin() helper — extracted to break the rewrite.ts <-> filters.ts import cycle; consulted by planCommand and classifyCommand to short-circuit shell builtins (cd / pwd / export / unset / …) whose stdout is empty or session-only
config.ts: loadTokenSaveConfigFilters() — loads user-level ~/.catui/token-save/filters.json plus project-level .catui/token-save/filters.json (only when .catui/token-save/trust.json opts in with {trusted:true}); project config layout unchanged
rewrite.ts: planCommand() + rewriteRules registry — 11 command-shape patterns (git status/diff/log, cat/head/tail, rg/grep/find/ls, tsc, eslint/biome, pytest, vitest/jest, npm/pnpm install, jq/curl) with capture/passthrough modes; honors TOKEN_SAVE_DISABLED env, heredoc, and write-redirection guards
filters.ts: classifyCommand() + filterTokenSaveOutput() + estimateTokens() — pure command classifiers and per-category compact*() functions (git status/diff/log, file read, TypeScript, lint, pytest, test, search, package-manager, json, generic)
lexer.ts: splitShellSegments() — quote-aware command segmentation used by planCommand
toml-dsl.ts: applyTomlStyleFilter() — TOML-style pipeline (stripLines/keepLines/replace/matchMessage/truncateLine/maxLines) for user-configured filters
runner.ts: applyTokenSavePlan() — combines planCommand + filterTokenSaveOutput + writeRawRecovery; applies MIN_SAVINGS_TOKENS=32 / MIN_SAVINGS_PCT=12 thresholds
recovery.ts: writeRawRecovery() — writes raw command output to <dataDir>/raw/<ts>-<rand>.log so the agent footer link resolves after filtering
tracking.ts: TokenSaveTracker — in-memory ring (500) + JSONL appendFile() to <dataDir>/history.jsonl; formatSummary() / formatHistory() back the /tokensave command

Path Contract
- Runtime data (history.jsonl, raw/*.log): ~/.catui/token-save/projects/<sha1(realpath).slice(0,12)>/
- User config (filters.json): ~/.catui/token-save/filters.json
- Project config (filters.json / trust.json): <project>/.catui/token-save/ — kept on purpose; explicit opt-in via trust.json
- Legacy <project>/.catui/token-save/{history.jsonl,raw/} is migrated once on first run after the upgrade and marked with <dataDir>/.migrated

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
