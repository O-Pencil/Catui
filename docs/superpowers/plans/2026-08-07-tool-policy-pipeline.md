# Unified Tool Policy Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give both Catui agent loops one ordered, typed tool-policy execution contract while preserving legacy SDK plan-mode behavior.

**Architecture:** Agent core owns policy evaluation types and execution helpers. Runtime adapts existing static, plan, extension, and user policies; the plan predicate has one pure implementation and legacy APIs remain adapters.

**Tech Stack:** TypeScript, Vitest, TypeBox, Catui extension host.

---

### Task 1: Typed policy kernel

**Files:**
- Create: `core/lib/agent-core/src/tool-policy.ts`
- Modify: `core/lib/agent-core/src/types.ts`
- Modify: `core/lib/agent-core/src/index.ts`
- Test: `core/lib/agent-core/test/tool-policy.test.ts`

- [ ] Write tests proving ordered allow/deny evaluation, exception fail-closed behavior, input transforms, and abort passthrough.
- [ ] Run `npx vitest run core/lib/agent-core/test/tool-policy.test.ts` and confirm the missing module fails.
- [ ] Implement `AgentToolPolicy`, `AgentToolPolicyDecision`, `ToolPolicyPipeline`, and stable denial metadata without `any` or unsafe casts.
- [ ] Run the focused test and confirm it passes.
- [ ] Commit `feat(agent-core): add ordered tool policy pipeline`.

### Task 2: Loop integration parity

**Files:**
- Modify: `core/lib/agent-core/src/agent-loop.ts`
- Modify: `core/lib/agent-core/src/structured-adaptive-tool-orchestration.ts`
- Modify: `core/lib/agent-core/src/types.ts`
- Test: `core/lib/agent-core/test/agent-loop.test.ts`

- [ ] Add failing parity tests that deny and transform the same tool call in both loop frameworks.
- [ ] Run the named tests and confirm the policy path is absent.
- [ ] Route both orchestration paths through the shared pipeline, preserve `canUseTool` as the final legacy adapter, and emit `permission_denied` details with policy id.
- [ ] Run agent-core tests and confirm parity.
- [ ] Commit `refactor(agent-core): route tool execution through policies`.

### Task 3: Plan-mode single predicate and staged compatibility

**Files:**
- Modify: `core/runtime/plan-mode-permissions.ts`
- Modify: `core/runtime/sdk.ts`
- Modify: `extensions/builtin/plan/plan-permissions.ts`
- Test: `test/plan-mode.test.ts`
- Test: `test/sdk.test.ts`

- [ ] Add failing matrix tests for strict active-plan path, legacy markdown profile, unknown tools, agent kinds, and read-only shell commands.
- [ ] Run the focused tests and confirm the current divergence.
- [ ] Extract one pure evaluator, add `planFilePath?: string` to SDK options, select strict behavior when supplied, and emit one deprecation diagnostic for the legacy profile.
- [ ] Run both focused suites and confirm identical policy decisions.
- [ ] Commit `fix(plan): unify plan tool policy semantics`.

### Task 4: Extension adapter and documentation

**Files:**
- Modify: `core/extensions-host/runner.ts`
- Modify: `core/extensions-host/wrapper.ts`
- Modify: `core/extensions-host/types.ts`
- Test: `test/extensions.test.ts`
- Modify: `core/extensions-host/AGENT.md`
- Modify: `core/lib/agent-core/AGENT.md`
- Modify: `core/runtime/AGENT.md`

- [ ] Add failing tests showing a hook block becomes structured denial and hook ordering is deterministic.
- [ ] Run the focused test and confirm generic error classification.
- [ ] Add the adapter, preserve legacy hooks, update ownership maps, and avoid changing third-party signatures.
- [ ] Run extension and agent-core focused tests.
- [ ] Commit `refactor(extensions): normalize tool policy outcomes`.
