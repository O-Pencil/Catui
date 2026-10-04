<!--
catui fundamentals catalog (C0-C10). This is the syllabus for the object being studied, not any learner's results.
Anchors are accurate as of catui-agent 1.1.10; before teaching, verify live with Read/Grep (file:line drifts as code moves).
Each concept field: why is it designed this way / cross-cut key file:line / P2 DIP node / debugging entry / dependency edge / matching docs.
-->

# catui course catalog: fundamentals C0–C10

Cross-cut by **maintainer's mental model** (not by directory). Order = dependency order; orientation comes first. Teaching agents use this plus `wizard.md` to tailor a personalized path.

> Usage: each section is a "syllabus card" for one lesson. Verify anchors with `Read` / `Grep` before teaching (code moves); after teaching, deposit into the learner's personal vault per `kb-integration.md`.

---

## C0 · Overall design and framework

- **Maintainer's question**: How is this thing structured overall? How do I find my own way?
- **Why is it designed this way**: A four-layer topology (Entry to Core to Tool to Interface) decouples "entry / core / capability / presentation". The DIP three-tier code map lets anyone navigate themselves, instead of relying on tribal knowledge.
- **Cross-cut key files**: `cli.ts` (entry) → `main.ts:5` (args to `CreateAgentSessionOptions` to mode selection) → `main.ts:30` `createAgentSession`; `AGENTS.md` (P1 topology / directory / subsystems); `scripts/verify-dip.ts` (map-isomorphism check).
- **P2 DIP nodes**: `core/AGENT.md`, `AGENTS.md` (P1).
- **How to use DIP**: P1 = `AGENTS.md` global map; P2 = each directory's `AGENT.md` member list; P3 = each file header `[WHO]/[FROM]/[TO]/[HERE]`. From P1 find subsystem → P2 find file → P3 header confirm responsibility.
- **Debugging entry points**: Abnormal startup behavior, look at mode selection in `main.ts`; "where does this capability live", check `AGENTS.md` Directory Structure / Key Subsystems.
- **Dependency edges**: none (entry point).
- **Matching docs**: `AGENTS.md`.

## C1 · Agent Loop core

