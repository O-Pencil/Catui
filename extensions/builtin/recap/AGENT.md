# extensions/builtin/recap/

> P2 | Parent: ../AGENT.md

Member List
index.ts: recapExtension entry — registers /recap command (Free deterministic by default; --smart opts into LLM-polished synthesis) and ※ recap message renderer; on-demand only, no auto trigger
recap-types.ts: RECAP_MESSAGE_TYPE constant, RecapEntry / RecapSource / RecapTriggerReason / RecapSettings types, RECAP_DEFAULTS conservative settings
recap-budget.ts: estimateInputTokens() char-count pre-flight estimate, checkPerCallBudget() pre-call hard-cap enforcement
recap-extractor.ts: extractFreeRecap() + formatFreeRecap() + walkSessionActivity() — zero-LLM deterministic Free path; goal=longest substantive user message, facts=tool/file frequency top-3, next=question-mark detection
recap-synthesizer.ts: buildRecapContext() returns prompt + activity counts (userTurns/assistantTurns/toolCalls) via shared walkSessionActivity walker, hasMeaningfulActivity() pre-check used by handler before "Synthesizing…" notify, synthesizeSmartRecap() runs completeSimpleWithUsage with three-clause system prompt, surfaces real provider usage, returns empty_session as a defensive fallback
recap-renderer.ts: createRecapRenderer() — italic dim ※ recap with `{in} in / {out} out · ~${cost}` badge, no background block (low-weight in-conversation hint), Text-only (no Markdown coupling)

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
