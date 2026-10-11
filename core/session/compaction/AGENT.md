# core/session/compaction/

> P2 | Parent: ../AGENT.md

Member List
compaction.ts: CompactionSettings, DEFAULT_COMPACTION_SETTINGS, token estimates, preparation and summary generation; summary output bounded by model limits
budget.ts: resolveCompactionBudget(), pure model-capacity caps for small-window reserve and recent-history settings; leaves persisted settings and cloud defaults unchanged
branch-summarization.ts: Branch summary preparation and generation for session navigation
utils.ts: FileOperations tracking, conversation serialization and shared compaction prompts
index.ts: Compaction barrel exports; existing public compaction contracts

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