- **Maintainer's question**: How does one conversational turn actually run to completion?
- **Why is it designed this way**: Separate "session orchestration" (`AgentSession`) from "the loop itself" (agent-core's `Agent`) — the session manages lifecycle / events / tool assembly; agent-core only runs the pure prompt to model to tool to refill loop, easy to reuse and test.
- **Cross-cut key files**: `core/runtime/agent-session.ts:1117` `prompt()` → `:1270` `this.agent.prompt()`; `core/lib/agent-core/src/agent.ts:173` `class Agent`; loop at `core/lib/agent-core/src/agent-loop.ts:303` (`while(true)`) and `structured-adaptive-agent-loop.ts:227`; tool orchestration `structured-adaptive-tool-orchestration.ts`.
- **P2 DIP nodes**: `core/runtime/AGENT.md`, `core/lib/agent-core/AGENT.md`, `core/lib/ai/AGENT.md` (model streaming).
- **Debugging entry points**: turn not stopping / stuck → stopping condition at `agent-loop.ts:303`; tool call not triggered → orchestrator `core/tools/orchestrator.ts`; event not emitted → `AgentSession`'s event emission.
- **Dependency edges**: C0.
- **Matching docs**: `docs/sdk.md` (embedder view).

## C2 · Session lifecycle and context

- **Maintainer's question**: How is conversation history stored? How does it branch? What happens when context fills up?
- **Why is it designed this way**: Sessions persist as jsonl and support branch/fork, so "go back in time / try in parallel" is possible; compaction summarizes history when the context window is about to fill, avoiding overflow while losing as little information as possible.
- **Cross-cut key files**: `core/session/` (SessionManager, persistence / branching); `core/session/compaction/compaction.ts` (`CompactionController` / `compactSession`); `core/session/compaction/branch-summarization.ts`; persistence path `~/.catui/agents/<id>/sessions/*.jsonl`.
- **P2 DIP nodes**: `core/session/AGENT.md`.
- **Debugging entry points**: history lost / cross-talk → SessionManager's branch read; context mysteriously truncated → `compaction.ts` trigger threshold; wrong summary after fork → `branch-summarization.ts`.
- **Dependency edges**: C1.
- **Matching docs**: `docs/sdk.md` (`./session`, `./session/compaction` subpath exports).

## C3 · Models and providers

- **Maintainer's question**: Where does the model come from? How is it authenticated? How do you switch? How does the startup chain go?
- **Why is it designed this way**: ModelRegistry unifies multi-provider / custom-provider and auth (API key / OAuth), decoupling "pick a model" from "run a model"; MCP warms up asynchronously at startup so it doesn't block the UI.
- **Cross-cut key files**: `core/model-registry.ts` (ModelRegistry); `core/model-resolver.ts:27` (`resolveCliModel` / `resolveModelScope`); `core/model/custom-providers.ts`; `core/runtime/sdk.ts` (`createAgentSession`, `deferMcpInit`); MCP async warmup via `warmupMcpTools()` in `agent-session.ts`.
- **P2 DIP nodes**: `core/model/AGENT.md`, `core/runtime/AGENT.md`.
- **Debugging entry points**: model not found / wrong one selected → `model-resolver.ts`; auth failure → `custom-providers.ts` / `auth.json` read; slow startup → MCP / soul init in `sdk.ts` (use `NANOPENCIL_TIMING=1` / `CATUI_*` for timing).
- **Dependency edges**: C1.
- **Matching docs**: `docs/models.md`, `docs/providers.md`, `docs/custom-provider.md`.

## C4 · Tool system

- **Maintainer's question**: What tools are there? How are tools defined / registered / validated / executed? How do extension tools and MCP tools merge into one table?
- **Why is it designed this way**: A unified `ToolDefinition` + orchestrator makes built-in tools, extension-contributed tools, and MCP tools all go through the same registration / execution / permission path; MCP tools use a factory pattern for late assembly to support async and `/reload`.
- **Cross-cut key files**: built-in tools `core/tools/{bash,read,edit,write,grep,find,ls,source}.ts`; orchestration `core/tools/orchestrator.ts` (`ToolOrchestrator`); assembly `core/runtime/agent-session.ts:280-417` (`customTools` / `mcpToolsFactory` / `_customTools`), `:2370` `registerTool(AGENT_TOOL_NAME…)`; type `ToolDefinition` (from `core/extensions-host`).
- **P2 DIP nodes**: `core/tools/AGENT.md`, `core/mcp/AGENT.md`.
- **Debugging entry points**: tool not appearing → tool assembly in `agent-session` + `mcpToolsFactory`; parameter validation error → that tool's schema; permission blocked → orchestrator / tool permission check.
- **Dependency edges**: C1.
- **Matching docs**: (no standalone manual; folded into `docs/sdk.md` / `docs/extensions.md`).

## C5 · Extension system

- **Maintainer's question**: How are extensions discovered / loaded? What can they change? Which built-in extensions exist?
- **Why is it designed this way**: extensions-host uses loader/runner/wrapper to inject third-party capabilities via controlled hooks (register tools / commands / key bindings / UI, modify prompt/context), preventing extensions from invading the core directly.
- **Cross-cut key files**: `core/extensions-host/{loader,runner,wrapper,types}.ts`; built-in `extensions/builtin/` (`interview/grub/loop/link-world/browser/discipline/mcp/security-audit/soul/token-save/teach`).
- **P2 DIP nodes**: `core/extensions-host/AGENT.md`, `extensions/AGENT.md`, `extensions/builtin/AGENT.md`.
- **Debugging entry points**: extension not loaded → discovery logic in `loader.ts`; hook not fired → event emission in `runner.ts`; tool behaves oddly after being wrapped → `wrapper.ts`.
- **Dependency edges**: C4.
- **Matching docs**: `docs/extensions.md`.

## C6 · Sub-agents and isolation

- **Maintainer's question**: How does the Agent tool spawn sub-agents? How does it isolate git / workspace?
- **Why is it designed this way**: Sub-agents run in their own worktree to avoid polluting the main workspace; registry manages sub-agent types and lifecycle.
- **Cross-cut key files**: `core/sub-agent/` (Agent tool, registry, worktree isolation); `core/workspace/` (worktree manager / git isolation).
- **P2 DIP nodes**: `core/sub-agent/AGENT.md`, `core/workspace/AGENT.md`.
- **Debugging entry points**: sub-agent changes lost / conflicts → worktree create/cleanup in `core/workspace/`; can't spawn sub-agent → registry in `core/sub-agent/`.
- **Dependency edges**: C4, C5.
- **Matching docs**: (folded into `docs/sdk.md`).

## C7 · Run modes and TUI

- **Maintainer's question**: What's the difference between the four modes (interactive / print / rpc / acp)? How does TUI render?
- **Why is it designed this way**: Different front-ends (TUI interaction / streaming print / IDE rpc / acp) hang off the same `AgentSession`, lazily loaded on demand to save startup cost; the TUI renderer has a per-line width invariant (recently fixed a narrow-terminal crash).
- **Cross-cut key files**: `modes/interactive/interactive-mode.ts`, `modes/print/print-mode.ts`, `modes/rpc/rpc-mode.ts`, `modes/acp/acp-mode.ts`; renderer `core/lib/tui/src/tui.ts` (differential render + width invariant).
- **P2 DIP nodes**: `modes/AGENT.md`, `modes/interactive/AGENT.md`, `modes/rpc/AGENT.md`, `modes/acp/AGENT.md`, `core/lib/tui/AGENT.md`.
- **Debugging entry points**: mode didn't start → mode selection in `main.ts` + corresponding `*-mode.ts`; TUI crashes / mis-layout → render path in `core/lib/tui/src/tui.ts` (set `CATUI_STRICT_RENDER=1` to expose over-wide lines); component doesn't truncate → that component's render.
- **Dependency edges**: C1.
- **Matching docs**: `docs/tui.md`, `docs/themes.md`, `docs/keybindings.md`.

## C8 · Prompt engineering

- **Maintainer's question**: How is the system prompt assembled? How are docs injected? How do skills hook in?
- **Why is it designed this way**: Centralize system-prompt assembly; at runtime inject project docs on demand (when asked about a feature, point to `docs/*.md`) and skills, so capabilities are discoverable and trimmable.
- **Cross-cut key files**: `core/prompt/system-prompt.ts` (assembly; `:308` lists the referenced `docs/*.md`); skills via the `discipline` extension + `skills.ts` public exports.
- **P2 DIP nodes**: `core/prompt/AGENT.md`.
- **Debugging entry points**: missing section in prompt → assembly order in `system-prompt.ts`; agent can't find feature manual → corresponding `docs/` file is still a stub; skill not taking effect → `discipline` extension.
- **Dependency edges**: C1, C5.
- **Matching docs**: `docs/skills.md`, `docs/prompt-templates.md`.

## C9 · Ecosystem integration (mapping only)

- **Maintainer's question**: How do O-Pencil (GUI) and Gateway consume this core? What integration breakpoints are there?
- **Why is it designed this way**: The core is reused by GUI and gateway as the `@catui/agent` SDK, forming a "core engine to GUI presentation to Gateway touchpoints" ecosystem.
- **Cross-cut key**: see `ecosystem-map.md` (three-repo contract + `@pencil-agent/nano-pencil` to `catui-agent` drift).
- **P2 DIP nodes**: `packages/protocol/AGENT.md` (public contracts); cross-repo at `O-Pencil/`, `Pencil-Agent-Gateway/`.
- **Debugging entry points**: GUI / gateway can't start or types don't line up → downstream still depends on the old package `@pencil-agent/nano-pencil` (drift, see ecosystem-map).
- **Dependency edges**: C1, C3.
- **Matching docs**: `docs/sdk.md`, `docs/packages.md`.

## C10 · Platform / meta-layer

- **Maintainer's question**: What are `packages`? How do "meta-capabilities" like telemetry / self-diagnosis / wiki run?
- **Why is it designed this way**: Pull independently-evolving capabilities (protocol contracts, memory, persona) out into `packages/`; put telemetry and diagnosis at the platform layer; DIP / llm-wiki / self-diagnosis make up the "project self-awareness" meta-layer.
- **Cross-cut key files**: `packages/{protocol,mem-core,soul-core}/`; `core/platform/telemetry/` (insforge); `llm-wiki/` (verifiable code projection); `scripts/self-diagnosis/` (reflexive self-learning scaffold, not yet runnable).
- **P2 DIP nodes**: `packages/AGENT.md`, `packages/protocol/AGENT.md`, `packages/mem-core/AGENT.md`, `packages/soul-core/AGENT.md`, `core/platform/telemetry/AGENT.md`.
- **Debugging entry points**: telemetry not reporting → `core/platform/telemetry/`; wiki verify failure → `npm run wiki:verify`; DIP error → `npm run verify:dip`.
- **Dependency edges**: C0 (meta-layer returns to the map itself).
- **Matching docs**: `docs/packages.md`.
