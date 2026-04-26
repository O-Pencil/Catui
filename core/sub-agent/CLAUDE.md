# core/sub-agent/

> P2 | Parent: ../CLAUDE.md

Member List
index.ts: Barrel exports for SubAgent runtime — SubAgentRuntime, subAgentRuntime, InProcessSubAgentBackend, SubAgentSpec/Result/Handle/Backend types
sub-agent-types.ts: Core SubAgent interfaces — SubAgentSpec (prompt/tools/cwd/signal/timeoutMs/model/contextFiles/exitHook), SubAgentHandle (id/status/result/abort/terminate), SubAgentResult, SubAgentBackend; consumed by backend and runtime
sub-agent-backend.ts: InProcessSubAgentBackend — wraps createAgentSession() with AbortSignal forwarding, timeout, contextFiles prompt injection, exitHook completion callback; spawn returns SubAgentHandle; single backend for Phase A
sub-agent-runtime.ts: SubAgentRuntime class — active agent registry, spawn/abortAll/terminateAll; default global instance subAgentRuntime; consumed by extension orchestrators
subprocess-backend.ts: SubprocessSubAgentBackend — worker_threads-based crash-isolated backend, abort/lifecycle wiring; worker LLM loop deferred (see file doc)
subprocess-worker.ts: Minimal worker entry for subprocess backend — receives WorkerSpec via workerData, posts result/error back via parentPort

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file on changes and verify against parent core/CLAUDE.md
